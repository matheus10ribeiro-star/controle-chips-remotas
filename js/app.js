/* Controle de Chips das Remotas — aplicação principal */
import { criarStore } from "./store.js";

const CFG = window.APP_CONFIG || {};

/* ---------- Domínio ---------- */
const REGIONAIS = CFG.regionais || [];
const REG = Object.fromEntries(REGIONAIS.map(r => [r.id, r]));
const SUPS = [...new Set(REGIONAIS.map(r => r.sup))];
const OPS = Object.fromEntries((CFG.operadoras || []).map(o => [o.id, o]));
const opKey = n => { const k = String(n || "").trim().toLowerCase(); return k || "sem"; };
const opNome = k => OPS[k]?.nome || (k === "sem" ? "Sem operadora" : k.replace(/\b\w/g, c => c.toUpperCase()));
const opCor = k => OPS[k]?.cor || "#7C8594";
const LIM_RETIRADO = CFG.limites?.retiradoDias ?? 7, LIM_EQUIPE = CFG.limites?.equipeDias ?? 15;

const TIPOS = {
  entrada:      {label:"Entrada no estoque",   desc:"chip novo ou reentrada",        status:"estoque",  from:null, fields:["regional","linha","operadora","apn","ns","obs"], ns:"NF / lote / pedido", reg:"Estoque da regional", regReq:true},
  saida:        {label:"Saída para equipe",    desc:"estoque → equipe",              status:"equipe",   from:["estoque","equipe"], fields:["equipe","regional","obs"], reg:"Regional da equipe"},
  instalacao:   {label:"Instalação",           desc:"chip colocado na remota",       status:"instalado",from:["estoque","equipe","retirado"], fields:["uc","remota","cidade","regional","equipe","ns","obs"], ns:"Nota de serviço", reg:"Regional"},
  remanejamento:{label:"Remanejamento",        desc:"tirou de um local e instalou em outro", status:"instalado", from:["instalado"], fields:["motivo","uc","remota","cidade","regional","equipe","ns","obs"], ns:"Nota de serviço", reg:"Destino — Regional", single:true, mot:["Sem sinal / sem comunicação","Sinal fraco / intermitente","Troca de operadora","UC desligada","Remota substituída"]},
  retirada:     {label:"Retirada",             desc:"tirado da remota, sem reinstalar", status:"retirado", from:["instalado"], fields:["motivo","equipe","ns","obs"], ns:"Nota de serviço", mot:["Troca de chip","Sem sinal / sem comunicação","Remota substituída","Troca de operadora","UC desligada","Chip danificado"]},
  devolucao:    {label:"Devolução ao estoque", desc:"equipe → estoque",              status:"estoque",  from:["equipe","retirado"], fields:["regional","equipe","obs"], reg:"Devolver ao estoque da regional"},
  transferencia:{label:"Transferência",        desc:"estoque de uma regional para outra", status:"estoque", from:["estoque"], fields:["regional","ns","obs"], ns:"Documento", reg:"Estoque de destino", regReq:true},
  operadora:    {label:"Devolução à operadora",desc:"saiu do inventário",            status:"devolvido",from:["estoque","retirado","equipe","baixado"], fields:["motivo","ns","obs"], ns:"Protocolo", mot:["Cancelamento de linha","Chip com defeito","Troca de operadora"]},
  baixa:        {label:"Baixa",                desc:"defeito, perda ou furto",       status:"baixado",  from:["estoque","equipe","retirado","instalado"], fields:["motivo","obs"], mot:["Defeito","Perda","Furto / vandalismo","Queimado"]}
};
const GRUPOS = [
  {k:"entrada",label:"Entradas",tipos:["entrada"],c:"--c1"},
  {k:"saida",label:"Saídas p/ equipe",tipos:["saida"],c:"--c2"},
  {k:"instalacao",label:"Instalações",tipos:["instalacao"],c:"--c3"},
  {k:"remanejamento",label:"Remanejamentos",tipos:["remanejamento"],c:"--c4"},
  {k:"retirada",label:"Retiradas",tipos:["retirada"],c:"--c5"},
  {k:"devolucao",label:"Devoluções ao estoque",tipos:["devolucao"],c:"--c6"},
  {k:"transferencia",label:"Transferências",tipos:["transferencia"],c:"--c7"},
  {k:"saiu",label:"Dev. operadora / baixas",tipos:["operadora","baixa"],c:"--c8"}
];
const GRUPO_DE = {}; GRUPOS.forEach(g => g.tipos.forEach(t => GRUPO_DE[t] = g));
const STATUS = {
  estoque:  {label:"Em estoque", c:"--s-estoque"},
  equipe:   {label:"Com equipe", c:"--s-equipe"},
  instalado:{label:"Instalado",  c:"--s-instalado"},
  retirado: {label:"Retirado – aguardando devolução", short:"Retirado", c:"--s-retirado"},
  devolvido:{label:"Devolvido à operadora", short:"Dev. operadora", c:"--s-devolvido"},
  baixado:  {label:"Baixado", c:"--s-baixado"}
};
const ATIVOS = ["estoque","equipe","instalado","retirado"];
const PAPEIS = {admin:"Administrador", leitor:"Leitor", pendente:"Pendente", bloqueado:"Bloqueado"};

/* ---------- Estado ---------- */
const S = {real:{chips:new Map(),movs:[]}, demoData:null, demo:false, store:null, user:null, perfil:null, canWrite:false,
  tab:"painel", fStatus:"", tipo:"instalacao", usuarios:[], subs:[], dataSubs:null, pend:{chips:false,movs:false}, carregado:false};
const F = {reg:"", op:"", per:"mes", de:"", ate:""};
const D = () => S.demo ? S.demoData : S.real;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); };
const addDays = (s,n) => new Date(Date.parse(s)+n*864e5).toISOString().slice(0,10);
const fmtD = s => s ? s.slice(8,10)+"/"+s.slice(5,7)+"/"+s.slice(0,4) : "—";
const daysSince = s => s ? Math.max(0,Math.floor((Date.parse(today())-Date.parse(s))/864e5)) : 0;
const normIccid = s => String(s||"").replace(/\D/g,"");
const regNome = id => REG[id]?.nome || id || "—";
const regCurto = id => REG[id]?.curto || id || "—";
const isMobile = () => matchMedia("(max-width:760px)").matches;
const pill = st => { const m=STATUS[st]||{label:st||"—",c:"--muted"}; return `<span class="pill" style="--c:var(${m.c})">${esc(m.short||m.label)}</span>`; };
const tipoTag = t => `<span class="pill" style="--c:var(${GRUPO_DE[t]?.c||"--muted"})">${esc(TIPOS[t]?.label||t)}</span>`;
const SIM = `<svg viewBox="0 0 14 18" width="11" height="14" aria-hidden="true"><path d="M2 .8h6.6L13.2 5.4V16a1.2 1.2 0 0 1-1.2 1.2H2A1.2 1.2 0 0 1 .8 16V2A1.2 1.2 0 0 1 2 .8z" fill="var(--c)"/><rect x="3.4" y="8" width="7.2" height="6.4" rx="1" fill="var(--surface)" opacity=".9"/></svg>`;
const logoImg = (k, h) => `<img src="${esc(OPS[k].logo)}" alt="${esc(opNome(k))}" style="height:${OPS[k].alturaLogo ? OPS[k].alturaLogo + (h||0) : 16 + (h||0)}px;width:auto;display:block${OPS[k].alturaLogo?";margin-block:-2px":""}">`;
const opBadge = n => {
  if(!n) return `<span class="muted">—</span>`;
  const k=opKey(n);
  if(OPS[k]?.logo) return `<span class="opb lg" title="${esc(opNome(k))}">${logoImg(k)}</span>`;
  return `<span class="opb" style="--c:${opCor(k)}">${SIM}${esc(opNome(k))}</span>`;
};
const td = (label, html, cls="") => `<td data-label="${esc(label)}"${cls?` class="${cls}"`:""}>${html}</td>`;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true,4200); }

/* ---------- Filtros globais ---------- */
function regMatch(r){ const f=F.reg; if(!f) return true; if(f.startsWith("sup:")) return REG[r]?.sup===f.slice(4); return r===f; }
const chipOk = (ch, ign={}) => (ign.reg||regMatch(ch.regional)) && (ign.op||!F.op||opKey(ch.operadora)===F.op);
const perOk = m => (!F.de||m.data>=F.de)&&(!F.ate||m.data<=F.ate);
const movOk = (m, ign={}) => perOk(m) && (ign.reg||regMatch(m.regional)||(m.regOrig&&regMatch(m.regOrig))||(m.orig?.regional&&regMatch(m.orig.regional))) && (ign.op||!F.op||opKey(m.operadora)===F.op);
function calcPeriodo(){
  const t=today(), y=t.slice(0,4), mo=t.slice(0,7);
  if(F.per==="custom") return;
  if(F.per==="7"){F.de=addDays(t,-6);F.ate=t;}
  else if(F.per==="30"){F.de=addDays(t,-29);F.ate=t;}
  else if(F.per==="90"){F.de=addDays(t,-89);F.ate=t;}
  else if(F.per==="mes"){F.de=mo+"-01";F.ate=t;}
  else if(F.per==="mesant"){ const d=new Date(Date.parse(mo+"-01")-864e5).toISOString().slice(0,10); F.de=d.slice(0,7)+"-01"; F.ate=d; }
  else if(F.per==="ano"){F.de=y+"-01-01";F.ate=t;}
  else {F.de="";F.ate="";}
}
function filtroTexto(){
  const r = !F.reg ? "Todas as regionais" : F.reg.startsWith("sup:") ? "Superintendência "+F.reg.slice(4) : "Regional "+regNome(F.reg);
  const o = F.op ? opNome(F.op) : "Todas as operadoras";
  const p = F.de||F.ate ? `${fmtD(F.de)} a ${fmtD(F.ate)}` : "Todo o histórico";
  return {r,o,p};
}
function renderFilterBar(){
  const b=(val,label,cls="")=>`<button type="button" class="${cls}" data-freg="${val}" aria-pressed="${F.reg===val}">${esc(label)}</button>`;
  $("segAll").innerHTML=b("","Todas");
  $("segSups").innerHTML=SUPS.map(s=>`<div class="seg">${b("sup:"+s,s,"sup")}${REGIONAIS.filter(r=>r.sup===s).map(r=>b(r.id,r.curto)).join("")}</div>`).join("");
  const ops=new Set(Object.keys(OPS)); for(const ch of D().chips.values()) if(ch.operadora) ops.add(opKey(ch.operadora));
  $("segOp").innerHTML=`<button type="button" data-fop="" aria-pressed="${!F.op}">Todas</button>`+[...ops].map(k=>`<button type="button" data-fop="${esc(k)}" aria-pressed="${F.op===k}" title="${esc(opNome(k))}" style="--c:${opCor(k)}">${OPS[k]?.logo?`<span class="lgw">${logoImg(k,-1)}</span>`:SIM+esc(opNome(k))}</button>`).join("");
  $("perSel").value=F.per; $("perCustom").hidden=F.per!=="custom";
  if(F.per==="custom"){ $("fDe").value=F.de; $("fAte").value=F.ate; }
  const t=filtroTexto();
  $("fText").innerHTML = isMobile()
    ? `<b>${esc(F.reg?(REG[F.reg]?.curto||F.reg.slice(4)):"Todas regionais")}</b> · <b>${esc(F.op?opNome(F.op):"Todas operadoras")}</b> · ${esc(t.p)}`
    : `Mostrando <b>${esc(t.r)}</b> · <b>${esc(t.o)}</b> · movimentações de <b>${esc(t.p)}</b>`;
  $("btnLimpar").hidden=!(F.reg||F.op||F.per!=="mes");
}
$("filterbar").addEventListener("click",e=>{
  const r=e.target.closest("[data-freg]"); if(r){ F.reg=r.dataset.freg; renderAll(); return; }
  const o=e.target.closest("[data-fop]"); if(o){ F.op=o.dataset.fop; renderAll(); return; }
});
$("btnFiltros").addEventListener("click",()=>{ const fb=$("filterbar"); const open=!fb.classList.contains("open"); fb.classList.toggle("open",open); $("btnFiltros").setAttribute("aria-expanded",open); $("btnFiltros").textContent=open?"Fechar":"Filtros"; });
$("perSel").addEventListener("change",()=>{ F.per=$("perSel").value; if(F.per==="custom"){ if(!F.de) F.de=addDays(today(),-29); if(!F.ate) F.ate=today(); } calcPeriodo(); renderAll(); });
["fDe","fAte"].forEach(id=>$(id).addEventListener("change",()=>{ F.de=$("fDe").value; F.ate=$("fAte").value; renderAll(); }));
$("btnLimpar").addEventListener("click",()=>{ F.reg="";F.op="";F.per="mes";calcPeriodo();renderAll(); });

/* ---------- Regra de movimentação ---------- */
function applyMove(atual, t, d, ln){
  const base = atual ? {...atual, local: atual.local?{...atual.local}:null} : {iccid:ln.iccid,linha:"",operadora:"",apn:"",regional:"",equipe:"",criadoEm:d.data};
  const mov = {tipo:t, data:d.data, ts:d.ts||new Date().toISOString(), iccid:base.iccid, porUid:d.porUid||"", porNome:d.porNome||""};
  const regAnt = base.regional||"", eqAnt = base.equipe||"";
  switch(t){
    case "entrada": base.linha=ln.linha||d.linha||base.linha||""; base.operadora=ln.operadora||d.operadora||base.operadora||""; base.apn=d.apn||base.apn||""; base.regional=d.regional; base.local=null; base.equipe=""; base.motivo=""; break;
    case "saida": base.equipe=d.equipe||""; base.local=null; if(d.regional) base.regional=d.regional; break;
    case "devolucao": base.equipe=""; base.local=null; base.regional=d.regional||regAnt; if(base.regional!==regAnt) mov.regOrig=regAnt; break;
    case "transferencia": base.regional=d.regional; mov.regOrig=regAnt; break;
    case "instalacao": base.local={uc:d.uc||"",remota:d.remota||"",cidade:d.cidade||""}; base.regional=d.regional||regAnt; base.equipe=d.equipe||eqAnt; base.motivo=""; break;
    case "remanejamento": mov.orig={uc:base.local?.uc||"",remota:base.local?.remota||"",cidade:base.local?.cidade||"",regional:regAnt}; base.ultimoLocal={...mov.orig}; base.local={uc:d.uc||"",remota:d.remota||"",cidade:d.cidade||""}; base.regional=d.regional||regAnt; base.equipe=d.equipe||eqAnt; base.motivo=""; break;
    case "retirada": base.ultimoLocal=base.local?{...base.local,regional:regAnt}:null; base.local=null; base.equipe=d.equipe||eqAnt; base.motivo=d.motivo||""; { const l=base.ultimoLocal||{}; Object.assign(mov,{uc:l.uc||"",remota:l.remota||"",cidade:l.cidade||""}); } break;
    case "operadora": case "baixa": base.local=null; base.equipe=""; base.motivo=d.motivo||""; break;
  }
  base.status=TIPOS[t].status; base.desde=d.data; base.atualizadoEm=mov.ts;
  if(t==="instalacao"||t==="remanejamento") Object.assign(mov,{uc:d.uc||"",remota:d.remota||"",cidade:d.cidade||""});
  const eqMov = d.equipe || (["retirada","instalacao","remanejamento","devolucao"].includes(t) ? eqAnt : "");
  Object.assign(mov,{regional:base.regional||"",linha:base.linha||"",operadora:base.operadora||"",equipe:eqMov,ns:d.ns||"",motivo:d.motivo||"",obs:d.obs||""});
  return {chip:base, mov};
}

/* ---------- Dados de exemplo ---------- */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function gerarExemplo(){
  const rnd=mulberry32(20261026), pick=a=>a[Math.floor(rnd()*a.length)], num=(a,b)=>a+Math.floor(rnd()*(b-a+1));
  const chips=new Map(), movs=[]; const T=today(); const span=150;
  const nomesOps=Object.values(OPS).map(o=>o.nome);
  const opsW=nomesOps.length ? [nomesOps[0],nomesOps[0],nomesOps[0],nomesOps[1],nomesOps[1],nomesOps[2],nomesOps[2],nomesOps[3]||nomesOps[0]] : ["Vivo"];
  let n=0;
  for(const R of REGIONAIS){
    const equipes=[1,2,3].map(i=>`Equipe ${R.curto} 0${i}`);
    const qtd=num(40,64);
    for(let i=0;i<qtd;i++){
      n++; const iccid="8955"+String(10+n%7)+String(100000000000000+n*48271).slice(-14);
      const ln={iccid, linha:`(64) 9 ${num(8100,9999)}-${String(num(0,9999)).padStart(4,"0")}`, operadora:pick(opsW)};
      let ch=null, day=num(0,128);
      const ap=(t,d)=>{ day=Math.min(day,span); d.data=addDays(T,day-span); d.ts=new Date(Date.parse(d.data)+(8*3600+num(0,32000))*1000).toISOString(); d.porNome="Exemplo"; const r=applyMove(ch,t,d,ln); ch=r.chip; movs.push(r.mov); };
      const uc=()=>String(num(10000000,99999999)), rm=()=>"RM"+num(100000,999999), nsx=()=>"NS "+num(4100000,4199999);
      const cid=R.cidades?.length?R.cidades:[R.nome];
      ap("entrada",{regional:R.id, ns:"NF "+num(31000,31999), apn:"APN privada M2M"});
      if(rnd()>0.16){
        const eq=pick(equipes); day+=num(1,8); ap("saida",{equipe:eq});
        if(rnd()>0.12){
          day+=num(1,14); ap("instalacao",{uc:uc(),remota:rm(),cidade:pick(cid),regional:R.id,equipe:eq,ns:nsx()});
          const q=rnd();
          if(q<0.17){ day+=num(5,30); ap("remanejamento",{motivo:pick(["Sem sinal / sem comunicação","Sem sinal / sem comunicação","Sinal fraco / intermitente","Troca de operadora"]),uc:uc(),remota:rm(),cidade:pick(cid),regional:R.id,equipe:eq,ns:nsx()}); }
          else if(q<0.31){ day+=num(5,40); ap("retirada",{motivo:pick(TIPOS.retirada.mot),equipe:eq,ns:nsx()});
            if(rnd()<0.6){ day+=num(1,9); ap("devolucao",{equipe:eq,regional:R.id}); if(rnd()<0.3){ day+=num(2,10); ap("operadora",{motivo:"Chip com defeito",ns:"Prot. "+num(900000,999999)}); } } }
          else if(q<0.34){ day+=num(10,40); ap("baixa",{motivo:pick(TIPOS.baixa.mot)}); }
        }
      }
      if(ch.status==="estoque" && rnd()<0.12 && REGIONAIS.length>1){ day+=num(2,15); const dest=pick(REGIONAIS.filter(x=>x.id!==R.id)); ap("transferencia",{regional:dest.id,obs:"Reforço de estoque"}); }
      chips.set(iccid,ch);
    }
  }
  movs.forEach((m,i)=>m.id="ex"+i); sortMovs(movs);
  return {chips, movs};
}
function sortMovs(a){ a.sort((x,y)=> ((y.data||"")+(y.ts||"")).localeCompare((x.data||"")+(x.ts||""))); }
function setDemo(on){
  S.demo=on; if(on && !S.demoData) S.demoData=gerarExemplo();
  F.per = on ? "90" : "mes"; calcPeriodo();
  $("demoBar").hidden=!on; setMode(); applyRO(); renderAll();
}
$("btnDemo").addEventListener("click",()=>setDemo(true));
$("btnSairDemo").addEventListener("click",()=>setDemo(false));

/* ---------- Derivados ---------- */
function counts(list){ const c={}; for(const k in STATUS) c[k]=0; for(const ch of list) c[ch.status]=(c[ch.status]||0)+1; return c; }
const chipsF = (ign) => [...D().chips.values()].filter(ch=>chipOk(ch,ign));
const movsF = (ign) => D().movs.filter(m=>movOk(m,ign));
function locTxt(l){ return l ? [l.uc&&("UC "+l.uc), l.cidade, l.remota&&("remota "+l.remota)].filter(Boolean).join(" · ") : ""; }
function movLocal(m){ const d=locTxt(m); if(m.orig) return `${locTxt(m.orig)||"?"} → ${d||"?"}`; if(m.tipo==="transferencia") return `Estoque ${regCurto(m.regOrig)} → ${regCurto(m.regional)}`; return d; }
function movReg(m){ return m.regOrig && m.regOrig!==m.regional ? `${regCurto(m.regOrig)} → ${regCurto(m.regional)}` : (m.orig?.regional && m.orig.regional!==m.regional ? `${regCurto(m.orig.regional)} → ${regCurto(m.regional)}` : regCurto(m.regional)); }
function ondeEsta(ch){
  if(ch.status==="instalado") return locTxt(ch.local) || "Instalado";
  if(ch.status==="equipe") return ch.equipe ? "Com "+ch.equipe : "Com equipe";
  if(ch.status==="retirado") return [ch.ultimoLocal?.uc&&("Saiu da UC "+ch.ultimoLocal.uc), ch.equipe&&("com "+ch.equipe)].filter(Boolean).join(" · ") || "Retirado";
  if(ch.status==="estoque") return "Almoxarifado";
  return ch.motivo || "";
}
const nomePor = m => m.porNome || (S.demo ? "Exemplo" : "—");
function pendencias(list){
  const al=[];
  for(const ch of list){ const d=daysSince(ch.desde);
    if(ch.status==="retirado" && d>=LIM_RETIRADO) al.push({ch,d,txt:`Retirado há ${d} dias, ainda não voltou ao estoque`});
    if(ch.status==="equipe" && d>=LIM_EQUIPE) al.push({ch,d,txt:`Com ${ch.equipe||"equipe"} há ${d} dias sem instalação`}); }
  return al.sort((a,b)=>b.d-a.d);
}
function refreshLists(){
  const cid=new Set(), eq=new Set();
  REGIONAIS.forEach(r=>(r.cidades||[]).forEach(c=>cid.add(c)));
  for(const m of D().movs){ if(m.cidade)cid.add(m.cidade); if(m.equipe)eq.add(m.equipe); }
  $("dlCid").innerHTML=[...cid].sort().map(v=>`<option value="${esc(v)}">`).join("");
  $("dlEq").innerHTML=[...eq].sort().map(v=>`<option value="${esc(v)}">`).join("");
  $("dlOp").innerHTML=Object.values(OPS).map(o=>`<option value="${esc(o.nome)}">`).join("");
}

/* ---------- Gráficos ---------- */
const charts={};
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function rgba(hex,a){ const h=hex.replace("#",""); const v=h.length===3?h.split("").map(x=>x+x).join(""):h; const n=parseInt(v,16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
function themeCharts(){
  if(!window.Chart) return;
  Chart.defaults.font.family = cssv("--f-body") || "system-ui";
  Chart.defaults.font.size = isMobile()?11:12;
  Chart.defaults.color = cssv("--muted");
  Chart.defaults.borderColor = cssv("--line");
}
function tooltip(){ return {backgroundColor:cssv("--ink"),titleColor:cssv("--bg"),bodyColor:cssv("--bg"),footerColor:cssv("--bg"),padding:10,cornerRadius:6,boxPadding:4,usePointStyle:true}; }
function legend(show=true){ return {display:show,position:"bottom",labels:{boxWidth:10,boxHeight:10,usePointStyle:true,pointStyle:"rectRounded",padding:isMobile()?10:14,color:cssv("--ink")}}; }
function draw(id, ok, cfgFn, h){
  const cv=$(id); if(!cv) return; const box=cv.parentElement; const nd=box.querySelector(".nodata");
  if(h) box.style.height=h+"px";
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
  if(!window.Chart){ nd.hidden=false; nd.textContent="Não foi possível carregar os gráficos."; cv.hidden=true; return; }
  nd.hidden=ok; cv.hidden=!ok;
  if(ok) charts[id]=new Chart(cv, cfgFn());
}
const pointer = (e,els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
function barOpts({stacked=false, horizontal=false, legendOn=true, onClick=null, tipFooter=null}={}){
  const grid={color:rgba(cssv("--line")||"#888888",0.7),drawTicks:false};
  const valAx={stacked, beginAtZero:true, grid, border:{display:false}, ticks:{precision:0,padding:6}};
  const catAx={stacked, grid:{display:false}, border:{color:cssv("--line")}, ticks:{padding:6,color:cssv("--ink"),autoSkip:true,maxRotation:0}};
  return {responsive:true, maintainAspectRatio:false, animation:{duration:reduceMotion?0:350}, indexAxis:horizontal?"y":"x",
    interaction:{mode:"index",intersect:false},
    scales: horizontal ? {x:valAx,y:catAx} : {x:catAx,y:valAx},
    plugins:{legend:legend(legendOn), tooltip:{...tooltip(), callbacks: tipFooter?{footer:tipFooter}:{}}},
    onHover: onClick?pointer:undefined, onClick};
}
const barDs = (label, data, color, extra={}) => ({label, data, backgroundColor:color, borderWidth:0, borderRadius:4, borderSkipped:false, maxBarThickness:46, ...extra});
function bucketize(list){
  let de=F.de, ate=F.ate||today();
  if(!de){ de = list.length ? list.reduce((a,m)=>m.data<a?m.data:a, ate) : addDays(ate,-29); }
  const span=(Date.parse(ate)-Date.parse(de))/864e5;
  const mode = span<=35 ? "dia" : span<=200 ? "semana" : "mes";
  const keyOf = s => { if(mode==="dia") return s; if(mode==="mes") return s.slice(0,7); const d=new Date(Date.parse(s)); const w=(d.getUTCDay()+6)%7; return addDays(s,-w); };
  const keys=[]; let cur=keyOf(de);
  const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  while(cur<=ate && keys.length<400){ keys.push(cur); if(mode==="dia") cur=addDays(cur,1); else if(mode==="semana") cur=addDays(cur,7); else { const y=+cur.slice(0,4), m=+cur.slice(5,7); cur = m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; } }
  const label = k => mode==="mes" ? MES[+k.slice(5,7)-1]+"/"+k.slice(2,4) : (mode==="semana"?"sem ":"")+k.slice(8,10)+"/"+k.slice(5,7);
  return {keys, labels:keys.map(label), keyOf, mode};
}
function timelineChart(id, hintId, list){
  const b=bucketize(list); const idx=Object.fromEntries(b.keys.map((k,i)=>[k,i]));
  const ds=GRUPOS.map(g=>({g, data:new Array(b.keys.length).fill(0)}));
  for(const m of list){ const gi=GRUPOS.indexOf(GRUPO_DE[m.tipo]); const i=idx[b.keyOf(m.data)]; if(gi>=0&&i!=null) ds[gi].data[i]++; }
  const used=ds.filter(d=>d.data.some(v=>v));
  $(hintId).textContent = list.length ? `${list.length} movimentações · por ${b.mode}` : "";
  draw(id, list.length>0, ()=>({type:"bar", data:{labels:b.labels, datasets:used.map(d=>barDs(d.g.label,d.data,cssv(d.g.c),{maxBarThickness:34}))},
    options:barOpts({stacked:true, tipFooter:items=>"Total: "+items.reduce((s,i)=>s+i.parsed.y,0)})}), isMobile()?300:null);
}
function regStatusChart(id, horizontal, clickable){
  const list=chipsF({reg:true});
  const ds=ATIVOS.map(st=>({st, data:REGIONAIS.map(r=>list.filter(ch=>ch.regional===r.id&&ch.status===st).length)}));
  const has=ds.some(d=>d.data.some(v=>v));
  const sel = r => !F.reg || regMatch(r.id);
  draw(id, has, ()=>({type:"bar", data:{labels:REGIONAIS.map(r=>r.curto), datasets:ds.map(d=>{ const c=cssv(STATUS[d.st].c); return barDs(STATUS[d.st].short||STATUS[d.st].label, d.data, REGIONAIS.map(r=>sel(r)?c:rgba(c,.22))); })},
    options:barOpts({stacked:true, horizontal, tipFooter:items=>"Total: "+items.reduce((s,i)=>s+(horizontal?i.parsed.x:i.parsed.y),0),
      onClick: clickable ? (e,els)=>{ if(!els.length) return; const r=REGIONAIS[els[0].index]; F.reg = F.reg===r.id ? "" : r.id; renderAll(); } : null})}));
}
function opsChart(id, stackedStatus){
  const list=chipsF({op:true}).filter(ch=>ATIVOS.includes(ch.status));
  const cnt=k=>list.filter(c=>opKey(c.operadora)===k).length;
  const keys=[...new Set(list.map(ch=>opKey(ch.operadora)))].sort((a,b)=>cnt(b)-cnt(a));
  const sel = k => !F.op || F.op===k;
  const onClick=(e,els)=>{ if(!els.length) return; const k=keys[els[0].index]; F.op = F.op===k ? "" : k; renderAll(); };
  if(stackedStatus){
    draw(id, keys.length>0, ()=>({type:"bar", data:{labels:keys.map(opNome), datasets:ATIVOS.map(st=>{ const c=cssv(STATUS[st].c); return barDs(STATUS[st].short||STATUS[st].label, keys.map(k=>list.filter(ch=>opKey(ch.operadora)===k&&ch.status===st).length), keys.map(k=>sel(k)?c:rgba(c,.22))); })},
      options:barOpts({stacked:true, horizontal:true, onClick, tipFooter:items=>"Total: "+items.reduce((s,i)=>s+i.parsed.x,0)})}), Math.max(200, keys.length*44+80));
  } else {
    draw(id, keys.length>0, ()=>({type:"bar", data:{labels:keys.map(opNome), datasets:[barDs("Chips ativos", keys.map(cnt), keys.map(k=>sel(k)?opCor(k):rgba(opCor(k),.25)))]},
      options:barOpts({horizontal:true, legendOn:false, onClick})}));
  }
}
function hbarSimple(id, pairs, color, label){
  draw(id, pairs.length>0, ()=>({type:"bar", data:{labels:pairs.map(p=>p[0]), datasets:[barDs(label, pairs.map(p=>p[1]), cssv(color))]}, options:barOpts({horizontal:true, legendOn:false})}), Math.max(180, pairs.length*32+50));
}
const centerText = {id:"centerText", afterDraw(c){ const t=c.config.options.plugins.centerText; if(!t) return; const {ctx,chartArea:a}=c; const x=(a.left+a.right)/2, y=(a.top+a.bottom)/2; ctx.save(); ctx.textAlign="center"; ctx.fillStyle=cssv("--ink"); ctx.font=`700 30px ${cssv("--f-display")}`; ctx.fillText(t.big, x, y+4); ctx.fillStyle=cssv("--muted"); ctx.font=`500 11px ${cssv("--f-body")}`; ctx.fillText(t.small, x, y+22); ctx.restore(); }};

/* ---------- Render ---------- */
let rafPend=false;
function renderAll(){ if(rafPend) return; rafPend=true; requestAnimationFrame(()=>{ rafPend=false; renderNow(); }); }
function renderNow(){
  if($("app").hidden) return;
  calcPeriodo(); themeCharts(); refreshLists(); renderFilterBar();
  const cf=chipsF(), c=counts(cf), nm=movsF().length;
  $("cntEst").textContent=c.estoque||0; $("cntChips").textContent=cf.length; $("cntMovs").textContent=nm;
  ["cntEst","cntChips","cntMovs"].forEach(id=>$(id).classList.toggle("zero", $(id).textContent==="0"));
  $("heroEmpty").hidden = S.demo || !S.carregado || D().chips.size>0;
  if(S.tab==="painel") renderPainel(); else if(S.tab==="estoque") renderEstoque(); else if(S.tab==="chips") renderChips(); else if(S.tab==="movs") renderMovs(); else if(S.tab==="rel") renderRel(); else renderUsuarios();
}
function renderPainel(){
  const cf=chipsF(), c=counts(cf), mv=movsF();
  const per = {}; GRUPOS.forEach(g=>per[g.k]=0); mv.forEach(m=>{ const g=GRUPO_DE[m.tipo]; if(g) per[g.k]++; });
  const sub = {estoque:`${per.entrada} entradas no período`, equipe:`${per.saida} saídas no período`, instalado:`${per.instalacao} instalações no período`, retirado:`${per.retirada} retiradas no período`, devolvido:"fora do inventário", baixado:"fora do inventário"};
  $("statusbar").innerHTML=Object.entries(STATUS).map(([k,m])=>`<button class="stat" type="button" data-st="${k}" style="--c:var(${m.c})"><b>${c[k]||0}</b><span>${esc(m.short||m.label)}</span><em>${esc(sub[k])}</em></button>`).join("");
  const ativos=ATIVOS.reduce((s,k)=>s+(c[k]||0),0);
  draw("pDonut", cf.length>0, ()=>{ const keys=Object.keys(STATUS).filter(k=>c[k]); return {type:"doughnut",
    data:{labels:keys.map(k=>STATUS[k].short||STATUS[k].label), datasets:[{data:keys.map(k=>c[k]), backgroundColor:keys.map(k=>cssv(STATUS[k].c)), borderColor:cssv("--surface"), borderWidth:2, hoverOffset:6}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:"64%", animation:{duration:reduceMotion?0:350},
      plugins:{legend:{...legend(), position: innerWidth<640?"bottom":"right"}, tooltip:{...tooltip(), callbacks:{label:i=>` ${i.label}: ${i.parsed} (${Math.round(i.parsed/cf.length*100)}%)`}}, centerText:{big:String(ativos), small:"chips ativos"}},
      onHover:pointer, onClick:(e,els)=>{ if(!els.length) return; S.fStatus=keys[els[0].index]; setTab("chips"); }},
    plugins:[centerText]}; }, isMobile()?300:null);
  regStatusChart("pReg", false, true);
  timelineChart("pTime","pTimeHint", mv);
  opsChart("pOps", false);
  const al=pendencias(cf);
  $("alertHint").textContent = al.length ? `${al.length} chip(s)` : "";
  $("alerts").innerHTML = !cf.length ? `<div class="empty">Sem chips para os filtros selecionados.</div>`
    : al.length ? al.slice(0,30).map(a=>`<button class="alert" type="button" data-iccid="${esc(a.ch.iccid)}"><span><span style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">${pill(a.ch.status)}${opBadge(a.ch.operadora)}<span class="reg">${esc(regCurto(a.ch.regional))}</span></span><span class="mono">${esc(a.ch.iccid)}</span><br><span class="muted">${esc(a.txt)}</span></span><span class="days" style="color:var(${a.d>=30?"--danger":"--warn"})">${a.d}d</span></button>`).join("")
    : `<div class="empty"><b>Sem pendências</b>Nenhum chip retirado há mais de ${LIM_RETIRADO} dias ou parado com equipe há mais de ${LIM_EQUIPE} dias.</div>`;
  $("feed").innerHTML = mv.length ? mv.slice(0,9).map(m=>`<li data-iccid="${esc(m.iccid)}" style="cursor:pointer"><span class="muted num">${fmtD(m.data)}</span><span>${tipoTag(m.tipo)} <span class="mono">${esc(m.iccid)}</span><br><span class="muted">${esc([regCurto(m.regional), movLocal(m), m.equipe].filter(Boolean).join(" · "))}</span></span></li>`).join("") : `<li><span></span><span class="muted">Nenhuma movimentação no período.</span></li>`;
}
function renderEstoque(){
  const all=chipsF({reg:true});
  $("regCards").innerHTML=REGIONAIS.map(r=>{
    const l=all.filter(ch=>ch.regional===r.id), est=l.filter(ch=>ch.status==="estoque");
    const eq=l.filter(ch=>ch.status==="equipe").length, ret=l.filter(ch=>ch.status==="retirado").length, ins=l.filter(ch=>ch.status==="instalado").length;
    const byOp={}; est.forEach(ch=>{const k=opKey(ch.operadora); byOp[k]=(byOp[k]||0)+1;});
    const ops=Object.entries(byOp).sort((a,b)=>b[1]-a[1]);
    const on=F.reg===r.id, dim=F.reg && !regMatch(r.id);
    return `<button class="regcard${dim?" dim":""}" type="button" data-regcard="${r.id}" aria-pressed="${on}">
      <span class="sup">${esc(r.sup)}</span><span class="nm">${esc(r.nome)}</span>
      <span class="big">${est.length}<small>em estoque</small></span>
      <span class="stack">${est.length?ops.map(([k,v])=>`<i style="--c:${opCor(k)};width:${(v/est.length*100).toFixed(1)}%"></i>`).join(""):""}</span>
      <span class="oplist">${ops.length?ops.map(([k,v])=>`<span style="--c:${opCor(k)}">${esc(opNome(k))} ${v}</span>`).join(""):"Sem chips em estoque"}</span>
      <span class="sub"><span>${eq} com equipes</span><span>${ret} a devolver</span><span>${ins} instalados</span></span></button>`;
  }).join("");
  const cf=chipsF(), c=counts(cf), mv=movsF(); const cnt=t=>mv.filter(m=>m.tipo===t).length;
  $("eKv").innerHTML=[["Em estoque",c.estoque,"--s-estoque"],["Com equipes",c.equipe,"--s-equipe"],["Retirados a devolver",c.retirado,"--s-retirado"],["Entradas no período",cnt("entrada"),"--c1"],["Saídas no período",cnt("saida"),"--c2"],["Devoluções no período",cnt("devolucao"),"--c6"],["Transferências no período",cnt("transferencia"),"--c7"]].map(([l,v,col])=>`<div style="--c:var(${col})"><b>${v||0}</b><span>${l}</span></div>`).join("");
  const op={};
  for(const ch of cf){ if(!ATIVOS.includes(ch.status)) continue; const k=opKey(ch.operadora); op[k]=op[k]||{estoque:0,equipe:0,retirado:0,instalado:0}; op[k][ch.status]++; }
  const ops=Object.entries(op).sort((a,b)=>b[1].estoque-a[1].estoque);
  $("tbEstOp").innerHTML = ops.length ? ops.map(([k,v])=>`<tr>${td("",opBadge(opNome(k)),"lead")}${td("Estoque",`<b>${v.estoque}</b>`,"r num")}${td("Com equipes",v.equipe,"r num")}${td("Retirados",v.retirado,"r num")}${td("Instalados",v.instalado,"r num")}</tr>`).join("") : `<tr><td colspan="5" class="muted">Sem chips para os filtros selecionados.</td></tr>`;
  const eq={};
  for(const ch of cf){ if(ch.status!=="equipe"&&ch.status!=="retirado") continue; const e=ch.equipe||"Sem equipe informada"; eq[e]=eq[e]||{equipe:0,retirado:0,max:0,reg:ch.regional}; eq[e][ch.status]++; eq[e].max=Math.max(eq[e].max,daysSince(ch.desde)); }
  const eqs=Object.entries(eq).sort((a,b)=>(b[1].equipe+b[1].retirado)-(a[1].equipe+a[1].retirado));
  $("tbEstEq").innerHTML = eqs.length ? eqs.map(([e,v])=>`<tr class="click" data-eq="${esc(e)}">${td("",esc(e),"lead")}${td("Regional",`<span class="reg">${esc(regCurto(v.reg))}</span>`)}${td("Com equipe",v.equipe,"r num")}${td("A devolver",v.retirado?`<b style="color:var(--danger)">${v.retirado}</b>`:0,"r num")}${td("Mais antigo",v.max+" dias","r num")}</tr>`).join("") : `<tr><td colspan="5" class="muted">Nenhum chip com equipes.</td></tr>`;
  const q=$("qEst").value.trim().toLowerCase();
  const list=cf.filter(ch=>ch.status==="estoque"&&(!q||[ch.iccid,ch.linha].join(" ").toLowerCase().includes(q))).sort((a,b)=>(a.desde||"").localeCompare(b.desde||""));
  $("tbEst").innerHTML = list.length ? list.slice(0,500).map(ch=>`<tr class="click" data-iccid="${esc(ch.iccid)}">${td("",`<span class="mono">${esc(ch.iccid)}</span>`,"lead")}${td("Linha",esc(ch.linha||"—"),"num")}${td("Operadora",opBadge(ch.operadora))}${td("Regional",`<span class="reg">${esc(regCurto(ch.regional))}</span>`)}${td("APN / plano",esc(ch.apn||"—"))}${td("No estoque desde",fmtD(ch.desde),"num")}${td("Dias",daysSince(ch.desde),"r num")}</tr>`).join("")
    : `<tr><td colspan="7"><div class="empty" style="border:0">${D().chips.size?"Nenhum chip em estoque para os filtros selecionados.":"<b>Almoxarifado vazio</b>Use “+ Entrada no estoque” para cadastrar os chips recebidos."}</div></td></tr>`;
  const t=filtroTexto();
  $("footEst").textContent=`${list.length} chip(s) em estoque · ${t.r} · ${t.o}. Os mais antigos aparecem primeiro.`;
}
function renderChips(){
  const cf=chipsF(), c=counts(cf);
  $("fStatus").innerHTML=[["","Todos",null,cf.length],...Object.entries(STATUS).map(([k,m])=>[k,m.short||m.label,m.c,c[k]])].map(([k,l,col,n])=>`<button class="fchip" type="button" data-fst="${k}" aria-pressed="${S.fStatus===k}">${col?`<i style="--c:var(${col})"></i>`:""}${esc(l)} <span class="num">${n||0}</span></button>`).join("");
  const q=$("qChips").value.trim().toLowerCase();
  let list=cf.filter(ch=>!S.fStatus||ch.status===S.fStatus);
  if(q){ const qd=q.replace(/\D/g,""); list=list.filter(ch=>{ const hay=[ch.iccid,ch.linha,ch.operadora,ch.equipe,ch.local?.uc,ch.local?.remota,ch.local?.cidade,ch.ultimoLocal?.uc,regNome(ch.regional)].join(" ").toLowerCase(); return hay.includes(q)||(qd.length>=4&&String(ch.linha||"").replace(/\D/g,"").includes(qd)); }); }
  list.sort((a,b)=>(b.desde||"").localeCompare(a.desde||""));
  $("tbChips").innerHTML = list.length ? list.slice(0,500).map(ch=>`<tr class="click" data-iccid="${esc(ch.iccid)}">${td("",`<span class="mono">${esc(ch.iccid)}</span>`,"lead")}${td("Linha",esc(ch.linha||"—"),"num")}${td("Operadora",opBadge(ch.operadora))}${td("Situação",pill(ch.status))}${td("Regional",`<span class="reg">${esc(regCurto(ch.regional))}</span>`)}${td("Onde está",esc(ondeEsta(ch)||"—"))}${td("Desde",fmtD(ch.desde),"num")}</tr>`).join("")
    : `<tr><td colspan="7"><div class="empty" style="border:0">${D().chips.size?"Nenhum chip com esses filtros.":"<b>Nenhum chip cadastrado</b>Use “+ Nova movimentação” → Entrada no estoque."}</div></td></tr>`;
  $("footChips").textContent = list.length>500 ? `Mostrando 500 de ${list.length}. Refine a busca.` : `${list.length} chip(s). Toque num chip para ver o histórico e registrar ações.`;
}
function movRow(m, ultimaCol){
  return `<tr class="click" data-iccid="${esc(m.iccid)}">${td("",`<span class="num">${fmtD(m.data)}</span> ${tipoTag(m.tipo)}`,"lead")}${td("ICCID",`<span class="mono">${esc(m.iccid)}</span>`)}${td("Operadora",opBadge(m.operadora))}${td("Regional",`<span class="reg">${esc(movReg(m))}</span>`)}${td("Local / UC",esc(movLocal(m)||"—"),movLocal(m)?"":"vazio")}${td("Equipe",esc(m.equipe||"—"),m.equipe?"":"vazio")}${td("Documento",esc(m.ns||"—"),m.ns?"":"vazio")}${ultimaCol}</tr>`;
}
function renderMovs(){
  const q=$("qMovs").value.trim().toLowerCase(), t=$("fTipoMovs").value;
  let list=movsF().filter(m=>!t||m.tipo===t);
  if(q) list=list.filter(m=>[m.iccid,m.linha,m.uc,m.remota,m.cidade,m.equipe,m.ns,m.motivo,m.obs,m.orig?.uc,m.orig?.cidade].join(" ").toLowerCase().includes(q));
  $("tbMovs").innerHTML = list.length ? list.slice(0,400).map(m=>{ const mo=[m.motivo,m.obs].filter(Boolean).join(" — "); return movRow(m, td("Motivo / obs.",esc(mo||"—"),mo?"":"vazio")); }).join("")
    : `<tr><td colspan="8"><div class="empty" style="border:0">Nenhuma movimentação para os filtros e o período selecionados.</div></td></tr>`;
  $("footMovs").textContent = list.length>400 ? `Mostrando 400 de ${list.length}. Use a busca ou o relatório para ver tudo.` : `${list.length} movimentação(ões) no período.`;
}
const ehSemSinal = m => (m.tipo==="retirada"||m.tipo==="remanejamento") && /sinal|comunica/i.test(m.motivo||"");
function resumoTexto(){
  const cf=chipsF(), c=counts(cf), mv=movsF(), t=filtroTexto();
  const L=[(CFG.titulo||"Controle de Chips das Remotas").toUpperCase(), `${t.r} · ${t.o}`, `Período das movimentações: ${t.p}`, "", "Situação atual do inventário:"];
  for(const k in STATUS) L.push(`  • ${STATUS[k].label}: ${c[k]||0}`);
  L.push(`  Total cadastrado: ${cf.length}`);
  const regs=REGIONAIS.filter(r=>regMatch(r.id));
  if(regs.length>1){ L.push("","Estoque físico por regional:"); regs.forEach(r=>{ const l=cf.filter(ch=>ch.regional===r.id); L.push(`  • ${r.nome}: ${l.filter(ch=>ch.status==="estoque").length} em estoque · ${l.filter(ch=>ch.status==="equipe").length} com equipes · ${l.filter(ch=>ch.status==="instalado").length} instalados`); }); }
  L.push("", `Movimentações no período (${mv.length}):`);
  GRUPOS.forEach(g=>{ const n=mv.filter(m=>g.tipos.includes(m.tipo)).length; if(n) L.push(`  • ${g.label}: ${n}`); });
  if(!mv.length) L.push("  • Nenhuma");
  const motivos={}; mv.filter(m=>(m.tipo==="retirada"||m.tipo==="remanejamento")&&m.motivo).forEach(m=>motivos[m.motivo]=(motivos[m.motivo]||0)+1);
  if(Object.keys(motivos).length){ L.push("","Motivos de retirada / remanejamento:"); Object.entries(motivos).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>L.push(`  • ${k}: ${v}`)); }
  const ss=mv.filter(ehSemSinal);
  if(ss.length){ L.push("",`Locais com problema de sinal (${ss.length}):`); ss.slice(0,40).forEach(m=>{ const o=m.orig||m; L.push(`  • ${fmtD(m.data)} — ${locTxt(o)||"local não informado"} (${regCurto(o.regional||m.regional)})${m.tipo==="remanejamento"?` → remanejado para ${locTxt(m)||"?"}`:" → chip retirado"}`); }); if(ss.length>40) L.push(`  … e mais ${ss.length-40}`); }
  const al=pendencias(cf);
  L.push("","Pendências:",`  • Retirados há mais de ${LIM_RETIRADO} dias sem devolução: ${al.filter(a=>a.ch.status==="retirado").length}`,`  • Com equipe há mais de ${LIM_EQUIPE} dias sem instalação: ${al.filter(a=>a.ch.status==="equipe").length}`);
  L.push("",`Gerado em ${fmtD(today())}.`);
  return L.join("\n");
}
function renderRel(){
  const mv=movsF(), cf=chipsF(), t=filtroTexto();
  $("relCtx").textContent=`${t.r} · ${t.o} · ${t.p}`;
  $("rKv").innerHTML=`<div style="--c:var(--ink)"><b>${mv.length}</b><span>Movimentações</span></div>`+GRUPOS.map(g=>`<div style="--c:var(${g.c})"><b>${mv.filter(m=>g.tipos.includes(m.tipo)).length}</b><span>${esc(g.label)}</span></div>`).join("");
  timelineChart("rTime","rTimeHint", mv);
  const porG=GRUPOS.map(g=>({g,n:mv.filter(m=>g.tipos.includes(m.tipo)).length})).filter(x=>x.n);
  draw("rTipo", porG.length>0, ()=>({type:"bar", data:{labels:porG.map(x=>x.g.label), datasets:[barDs("Movimentações", porG.map(x=>x.n), porG.map(x=>cssv(x.g.c)))]}, options:barOpts({horizontal:true, legendOn:false})}), Math.max(200, porG.length*34+50));
  regStatusChart("rReg", true, true);
  const eq={}; cf.forEach(ch=>{ if(ch.status!=="equipe"&&ch.status!=="retirado") return; const e=ch.equipe||"Sem equipe"; eq[e]=eq[e]||{equipe:0,retirado:0}; eq[e][ch.status]++; });
  const eqs=Object.entries(eq).sort((a,b)=>(b[1].equipe+b[1].retirado)-(a[1].equipe+a[1].retirado)).slice(0,12);
  draw("rEq", eqs.length>0, ()=>({type:"bar", data:{labels:eqs.map(e=>e[0]), datasets:[barDs("Com equipe", eqs.map(e=>e[1].equipe), cssv("--s-equipe")), barDs("Retirados a devolver", eqs.map(e=>e[1].retirado), cssv("--s-retirado"))]},
    options:barOpts({stacked:true, horizontal:true})}), Math.max(200, eqs.length*34+80));
  opsChart("rOps", true);
  const cid={}; mv.filter(m=>(m.tipo==="instalacao"||m.tipo==="remanejamento")&&m.cidade).forEach(m=>cid[m.cidade]=(cid[m.cidade]||0)+1);
  hbarSimple("rCid", Object.entries(cid).sort((a,b)=>b[1]-a[1]).slice(0,10), "--c3", "Instalações");
  const mot={}; mv.filter(m=>(m.tipo==="retirada"||m.tipo==="remanejamento")&&m.motivo).forEach(m=>mot[m.motivo]=(mot[m.motivo]||0)+1);
  hbarSimple("rMot", Object.entries(mot).sort((a,b)=>b[1]-a[1]), "--c5", "Ocorrências");
  const ss=mv.filter(ehSemSinal);
  $("tbSinal").innerHTML = ss.length ? ss.slice(0,100).map(m=>{ const o=m.orig||m; return `<tr class="click" data-iccid="${esc(m.iccid)}">${td("",`<span class="num">${fmtD(m.data)}</span>`,"lead")}${td("Regional",`<span class="reg">${esc(regCurto(o.regional||m.regional))}</span>`)}${td("Origem",esc(locTxt(o)||"—"))}${td("Operadora",opBadge(m.operadora))}${td("Destino",m.tipo==="remanejamento"?esc(locTxt(m)||"—"):'<span class="muted">Retirado, sem reinstalação</span>')}</tr>`; }).join("") : `<tr><td colspan="5" class="muted">Nenhum caso de falta de sinal no período.</td></tr>`;
  $("rSummary").textContent=resumoTexto();
  const tp=$("rTipoSel").value; const list=mv.filter(m=>!tp||m.tipo===tp);
  $("tbRel").innerHTML = list.length ? list.slice(0,600).map(m=>movRow(m, td("Registrado por",esc(nomePor(m))))).join("")
    : `<tr><td colspan="8"><div class="empty" style="border:0">Nenhuma movimentação no período.</div></td></tr>`;
}
function renderUsuarios(){
  const us=[...S.usuarios].sort((a,b)=>{ const o={pendente:0,admin:1,leitor:2,bloqueado:3}; return (o[a.papel]??9)-(o[b.papel]??9) || (a.nome||"").localeCompare(b.nome||""); });
  const n=k=>us.filter(u=>u.papel===k).length;
  $("uKv").innerHTML=[["Pendentes",n("pendente"),"--warn"],["Administradores",n("admin"),"--accent"],["Leitores",n("leitor"),"--muted"],["Bloqueados",n("bloqueado"),"--danger"]].map(([l,v,c])=>`<div style="--c:var(${c})"><b>${v}</b><span>${l}</span></div>`).join("");
  $("tbUsers").innerHTML = us.length ? us.map(u=>{
    const eu=u.uid===S.user?.uid;
    const acoes = eu ? `<span class="muted">Você</span>` : u.papel==="pendente"
      ? `<span class="actions" style="justify-content:flex-end"><button class="btn small primary" type="button" data-papel="admin" data-uid="${esc(u.uid)}">Liberar como administrador</button><button class="btn small" type="button" data-papel="leitor" data-uid="${esc(u.uid)}">Liberar como leitor</button><button class="btn small danger" type="button" data-papel="bloqueado" data-uid="${esc(u.uid)}">Recusar</button></span>`
      : `<select class="uselect" data-uid="${esc(u.uid)}" aria-label="Acesso de ${esc(u.nome||u.email)}">${["admin","leitor","bloqueado"].map(p=>`<option value="${p}"${u.papel===p?" selected":""}>${PAPEIS[p]}</option>`).join("")}</select>`;
    return `<tr>${td("",esc(u.nome||"—"),"lead")}${td("E-mail",`<span class="mono">${esc(u.email||"—")}</span>`)}${td("Acesso",`<span class="papel ${esc(u.papel)}">${esc(PAPEIS[u.papel]||u.papel)}</span>`)}${td("Desde",fmtD((u.criadoEm||"").slice(0,10)),"num")}${td("Ações",acoes)}</tr>`;
  }).join("") : `<tr><td colspan="5" class="muted">Nenhum usuário.</td></tr>`;
}
$("tbUsers").addEventListener("click",async e=>{
  const b=e.target.closest("[data-papel]"); if(!b) return;
  try{ await S.store.setPapel(b.dataset.uid,b.dataset.papel); toast("Acesso atualizado."); }catch(err){ toast("Não foi possível alterar: "+(err?.message||"")); }
});
$("tbUsers").addEventListener("change",async e=>{
  const s=e.target.closest("select[data-uid]"); if(!s) return;
  try{ await S.store.setPapel(s.dataset.uid,s.value); toast("Acesso atualizado."); }catch(err){ toast("Não foi possível alterar: "+(err?.message||"")); }
});

/* ---------- Abas e eventos ---------- */
function setTab(t){
  S.tab=t;
  document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab===t));
  ["painel","estoque","chips","movs","rel","usuarios"].forEach(k=>$("tab-"+k).hidden = k!==t);
  try{ history.replaceState(null,"","#"+t); }catch(e){}
  window.scrollTo({top:0});
  renderAll();
}
$("tabs").addEventListener("click",e=>{ const b=e.target.closest("button[data-tab]"); if(b) setTab(b.dataset.tab); });
$("statusbar").addEventListener("click",e=>{ const b=e.target.closest("[data-st]"); if(!b)return; if(b.dataset.st==="estoque"){ setTab("estoque"); return; } S.fStatus=b.dataset.st; setTab("chips"); });
$("fStatus").addEventListener("click",e=>{ const b=e.target.closest("[data-fst]"); if(!b)return; S.fStatus=b.dataset.fst; renderChips(); });
$("regCards").addEventListener("click",e=>{ const b=e.target.closest("[data-regcard]"); if(!b)return; F.reg = F.reg===b.dataset.regcard ? "" : b.dataset.regcard; renderAll(); });
$("qChips").addEventListener("input",renderChips);
$("qEst").addEventListener("input",renderEstoque);
["qMovs","fTipoMovs"].forEach(id=>$(id).addEventListener("input",renderMovs));
$("rTipoSel").addEventListener("input",renderRel);
document.addEventListener("click",e=>{
  if(e.target.closest("[data-sair]")){ sair(); return; }
  if(e.target.closest("dialog")) { const c=e.target.closest("[data-close]"); if(c) c.closest("dialog").close(); return; }
  const n=e.target.closest("[data-novo]"); if(n){ openMov(n.dataset.novo); return; }
  const g=e.target.closest("[data-goto]"); if(g){ setTab(g.dataset.goto); return; }
  const q=e.target.closest("[data-eq]"); if(q){ $("qChips").value=q.dataset.eq==="Sem equipe informada"?"":q.dataset.eq; S.fStatus=""; setTab("chips"); return; }
  const r=e.target.closest("[data-iccid]"); if(r && !$("app").hidden) openChip(r.dataset.iccid);
});
let lastMobile=isMobile();
window.addEventListener("resize",()=>{ clearTimeout(window.__rz); window.__rz=setTimeout(()=>{ const m=isMobile(); if(m!==lastMobile){ lastMobile=m; renderAll(); } },200); });

/* ---------- Formulário de movimentação ---------- */
$("tipoBtns").innerHTML=Object.entries(TIPOS).map(([k,t])=>`<button class="tipo" type="button" data-tipo="${k}" aria-pressed="false" style="--c:var(${GRUPO_DE[k].c})">${esc(t.label)}<small>${esc(t.desc)}</small></button>`).join("");
const tipoOpts=Object.entries(TIPOS).map(([k,t])=>`<option value="${k}">${esc(t.label)}</option>`).join("");
$("fTipoMovs").innerHTML+=tipoOpts; $("rTipoSel").innerHTML+=tipoOpts;
$("m_regional").innerHTML=`<option value="">— selecione —</option>`+SUPS.map(s=>`<optgroup label="${esc(s)}">${REGIONAIS.filter(r=>r.sup===s).map(r=>`<option value="${esc(r.id)}">${esc(r.nome)}</option>`).join("")}</optgroup>`).join("");
function setTipo(t){
  S.tipo=t; const cfg=TIPOS[t];
  document.querySelectorAll("#tipoBtns .tipo").forEach(b=>b.setAttribute("aria-pressed", b.dataset.tipo===t));
  document.querySelectorAll("#fMov [data-fld]").forEach(l=>l.hidden=!cfg.fields.includes(l.dataset.fld));
  $("nsLabel").textContent=cfg.ns||"Documento";
  $("regLabel").textContent=(cfg.reg||"Regional")+(cfg.regReq?" *":"");
  document.querySelectorAll("#fMov .lt").forEach(sp=>sp.textContent=(t==="remanejamento"?"Destino — ":"")+sp.dataset.base);
  $("m_iccids").placeholder = t==="entrada" ? "Um por linha. Pode colar do Excel: ICCID ; linha ; operadora" : "Um ICCID por linha";
  $("dlMot").innerHTML=(cfg.mot||[]).map(v=>`<option value="${esc(v)}">`).join("");
  $("btnSalvarMov").textContent="Registrar "+cfg.label.toLowerCase();
  $("mResult").hidden=true; prefillReg(); updateIccidHint();
}
function prefillReg(){
  const ls=parseLinhas(); const ch = ls.length===1 ? D().chips.get(ls[0].iccid) : null;
  if(S.tipo==="transferencia"){ $("m_regional").value=""; return; }
  if(ch?.regional) $("m_regional").value=ch.regional;
  else if(REG[F.reg] && !$("m_regional").value) $("m_regional").value=F.reg;
}
$("tipoBtns").addEventListener("click",e=>{ const b=e.target.closest("[data-tipo]"); if(b) setTipo(b.dataset.tipo); });
function parseLinhas(){
  return $("m_iccids").value.split(/\n+/).map(l=>l.trim()).filter(Boolean).map(l=>{ const p=l.split(/[;\t]/).map(s=>s.trim()); return {iccid:normIccid(p[0]), linha:p[1]||"", operadora:p[2]||""}; }).filter(x=>x.iccid);
}
function updateIccidHint(){
  const ls=parseLinhas(); if(!ls.length){ $("iccidHint").textContent=""; return; }
  if(ls.length===1){ const ch=D().chips.get(ls[0].iccid); $("iccidHint").innerHTML = ch ? `Situação atual: ${pill(ch.status)} ${opBadge(ch.operadora)} <span class="reg">${esc(regCurto(ch.regional))}</span> · ${esc(ondeEsta(ch))}` : (S.tipo==="entrada"?"Chip novo — será cadastrado.":"<span style='color:var(--danger)'>Chip não cadastrado.</span>"); }
  else $("iccidHint").textContent=`${ls.length} chips na lista.`;
}
$("m_iccids").addEventListener("input",updateIccidHint);
$("m_iccids").addEventListener("change",prefillReg);
function openMov(tipo, iccid){
  if(!S.canWrite && !S.demo){ toast("Seu acesso é de leitura."); return; }
  $("fMov").reset(); $("m_data").value=today(); $("m_iccids").value=iccid||"";
  if(iccid){ const ch=D().chips.get(iccid); if(ch?.equipe && ["retirada","devolucao","instalacao","remanejamento"].includes(tipo)) $("m_equipe").value=ch.equipe; }
  setTipo(tipo||S.tipo||"instalacao");
  $("dlgMov").showModal();
}
$("btnNova").addEventListener("click",()=>openMov());
$("fab").addEventListener("click",()=>openMov());
async function gravar(pares){
  if(S.demo){ pares.forEach(({chip,mov})=>{ D().chips.set(chip.iccid,chip); mov.id="m"+Math.random().toString(36).slice(2); D().movs.unshift(mov); }); sortMovs(D().movs); renderAll(); return "demo"; }
  return S.store.registrar(pares);
}
function avisoGravacao(res, txt){
  if(res==="fila") toast(txt+" Salvo no aparelho: será enviado quando houver internet.");
  else if(res==="demo") toast(txt+" (exemplo, não salvo).");
  else toast(txt);
}
$("fMov").addEventListener("submit",async e=>{
  e.preventDefault();
  const t=S.tipo, cfg=TIPOS[t], force=$("m_force").checked;
  const v=k=>($("m_"+k)?.value||"").trim();
  const linhas=parseLinhas();
  if(!linhas.length) return showResult(`<span class="bad">Informe ao menos um ICCID.</span>`);
  if(cfg.single && linhas.length>1) return showResult(`<span class="bad">Remanejamento é registrado um chip por vez, porque cada um vai para um local diferente.</span>`);
  if(cfg.regReq && !v("regional")) return showResult(`<span class="bad">Escolha a regional (${esc(cfg.reg.toLowerCase())}).</span>`);
  if((t==="instalacao"||t==="remanejamento") && !v("uc") && !force) return showResult(`<span class="bad">Informe a UC${t==="remanejamento"?" de destino":""}.</span>`);
  if(t==="saida" && !v("equipe")) return showResult(`<span class="bad">Informe a equipe que está recebendo.</span>`);
  const btn=$("btnSalvarMov"); btn.disabled=true;
  const pares=[], bad=[], seen=new Set();
  for(const ln of linhas){
    if(seen.has(ln.iccid)) continue; seen.add(ln.iccid);
    if((ln.iccid.length<15||ln.iccid.length>22) && !force){ bad.push(`${ln.iccid}: ICCID com ${ln.iccid.length} dígitos (esperado 19–20)`); continue; }
    const atual=D().chips.get(ln.iccid);
    if(!force){
      if(t==="entrada" && atual && !["devolvido","baixado"].includes(atual.status)){ bad.push(`${ln.iccid}: já está no inventário (${STATUS[atual.status].label}, ${regCurto(atual.regional)})`); continue; }
      if(t!=="entrada" && !atual){ bad.push(`${ln.iccid}: não cadastrado — registre a entrada primeiro`); continue; }
      if(cfg.from && atual && !cfg.from.includes(atual.status)){ bad.push(`${ln.iccid}: está "${STATUS[atual.status].label}", não pode ter ${cfg.label.toLowerCase()}`); continue; }
      if(t==="transferencia" && atual && atual.regional===v("regional")){ bad.push(`${ln.iccid}: já está no estoque de ${regCurto(atual.regional)}`); continue; }
    }
    const d={data:v("data")||today(), linha:v("linha"), operadora:v("operadora"), apn:v("apn"), uc:v("uc"), remota:v("remota"), cidade:v("cidade"), regional:v("regional"), equipe:v("equipe"), ns:v("ns"), motivo:v("motivo"), obs:v("obs"), porUid:S.user?.uid||"", porNome:S.perfil?.nome||S.user?.email||""};
    pares.push(applyMove(atual,t,d,ln));
  }
  let res=null, falhou=false;
  if(pares.length){ try{ res=await gravar(pares); }catch(err){ falhou=true; bad.unshift(`Erro ao salvar: ${err?.message||err?.code||"tente de novo"}`); } }
  btn.disabled=false; renderAll();
  const ok = falhou ? [] : pares.map(p=>p.chip.iccid);
  if(!bad.length){ $("dlgMov").close(); avisoGravacao(res, `${cfg.label}: ${ok.length} chip(s) registrado(s).`); return; }
  showResult(`${ok.length?`<div>${ok.length} registrado(s) com sucesso.</div>`:""}<div class="bad">${bad.length} não registrado(s):</div><ul style="margin:6px 0 0;padding-left:18px">${bad.map(b=>`<li class="mono">${esc(b)}</li>`).join("")}</ul>`);
  if(ok.length) $("m_iccids").value=linhas.filter(l=>!ok.includes(l.iccid)).map(l=>[l.iccid,l.linha,l.operadora].filter(Boolean).join(";")).join("\n");
});
function showResult(h){ const r=$("mResult"); r.innerHTML=h; r.hidden=false; r.scrollIntoView({block:"nearest"}); }

/* ---------- Detalhe do chip ---------- */
const ACOES = {estoque:["saida","instalacao","transferencia","operadora","baixa"], equipe:["instalacao","devolucao","saida","baixa"], instalado:["remanejamento","retirada","baixa"], retirado:["instalacao","devolucao","operadora","baixa"], devolvido:["entrada"], baixado:["operadora","entrada"]};
function openChip(iccid){
  const ch=D().chips.get(iccid); const hist=D().movs.filter(m=>m.iccid===iccid);
  $("cTitle").textContent=iccid;
  if(!ch){ $("cBody").innerHTML=`<div class="empty">Chip não encontrado no cadastro.</div>`; if(!$("dlgChip").open) $("dlgChip").showModal(); return; }
  const loc=ch.local||{}, ul=ch.ultimoLocal||{}; const podeEditar=S.canWrite||S.demo;
  $("cBody").innerHTML=`
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${pill(ch.status)}${opBadge(ch.operadora)}<span class="reg">${esc(regNome(ch.regional))}</span><span class="muted">desde ${fmtD(ch.desde)} (${daysSince(ch.desde)} dias)</span></div>
    <div class="dl">
      <div><span>Linha</span>${esc(ch.linha||"—")}</div>
      <div><span>APN / plano</span>${esc(ch.apn||"—")}</div>
      <div><span>Equipe</span>${esc(ch.equipe||"—")}</div>
      ${ch.status==="instalado"?`<div><span>UC</span>${esc(loc.uc||"—")}</div><div><span>Remota</span>${esc(loc.remota||"—")}</div><div><span>Cidade</span>${esc(loc.cidade||"—")}</div>`:""}
      ${ch.status==="retirado"&&ul.uc?`<div><span>Retirado da UC</span>${esc(ul.uc)}</div><div><span>Remota</span>${esc(ul.remota||"—")}</div>`:""}
    </div>
    ${podeEditar?`<div><h3 style="margin-bottom:8px">Registrar</h3><div class="actions">${(ACOES[ch.status]||[]).map(t=>`<button class="btn small" type="button" data-acao="${t}">${esc(TIPOS[t].label)}</button>`).join("")}<button class="btn small" type="button" data-edit>Editar dados</button></div></div>`:""}
    <div id="cEdit" hidden>
      <div class="formgrid">
        <label class="f">Linha<input id="e_linha" value="${esc(ch.linha||"")}"></label>
        <label class="f">Operadora<input id="e_operadora" list="dlOp" value="${esc(ch.operadora||"")}"></label>
        <label class="f wide">APN / plano<input id="e_apn" value="${esc(ch.apn||"")}"></label>
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn primary small" type="button" data-save-edit>Salvar dados</button><button class="btn small danger" type="button" data-del>Excluir cadastro…</button></div>
      <div class="confirmbox" id="cDelConfirm" hidden style="margin-top:10px"><span>Excluir o cadastro deste chip? O histórico de movimentações é mantido.</span><span style="display:flex;gap:6px"><button class="btn small" type="button" data-del-no>Cancelar</button><button class="btn small danger" type="button" data-del-yes>Excluir</button></span></div>
    </div>
    <div><h3 style="margin-bottom:10px">Histórico (${hist.length})</h3>
      ${hist.length?`<ul class="timeline">${hist.map(m=>`<li style="--c:var(${GRUPO_DE[m.tipo]?.c})"><b>${esc(TIPOS[m.tipo]?.label||m.tipo)}</b> <span class="muted num">${fmtD(m.data)}</span> · <span class="reg">${esc(movReg(m))}</span><br>${esc([movLocal(m),m.equipe&&("equipe "+m.equipe),m.ns&&("doc. "+m.ns),m.motivo,m.obs].filter(Boolean).join(" · ")||"—")}<br><span class="muted" style="font-size:12px">por ${esc(nomePor(m))}</span></li>`).join("")}</ul>`:`<div class="muted">Sem movimentações.</div>`}
    </div>`;
  $("cBody").onclick=async e=>{
    const a=e.target.closest("[data-acao]"); if(a){ $("dlgChip").close(); openMov(a.dataset.acao, iccid); return; }
    if(e.target.closest("[data-edit]")){ $("cEdit").hidden=!$("cEdit").hidden; return; }
    if(e.target.closest("[data-del]")){ $("cDelConfirm").hidden=false; return; }
    if(e.target.closest("[data-del-no]")){ $("cDelConfirm").hidden=true; return; }
    if(e.target.closest("[data-del-yes]")){ try{ const r = S.demo ? (D().chips.delete(iccid),"demo") : await S.store.excluirChip(iccid); $("dlgChip").close(); renderAll(); avisoGravacao(r,"Cadastro excluído."); }catch(err){ toast("Não foi possível excluir: "+(err?.message||"")); } return; }
    if(e.target.closest("[data-save-edit]")){ const nc={...ch, linha:$("e_linha").value.trim(), operadora:$("e_operadora").value.trim(), apn:$("e_apn").value.trim(), atualizadoEm:new Date().toISOString()}; try{ const r = S.demo ? (D().chips.set(iccid,nc),"demo") : await S.store.salvarChip(nc); renderAll(); openChip(iccid); avisoGravacao(r,"Dados atualizados."); }catch(err){ toast("Não foi possível salvar: "+(err?.message||"")); } }
  };
  if(!$("dlgChip").open) $("dlgChip").showModal();
}

/* ---------- Exportação ---------- */
function csv(rows){ return "﻿"+rows.map(r=>r.map(x=>{ const s=String(x??""); return /[;"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; }).join(";")).join("\r\n"); }
function baixar(nome, conteudo){
  const url=URL.createObjectURL(new Blob([conteudo],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a"); a.href=url; a.download=nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000); toast("Arquivo gerado: "+nome);
}
const sufixo = () => [F.reg?(REG[F.reg]?.curto||F.reg.slice(4)).replace(/\s+/g,""):"", F.op||""].filter(Boolean).join("_");
$("btnCsvMovs").addEventListener("click",()=>{
  const rows=[["Data","Tipo","ICCID","Linha","Operadora","Regional","Regional de origem","Equipe","UC","Remota/Medidor","Cidade","Documento/NS","Motivo","Observação","UC origem","Remota origem","Cidade origem","Registrado por","Registrado em"]];
  movsF().forEach(m=>rows.push([fmtD(m.data),TIPOS[m.tipo]?.label||m.tipo,"'"+m.iccid,m.linha,m.operadora,regNome(m.regional),m.regOrig?regNome(m.regOrig):(m.orig?.regional?regNome(m.orig.regional):""),m.equipe,m.uc,m.remota,m.cidade,m.ns,m.motivo,m.obs,m.orig?.uc||"",m.orig?.remota||"",m.orig?.cidade||"",nomePor(m),m.ts?new Date(m.ts).toLocaleString("pt-BR"):""]));
  baixar(`movimentacoes_chips_${F.de||"inicio"}_a_${F.ate||today()}${sufixo()?"_"+sufixo():""}.csv`, csv(rows));
});
$("btnCsvChips").addEventListener("click",()=>{
  const rows=[["ICCID","Linha","Operadora","APN/Plano","Situação","Regional","Desde","Dias na situação","Equipe","UC","Remota/Medidor","Cidade","Última UC (retirado)","Motivo"]];
  chipsF().sort((a,b)=>a.iccid.localeCompare(b.iccid)).forEach(ch=>{ const l=ch.local||{}; rows.push(["'"+ch.iccid,ch.linha,ch.operadora,ch.apn,STATUS[ch.status]?.label||ch.status,regNome(ch.regional),fmtD(ch.desde),daysSince(ch.desde),ch.equipe,l.uc,l.remota,l.cidade,ch.ultimoLocal?.uc||"",ch.motivo]); });
  baixar(`cadastro_chips_${today()}${sufixo()?"_"+sufixo():""}.csv`, csv(rows));
});
$("btnCopy").addEventListener("click",()=>{
  const txt=$("rSummary").textContent;
  navigator.clipboard.writeText(txt).then(()=>toast("Resumo copiado. Cole no e-mail ou WhatsApp."),()=>{ const r=document.createRange(); r.selectNodeContents($("rSummary")); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast("Texto selecionado — use Copiar."); });
});

/* ---------- Estado da conexão ---------- */
function applyRO(){
  const ro=!S.canWrite && !S.demo;
  $("roNote").hidden=!ro; $("btnNova").hidden=ro; $("fab").hidden=ro;
  document.querySelectorAll("[data-escrita]").forEach(el=>el.hidden=ro);
}
function setMode(){
  const d=$("modeDot"), t=$("modeText");
  const pend = S.pend.chips || S.pend.movs;
  if(S.demo){ d.className="dot warn"; t.textContent="Visualizando dados de exemplo"; }
  else if(S.store?.modo==="local"){ d.className="dot warn"; t.textContent="Modo local · dados só neste navegador"; }
  else if(!navigator.onLine){ d.className="dot warn"; t.textContent = pend ? "Sem internet · alterações guardadas no aparelho, serão enviadas ao reconectar" : "Sem internet · mostrando os últimos dados baixados"; }
  else if(pend){ d.className="dot warn"; t.textContent="Enviando alterações…"; }
  else { d.className="dot on"; t.textContent="Online · dados sincronizados com a equipe"; }
}
window.addEventListener("online",setMode); window.addEventListener("offline",setMode);
window.addEventListener("store-erro",e=>{ const c=e.detail?.code||""; toast(c.includes("permission")?"Sem permissão para gravar. Peça a um administrador para revisar seu acesso.":"Falha ao salvar: "+(e.detail?.message||c)); });

/* ---------- Telas, login e dados ---------- */
function mostrar(tela){
  $("boot").hidden=true;
  $("telaLogin").hidden = tela!=="login";
  $("telaPendente").hidden = tela!=="pendente";
  $("app").hidden = tela!=="app";
  if(tela==="app") renderAll();
}
function assinarDados(){
  if(S.dataSubs) return;
  const erro = e => { if(String(e?.code||"").includes("permission")) return; toast("Falha ao ler dados: "+(e?.message||"")); };
  S.dataSubs=[
    S.store.onChips((m,p)=>{ S.real.chips=m; S.pend.chips=p; S.carregado=true; setMode(); renderAll(); }, erro),
    S.store.onMovs((mv,p)=>{ S.real.movs=mv; sortMovs(S.real.movs); S.pend.movs=p; setMode(); renderAll(); }, erro)
  ];
}
function desassinarDados(){ (S.dataSubs||[]).forEach(u=>{ try{u();}catch(e){} }); S.dataSubs=null; }
let unsubUsuarios=null;
function assinarUsuarios(){
  if(unsubUsuarios) return;
  unsubUsuarios=S.store.onUsuarios(us=>{ S.usuarios=us; const n=us.filter(u=>u.papel==="pendente").length; $("cntPend").textContent=n; $("cntPend").classList.toggle("zero",!n); if(S.tab==="usuarios") renderAll(); }, ()=>{});
}
function aplicarPerfil(){
  const p=S.perfil?.papel;
  $("uNome").textContent=S.perfil?.nome||S.user?.email||""; $("uPapel").textContent=PAPEIS[p]||p||""; $("uPapel").className="papel "+(p||"");
  $("userChip").hidden = S.store.modo==="local";
  if(p==="admin"||p==="leitor"){
    S.canWrite = p==="admin";
    $("tabUsuarios").hidden = p!=="admin" || S.store.modo==="local";
    if(p==="admin") assinarUsuarios();
    assinarDados(); applyRO(); setMode(); mostrar("app");
    const h=location.hash.slice(1); if(["painel","estoque","chips","movs","rel"].includes(h)||(h==="usuarios"&&p==="admin")) setTab(h);
  } else {
    desassinarDados();
    $("pendEmail").textContent=S.user?.email||"";
    if(p==="bloqueado"){ $("pendTitulo").textContent="Acesso bloqueado"; $("pendTexto").textContent="Seu acesso a este app foi bloqueado por um administrador. Fale com o responsável se achar que é um engano."; }
    else { $("pendTitulo").textContent="Cadastro recebido"; $("pendTexto").textContent="Seu acesso precisa ser liberado por um administrador. Assim que for liberado, esta tela abre o app sozinha."; }
    mostrar("pendente");
  }
}
let unsubPerfil=null;
async function sair(){
  try{ unsubPerfil?.(); }catch(e){} unsubPerfil=null; try{ unsubUsuarios?.(); }catch(e){} unsubUsuarios=null; desassinarDados();
  await S.store.sair();
}
/* Login */
let modoAuth="entrar";
const ERROS={"auth/invalid-credential":"E-mail ou senha incorretos.","auth/wrong-password":"E-mail ou senha incorretos.","auth/user-not-found":"E-mail ou senha incorretos.","auth/invalid-email":"E-mail inválido.","auth/email-already-in-use":"Este e-mail já tem cadastro. Use “Entrar” ou “Esqueci a senha”.","auth/weak-password":"A senha precisa ter pelo menos 6 caracteres.","auth/network-request-failed":"Sem conexão com a internet. Tente de novo.","auth/too-many-requests":"Muitas tentativas. Aguarde alguns minutos e tente de novo.","auth/missing-password":"Digite a senha."};
function setModoAuth(m){
  modoAuth=m; $("authErr").hidden=true; $("authOk").hidden=true;
  $("lbNome").hidden = m!=="cadastrar"; $("lbSenha").hidden = m==="senha";
  $("aSenha").autocomplete = m==="cadastrar" ? "new-password" : "current-password";
  $("btnAuth").textContent = m==="entrar" ? "Entrar" : m==="cadastrar" ? "Pedir acesso" : "Enviar link de nova senha";
  $("authIntro").textContent = m==="entrar" ? "Entre com seu e-mail e senha." : m==="cadastrar" ? "Preencha seus dados. Um administrador vai liberar seu acesso." : "Informe seu e-mail para receber o link de nova senha.";
  $("lnkModo").textContent = m==="entrar" ? "Não tenho acesso — pedir cadastro" : "Já tenho acesso — entrar";
  $("lnkSenha").hidden = m!=="entrar";
}
$("lnkModo").addEventListener("click",()=>setModoAuth(modoAuth==="entrar"?"cadastrar":"entrar"));
$("lnkSenha").addEventListener("click",()=>setModoAuth("senha"));
$("fLogin").addEventListener("submit",async e=>{
  e.preventDefault();
  const email=$("aEmail").value.trim(), senha=$("aSenha").value, nome=$("aNome").value.trim();
  const err=m=>{ $("authErr").textContent=m; $("authErr").hidden=false; };
  $("authErr").hidden=true; $("authOk").hidden=true;
  if(!email) return err("Digite seu e-mail.");
  if(modoAuth==="cadastrar" && !nome) return err("Digite seu nome.");
  $("btnAuth").disabled=true;
  try{
    if(modoAuth==="entrar") await S.store.entrar(email,senha);
    else if(modoAuth==="cadastrar") await S.store.cadastrar(nome,email,senha);
    else { await S.store.resetarSenha(email); $("authOk").textContent="Enviamos um link para "+email+". Confira também a caixa de spam."; $("authOk").hidden=false; }
  }catch(ex){ err(ERROS[ex?.code]||("Não foi possível continuar: "+(ex?.message||ex?.code||""))); }
  $("btnAuth").disabled=false;
});

/* ---------- Instalação (PWA) ---------- */
let promptInstalar=null;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); promptInstalar=e; $("btnInstalar").hidden=false; });
$("btnInstalar").addEventListener("click",async()=>{ if(!promptInstalar) return; promptInstalar.prompt(); try{ await promptInstalar.userChoice; }catch(e){} promptInstalar=null; $("btnInstalar").hidden=true; });
window.addEventListener("appinstalled",()=>{ $("btnInstalar").hidden=true; toast("App instalado."); });
if("serviceWorker" in navigator && location.protocol!=="file:"){ window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{})); }

/* ---------- Tema (gráficos acompanham) ---------- */
try{ matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll); }catch(e){}
if(document.fonts?.ready) document.fonts.ready.then(()=>renderAll());

/* ---------- Início ---------- */
document.querySelectorAll("[data-cfg]").forEach(el=>{ const v=CFG[el.dataset.cfg]; if(v) el.textContent=v; });
if(CFG.titulo) document.title=CFG.titulo;
calcPeriodo(); setModoAuth("entrar");
(async()=>{
  try{ S.store = await criarStore(CFG); }
  catch(e){ $("boot").textContent="Não foi possível iniciar o app. Verifique a internet e a configuração do Firebase (js/config.js)."; console.error(e); return; }
  $("bannerLocal").hidden = S.store.modo!=="local";
  if(S.store.modo==="local") S.carregado=true;
  S.store.onAuth(async user=>{
    try{ unsubPerfil?.(); }catch(e){} unsubPerfil=null;
    S.user=user;
    if(!user){ S.perfil=null; desassinarDados(); mostrar("login"); return; }
    try{ await S.store.garantirPerfil(user); }catch(e){}
    unsubPerfil=S.store.onPerfil(user.uid, perfil=>{ S.perfil=perfil||{papel:"pendente",nome:user.displayName||user.email}; aplicarPerfil(); }, ()=>{ S.perfil={papel:"pendente"}; aplicarPerfil(); });
  });
})();
