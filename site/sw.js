/* Service worker: maakt de app installeerbaar, toont de laatst geladen versie als er
   geen internet is (altijd eerst het netwerk) en toont herinneringen als melding. */
const CACHE = 'desko-crm-v58';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Altijd bij de server controleren of er een nieuwere versie is (niet de HTTP-cache van de browser gebruiken)
  e.respondWith(fetch(e.request, {cache:'no-cache'}).then(r => {
    const kopie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopie)); return r;
  }).catch(() => caches.match(e.request)));
});

/* Herinnering ontvangen (zie scripts/herinneringen.mjs). */
self.addEventListener('push', e => {
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch{ d = {tekst:e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.titel || 'Desko CRM', {body:d.tekst || '', icon:'icon-192.png', badge:'icon-192.png', tag:d.tag, renotify:!!d.tag, data:{url:d.url || '#/vandaag'}}));
});
/* Tikken op een melding: app openen (of naar voren halen) op het juiste profiel. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data && e.notification.data.url || '#/vandaag', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(lijst => {
    const open = lijst.find(c => c.url.startsWith(self.registration.scope));
    if(open){ open.postMessage({open:url}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
