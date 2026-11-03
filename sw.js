/* ==========================================================================
   KinWeave service worker
   Caches the app shell so the app opens and runs with no network at all.
   Your actual family data lives in localStorage, not here.
   ========================================================================== */

const CACHE = 'kinweave-shell-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './mobile.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

/* ---- install: pre-cache the shell ------------------------------------ */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(
        SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ---- activate: drop old caches --------------------------------------- */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---- fetch ------------------------------------------------------------
   Navigations  -> network first, fall back to the cached shell.
   Everything else -> cache first, revalidate quietly in the background.
   ---------------------------------------------------------------------- */

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

/* ---- allow the page to force an update ------------------------------- */

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
