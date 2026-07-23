/* defOult service worker.
 *
 * Two jobs: make the site installable on Android/Chrome (which requires a
 * worker), and make it genuinely usable offline. The page is fully
 * self-contained — the font is inlined, there are no CDN requests — so caching
 * the handful of same-origin files is the whole story.
 *
 * Strategy is stale-while-revalidate: a cached response goes out immediately
 * (instant load, works with no network) while a fresh copy is fetched in the
 * background for next time. index.html is ~600 KB, so this matters more than
 * the extra freshness a network-first policy would buy.
 *
 * Bump CACHE when the site is redeployed; activate() drops every other cache,
 * so a stale worker can never strand an old build.
 */
const CACHE = 'defoult-v1';

// Best-effort: about/manual live in the site repo and may not be deployed
// alongside a given build, so each is added on its own and failures are ignored
// rather than aborting the whole install.
const PRECACHE = [
  './',
  './index.html',
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
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
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
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) return hit;                       // instant, offline-safe
    const res = await net;
    if (res) return res;
    // Offline and never cached: for a navigation, fall back to the shell.
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});
