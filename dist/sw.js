self.__HS_VERSION__ = "7e2ea0bb13ea";
self.__HS_PRECACHE__ = ["/index.html","/assets/400-BCcS3YNz.css","/assets/400-BXQ-wCs2.js","/assets/400-Bvn1p7nu.js","/assets/400-C0RSa3O6.js","/assets/400-C29NdyzK.css","/assets/400-C29kFCPW.js","/assets/400-C2iTdLqj.css","/assets/400-CAA5YWh7.css","/assets/400-CEULa13L.js","/assets/400-CFcBTHli.js","/assets/400-CKAVTaJh.js","/assets/400-D-aPT9N7.js","/assets/400-D15zwDmJ.css","/assets/400-DLoAZ9c1.js","/assets/400-DfnfKug0.js","/assets/400-Dn_n5OgB.css","/assets/400-DtsmBFje.css","/assets/400-E96Ub0Lq.css","/assets/400-KHyfCGfF.css","/assets/400-WFOKBYV6.css","/assets/400-italic--WmBNuDL.css","/assets/400-italic-Basv9dcA.js","/assets/400-italic-Bn4Q_La5.css","/assets/400-italic-CozPJlB5.js","/assets/400-italic-DR4-gPnX.css","/assets/400-italic-DV8vkiBo.js","/assets/400-italic-DupzKhNy.css","/assets/400-italic-HcmwizVA.js","/assets/400-italic-cYt69iqf.css","/assets/400-italic-gR5Gkz6q.js","/assets/700-3Sw8D-ra.js","/assets/700-4Daud1Bi.css","/assets/700-64kiWx4V.css","/assets/700-BNWXhvFO.css","/assets/700-CzioKor_.js","/assets/700-D9Mpu3Hq.js","/assets/700-DFytRSJK.css","/assets/700-DV9iNfrQ.js","/assets/700-DZbiLjAY.css","/assets/700-Dw5xFUQH.js","/assets/700-E5xu9sOm.css","/assets/700-I2TG0tWH.css","/assets/700-bi6Oj87M.js","/assets/700-jFl1qkq0.js","/assets/900-Bs9F-5wc.css","/assets/900-CrAibG0_.js","/assets/CollaborateDialog-DiKvJXOv.js","/assets/ExportDialog-BHc5BG7J.js","/assets/GalleryDialog-At_g7edL.js","/assets/Library-QTn-Auvj.js","/assets/RemoteStorageDialog-CsP1svm1.js","/assets/bebas-neue-latin-400-normal-9mHNbWWO.woff2","/assets/caveat-latin-400-normal-D6LQsQ_v.woff2","/assets/caveat-latin-700-normal-D8_1Nw6V.woff2","/assets/index-CgOROChV.css","/assets/index-Ds7Ux4SN.js","/assets/inter-latin-400-italic-D1l0FflY.woff2","/assets/inter-latin-400-normal-C38fXH4l.woff2","/assets/inter-latin-700-normal-Yt3aPRUw.woff2","/assets/lobster-latin-400-normal-VmWungf4.woff2","/assets/merriweather-latin-400-italic-CuD3zK4B.woff2","/assets/merriweather-latin-400-normal-G4kZaoXi.woff2","/assets/merriweather-latin-700-normal-DoUP8Ce-.woff2","/assets/montserrat-latin-400-italic-CnlIvBC9.woff2","/assets/montserrat-latin-400-normal-BLhwKU8k.woff2","/assets/montserrat-latin-700-normal-BdjcYUrC.woff2","/assets/montserrat-latin-900-normal-B0TD3Qnu.woff2","/assets/oswald-latin-400-normal-BAFo8sP8.woff2","/assets/oswald-latin-700-normal-vy6hmKSr.woff2","/assets/pacifico-latin-400-normal-7HIToT7q.woff2","/assets/pdf-3GIay3eV.js","/assets/pdf.min-f6n725Xe.js","/assets/pdf.worker.min-OGYDhRwp.js","/assets/playfair-display-latin-400-italic-LeeEXsx5.woff2","/assets/playfair-display-latin-400-normal-CFtfchNt.woff2","/assets/playfair-display-latin-700-normal-CuDiGg7c.woff2","/assets/space-mono-latin-400-italic-YylcN9Ay.woff2","/assets/space-mono-latin-400-normal-Rg4St2Dn.woff2","/assets/space-mono-latin-700-normal-mWgeinG7.woff2","/assets/templates-BwCHdU-R.js","/icon.svg","/manifest.webmanifest","/screens.css"];
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
    const keys = (await caches.keys()).filter((k) => k.startsWith('home-studio-') && k !== CACHE);
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
