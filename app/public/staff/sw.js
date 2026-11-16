// Staff app service worker: makes the app installable and keeps the last
// good copy of each staff page for when the kitchen tablet drops off Wi-Fi.
// Pages and assets always come from the network first, so a deploy shows up
// on the next load; orders themselves always need the network.
const CACHE = 'luna-staff-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('luna-staff-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

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
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
  );
});
