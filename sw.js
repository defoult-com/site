/* defOult service worker — offline-first, update only on a new version.
 *
 * The page is fully self-contained (font inlined, no CDN requests), so caching
 * the handful of same-origin files is the whole app.
 *
 * STRATEGY: cache-first. Once installed, every request is served from the local
 * cache — the app runs with no network at all, and it never re-downloads its
 * ~600 KB page "just in case" (the old stale-while-revalidate did, on every
 * load). New content reaches the device ONLY when a new version is published.
 *
 * HOW AN UPDATE HAPPENS: VERSION below is a content hash stamped at build time
 * (scripts/stamp-web-export.mjs). When index.html changes, the hash changes, so
 * THIS FILE's bytes change — and the browser's built-in service-worker update
 * check notices that on the next launch, installs the new worker, and precaches
 * the new files into a fresh cache. The running app is untouched until the user
 * accepts: the page shows a small "Update ready" chip, and only a tap swaps to
 * the new version. So the app updates when — and only when — the site has a new
 * build, and never mid-session by surprise.
 */
const VERSION = '5414141da40d';          // stamped from a hash of the build
const CACHE = 'defoult-' + VERSION;

// Best-effort: about/manual live in the site repo and may not be deployed
// alongside a given build, so each is added on its own and failures are ignored
// rather than aborting the whole install.
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './app.css',
  './sample-persist.js',
  './manifest.webmanifest',
  './icons/icon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './about.html',
  './manual.html',
  './render.jpg',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(u => cache.add(u).catch(() => {})));
    // First-EVER install (no worker controlling yet): take over immediately so
    // the app is offline-ready from this first launch. A later UPDATE does not
    // skipWaiting here — it waits until the user accepts (see the page chip),
    // so a new build never swaps assets under a running session.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Drop every older defoult cache — only the current VERSION survives.
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('defoult-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page tells a waiting worker to take over (user tapped "Update ready").
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Only same-origin GETs. Anything else (the donate link, a range request for
  // audio) goes straight to the network untouched.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Cache-first: the whole point. A cached response never triggers a network
    // fetch, so the app is instant and fully offline.
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // Not in cache yet (a page the precache list missed): fetch once, keep it.
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      // Offline and uncached: serve the app shell for a navigation.
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
