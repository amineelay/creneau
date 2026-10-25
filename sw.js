// Service worker : tout le shell est précaché, l'app tourne hors ligne.
// Incrémenter CACHE_VERSION à chaque déploiement qui modifie un de ces fichiers.
const CACHE_VERSION = "creneau-v3";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "fonts/barlow-condensed-500.woff2",
  "fonts/barlow-condensed-600.woff2",
  "fonts/barlow-condensed-700.woff2",
  "fonts/ibm-plex-sans-400.woff2",
  "fonts/ibm-plex-sans-500.woff2",
  "fonts/ibm-plex-sans-600.woff2",
  "fonts/ibm-plex-mono-500.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first pour les fichiers de l'app ; le reste (proxy du coach) passe directement au réseau.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request))
  );
});
