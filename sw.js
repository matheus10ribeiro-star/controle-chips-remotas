/* Service worker: deixa o app abrir mesmo sem internet.
   Ao publicar uma versão nova, aumente o número de VERSAO. */
const VERSAO = "chips-remotas-v1";
const ARQUIVOS = [
  "./", "index.html", "css/app.css", "js/app.js", "js/store.js", "js/config.js",
  "vendor/chart.umd.min.js", "manifest.webmanifest",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/favicon-32.png",
  "assets/logos/equatorial.png", "assets/logos/vivo.png", "assets/logos/claro.png",
  "assets/logos/tim.png", "assets/logos/oi.png", "assets/logos/algar.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  /* Arquivos do próprio app: tenta a rede primeiro (pega atualizações), cai no cache sem internet */
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(res => { const cp = res.clone(); caches.open(VERSAO).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
    return;
  }
  /* Bibliotecas do Firebase e fontes: cache primeiro */
  if (url.hostname === "www.gstatic.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const cp = res.clone(); caches.open(VERSAO).then(c => c.put(req, cp)); return res; })));
  }
  /* Todo o resto (banco de dados, login) vai direto para a rede */
});
