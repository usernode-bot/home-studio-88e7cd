// The service worker: after Home Studio has opened once with a connection,
// it opens and works with none. App shell and build chunks are precached;
// /api/* is never touched (no network calls leave this app anyway).

const PRECACHE = 'hs-fty6q2';
const SHELL = '/__shell';
self.__PRECACHE__ = ["/assets/400-BCcS3YNz.css","/assets/400-C29NdyzK.css","/assets/400-C2iTdLqj.css","/assets/400-CAA5YWh7.css","/assets/400-D15zwDmJ.css","/assets/400-Dn_n5OgB.css","/assets/400-DtsmBFje.css","/assets/400-E96Ub0Lq.css","/assets/400-KHyfCGfF.css","/assets/400-WFOKBYV6.css","/assets/400-italic--WmBNuDL.css","/assets/400-italic-Bn4Q_La5.css","/assets/400-italic-DR4-gPnX.css","/assets/400-italic-DupzKhNy.css","/assets/400-italic-cYt69iqf.css","/assets/700-4Daud1Bi.css","/assets/700-64kiWx4V.css","/assets/700-BNWXhvFO.css","/assets/700-DFytRSJK.css","/assets/700-DZbiLjAY.css","/assets/700-E5xu9sOm.css","/assets/700-I2TG0tWH.css","/assets/900-Bs9F-5wc.css","/assets/ExportDialog-DAyn1uNH.js","/assets/Library-VIcx1xM8.js","/assets/index-B12-SU4P.js","/assets/index-Cw9g-d8a.js","/assets/index-DZ7ichVD.js","/assets/index-GDpqDFq2.css","/assets/register-C9a1-glI.js","/assets/templates-CCBuk7ai.js","/screens.css"];

self.addEventListener('install', (event) => {
  const cache = caches.open(PRECACHE).then((c) => c.addAll(self.__PRECACHE__).catch(() => {}));
  event.waitUntil(Promise.all([cache, self.skipWaiting()]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('hs-') && key !== PRECACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'cache-shell' && event.data.url) {
    event.waitUntil((async () => {
      try {
        const res = await fetch(event.data.url, { credentials: 'include' });
        if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          const cache = await caches.open(PRECACHE);
          await cache.put(SHELL, res);
        }
      } catch { /* offline already: the shell comes next visit */ }
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return; // never answered by the worker

  // Navigations: network first, the cached shell as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        return res;
      } catch {
        const cache = await caches.open(PRECACHE);
        return (await cache.match(SHELL)) || Response.error();
      }
    })());
    return;
  }
  // Build chunks: cache first. Font files under /assets/ are stored the
  // first time they are fetched, so fonts used once work offline.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(PRECACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })());
  }
  // Everything else goes to the network.
});