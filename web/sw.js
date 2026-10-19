// Home Studio's service worker: after the first visit the editor opens and
// works with no connection. The build (vite.config.js) fills in PRECACHE,
// the app's own files, and VERSION, a hash of them.
//
// - The app's files are cached on install, so a reload offline still has
//   every script and stylesheet the editor needs.
// - Pages (navigations) go to the network first and fall back to the cached
//   app shell, so an online visit always gets the newest version.
// - Hashed build files (/assets/) are served from the cache once fetched,
//   which also keeps fonts a design used available offline.
// - The platform's hosted files (bridge, kit) go to the network first and
//   fall back to the last copy, so offline loads still have them.
// - /api/ is never touched: those requests always reach the network.

const VERSION = self.__HS_VERSION__;
const PRECACHE = self.__HS_PRECACHE__;
const CACHE = `home-studio-${VERSION}`;
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One by one, so a single failure doesn't cost the rest.
    await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('home-studio-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') await cache.put(cacheKey || request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey || request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  if (req.mode === 'navigate') {
    // The app shell is the same for every route; keep it under one key.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const type = res.headers.get('content-type') || '';
        if (res.status === 200 && type.includes('text/html')) {
          const cache = await caches.open(CACHE);
          await cache.put(SHELL, res.clone());
        }
        return res;
      } catch (err) {
        const hit = await caches.match(SHELL);
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (/^\/usernode-(bridge|native|tailwind)\//.test(url.pathname) || PRECACHE.includes(url.pathname)) {
    event.respondWith(networkFirst(req));
  }
});
