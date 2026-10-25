// Service worker : l'app tourne hors ligne, et récupère toujours la dernière version quand il y a du réseau.
// Incrémenter CACHE_VERSION (et APP_VERSION dans index.html) à chaque déploiement.
const CACHE_VERSION = "creneau-v15";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "fonts/archivo-wdth.woff2",
];

// { cache: "reload" } : on contourne le cache HTTP du navigateur, sinon une ancienne page peut être précachée
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("creneau-v") && k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // la page elle-même : réseau d'abord (dernière version), cache seulement hors ligne
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then(res => { const copy = res.clone(); caches.open(CACHE_VERSION).then(c => c.put("index.html", copy)); return res; })
        .catch(() => caches.match("index.html"))
    );
    return;
  }
  // le reste (police, icônes) : cache d'abord
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
