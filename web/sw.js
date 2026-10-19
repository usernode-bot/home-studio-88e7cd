// The service worker: after Home Studio has opened once with a connection,
// it opens and works with none. App shell and build chunks are precached;
// /api/* is never touched (no network calls leave this app anyway).

const PRECACHE = 'hs-__BUILD__';
const SHELL = '/__shell';
self.__PRECACHE__ = [];

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