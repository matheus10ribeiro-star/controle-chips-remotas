/*
 * Camada de dados.
 * - Com Firebase configurado: login por e-mail/senha + Firestore em tempo real,
 *   com cache offline (as movimentações feitas sem sinal são enviadas depois).
 * - Sem Firebase: modo local (localStorage), útil só para testes.
 */
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

function limpo(o) { return JSON.parse(JSON.stringify(o)); }

/* Espera o servidor confirmar; se demorar (sem sinal), devolve "fila".
   Erros que chegarem depois viram o evento "store-erro". */
function esperarOuFila(p) {
  p.catch(err => window.dispatchEvent(new CustomEvent("store-erro", { detail: err })));
  return Promise.race([
    p.then(() => "enviado"),
    new Promise(r => setTimeout(() => r(navigator.onLine ? "enviando" : "fila"), 4000))
  ]);
}

export async function criarStore(cfg) {
  if (!cfg || !cfg.firebase || !cfg.firebase.apiKey) return lojaLocal();

  const [appMod, authMod, fs] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js")
  ]);
  const app = appMod.initializeApp(cfg.firebase);
  const auth = authMod.getAuth(app);
  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (e) {}
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fs.getFirestore(app);
  }
  const meta = { includeMetadataChanges: true };

  return {
    modo: "firebase",
    onAuth: cb => authMod.onAuthStateChanged(auth, cb),
    entrar: (email, senha) => authMod.signInWithEmailAndPassword(auth, email, senha),
    async cadastrar(nome, email, senha) {
      const c = await authMod.createUserWithEmailAndPassword(auth, email, senha);
      try { await authMod.updateProfile(c.user, { displayName: nome }); } catch (e) {}
      await fs.setDoc(fs.doc(db, "usuarios", c.user.uid), { nome, email, papel: "pendente", criadoEm: new Date().toISOString() });
    },
    sair: () => authMod.signOut(auth),
    resetarSenha: email => authMod.sendPasswordResetEmail(auth, email),
    async garantirPerfil(user) {
      const ref = fs.doc(db, "usuarios", user.uid);
      const s = await fs.getDoc(ref);
      if (!s.exists()) await fs.setDoc(ref, { nome: user.displayName || user.email, email: user.email, papel: "pendente", criadoEm: new Date().toISOString() });
    },
    onPerfil: (uid, cb, err) => fs.onSnapshot(fs.doc(db, "usuarios", uid), s => cb(s.exists() ? s.data() : null), err),
    onChips(cb, err) {
      return fs.onSnapshot(fs.collection(db, "chips"), meta, s => {
        const m = new Map(); s.forEach(d => m.set(d.id, d.data()));
        cb(m, s.metadata.hasPendingWrites);
      }, err);
    },
    onMovs(cb, err) {
      const q = fs.query(fs.collection(db, "movs"), fs.orderBy("ts", "desc"), fs.limit(10000));
      return fs.onSnapshot(q, meta, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })), s.metadata.hasPendingWrites), err);
    },
    /* Grava cada chip e sua movimentação juntos (tudo ou nada por lote). */
    registrar(pares) {
      const proms = [];
      for (let i = 0; i < pares.length; i += 200) {
        const b = fs.writeBatch(db);
        pares.slice(i, i + 200).forEach(({ chip, mov }) => {
          b.set(fs.doc(db, "chips", chip.iccid), limpo(chip));
          b.set(fs.doc(fs.collection(db, "movs")), limpo(mov));
        });
        proms.push(b.commit());
      }
      return esperarOuFila(Promise.all(proms));
    },
    salvarChip: chip => esperarOuFila(fs.setDoc(fs.doc(db, "chips", chip.iccid), limpo(chip))),
    excluirChip: iccid => esperarOuFila(fs.deleteDoc(fs.doc(db, "chips", iccid))),
    onUsuarios: (cb, err) => fs.onSnapshot(fs.collection(db, "usuarios"), s => cb(s.docs.map(d => ({ uid: d.id, ...d.data() }))), err),
    setPapel: (uid, papel) => fs.updateDoc(fs.doc(db, "usuarios", uid), { papel })
  };
}

/* ---------- Modo local (sem Firebase) ---------- */
function lojaLocal() {
  const KEY = "chipsRemotas.local.v1";
  let dados = { chips: {}, movs: [] };
  try { const raw = localStorage.getItem(KEY); if (raw) dados = JSON.parse(raw); } catch (e) {}
  const ouvChips = new Set(), ouvMovs = new Set();
  const salvar = () => { try { localStorage.setItem(KEY, JSON.stringify(dados)); } catch (e) {} };
  const avisar = () => {
    const m = new Map(Object.entries(dados.chips));
    ouvChips.forEach(cb => cb(m, false));
    const mv = [...dados.movs].sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    ouvMovs.forEach(cb => cb(mv, false));
  };
  const usuario = { uid: "local", email: "", displayName: "Modo local" };
  return {
    modo: "local",
    onAuth(cb) { setTimeout(() => cb(usuario), 0); return () => {}; },
    entrar: async () => {}, cadastrar: async () => {}, sair: async () => {}, resetarSenha: async () => {},
    garantirPerfil: async () => {},
    onPerfil(uid, cb) { setTimeout(() => cb({ nome: "Modo local", papel: "admin" }), 0); return () => {}; },
    onChips(cb) { ouvChips.add(cb); setTimeout(avisar, 0); return () => ouvChips.delete(cb); },
    onMovs(cb) { ouvMovs.add(cb); setTimeout(avisar, 0); return () => ouvMovs.delete(cb); },
    async registrar(pares) {
      pares.forEach(({ chip, mov }) => { dados.chips[chip.iccid] = limpo(chip); dados.movs.push({ id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...limpo(mov) }); });
      salvar(); avisar(); return "enviado";
    },
    async salvarChip(chip) { dados.chips[chip.iccid] = limpo(chip); salvar(); avisar(); return "enviado"; },
    async excluirChip(iccid) { delete dados.chips[iccid]; salvar(); avisar(); return "enviado"; },
    onUsuarios(cb) { setTimeout(() => cb([{ uid: "local", nome: "Modo local", email: "", papel: "admin" }]), 0); return () => {}; },
    setPapel: async () => {}
  };
}
