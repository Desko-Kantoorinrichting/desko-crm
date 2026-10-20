/* Eenvoudige service worker: maakt de app installeerbaar en toont de laatst
   geladen versie als er geen internet is. Altijd eerst het netwerk. */
const CACHE = 'desko-crm-v5';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const kopie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopie)); return r;
  }).catch(() => caches.match(e.request)));
});
