/* Service worker : permet d'installer l'appli et de l'ouvrir même sans réseau.
   Stratégie "réseau d'abord" : la dernière version en ligne est toujours prioritaire. */
const CACHE = 'desherbage-v5';
const FICHIERS = ['./', 'index.html', 'app.js', 'secteurs.js', 'dictee.js', 'tableau.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // la météo passe directement
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
