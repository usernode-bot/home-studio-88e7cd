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
// - The background remover's runtime (.wasm) and model (/models/) are
//   cached the first time they are used, in a cache of their own that a new
//   version leaves alone, so a new build doesn't mean a new download.
// - /api/ is never touched: those requests always reach the network.

const VERSION = self.__HS_VERSION__;
const PRECACHE = self.__HS_PRECACHE__;
const CACHE = `home-studio-${VERSION}`;
const SHELL = '/index.html';
const HELPER = 'home-studio-helper';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One by one, so a single failure doesn't cost the rest. The shell is
    // not precached here: a fetch from the worker carries no identity, so
    // the platform can answer it with its sign-in page, and that page
    // would sit in the cache as the app shell. The navigate handler
    // stores the real shell on the first online visit instead.
    await Promise.all(PRECACHE.filter((url) => url !== SHELL)
      .map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = (await caches.keys()).filter((k) => k.startsWith('home-studio-') && k !== CACHE && k !== HELPER);
    // The newest previous cache survives one more version: a page still
    // running the old code asks for its own hashed files right after this
    // swap, and the new cache does not hold them yet. Older caches go.
    for (const key of keys.slice(0, -1)) await caches.delete(key);
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

async function cacheFirst(request, name = CACHE) {
  const cache = await caches.open(name);
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
  // The background remover's files: a new model ships under a new file
  // name, and the hashed .wasm changes name with its content.
  if (url.pathname.startsWith('/models/') || (url.pathname.startsWith('/assets/') && url.pathname.endsWith('.wasm'))) {
    event.respondWith(cacheFirst(req, HELPER));
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
