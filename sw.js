// Service worker: guarda la app en el móvil para que funcione sin internet
// y se actualiza sola cuando hay una versión nueva.
const BUILD = '__BUILD__';
const CACHE = 'familia-' + BUILD;
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/parse.js', 'js/dates.js', 'js/sync.js', 'js/config.js',
  'vendor/qrcode.js', 'vendor/jsQR.js',
  'encargo/', 'icons/encargo-180.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('familia-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Librerías de Firebase: se guardan la primera vez para poder arrancar sin internet
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(caches.open('familia-lib').then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : null))
      .then(hit => hit || fetch(req))
  );
});

// ---------- avisos
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Familia', body: e.data?.text() || '' }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Familia', {
      body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      tag: d.tag || undefined, data: { tab: d.tab || '' },
    });
    // Que la app (si está abierta) se sincronice ya
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    cs.forEach(c => c.postMessage('sync'));
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = e.notification.data?.tab || '';
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cs.length) { const c = cs[0]; c.postMessage({ tab }); return c.focus(); }
    return self.clients.openWindow('./' + (tab ? '?tab=' + tab : ''));
  })());
});
