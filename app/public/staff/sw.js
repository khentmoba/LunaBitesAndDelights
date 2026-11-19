// Staff app service worker: makes the app installable and keeps the last
// good copy of each staff page for when the kitchen tablet drops off Wi-Fi.
// Pages and assets always come from the network first, so a deploy shows up
// on the next load; orders themselves always need the network.
const CACHE = 'luna-staff-v2';
const MAX_ASTRO_ENTRIES = 40;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('luna-staff-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheAndPrune(req, res) {
  const cache = await caches.open(CACHE);
  await cache.put(req, res);
  if (new URL(req.url).pathname.startsWith('/_astro/')) {
    const keys = await cache.keys();
    const astroKeys = keys.filter((k) => new URL(k.url).pathname.startsWith('/_astro/'));
    if (astroKeys.length > MAX_ASTRO_ENTRIES) {
      await Promise.all(astroKeys.slice(0, astroKeys.length - MAX_ASTRO_ENTRIES).map((k) => cache.delete(k)));
    }
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const shell = req.mode === 'navigate' || url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/kiosk/fonts/') || url.pathname.startsWith('/kiosk/images/luna_logo');
  if (!shell) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(cacheAndPrune(req, copy).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
  );
});
