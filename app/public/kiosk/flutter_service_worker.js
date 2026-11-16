// Retires the Flutter kiosk's service worker. Tablets and phones that opened
// the Flutter kiosk registered /kiosk/sw.js (and some, earlier,
// /kiosk/flutter_service_worker.js) for the /kiosk/ scope. The browser
// re-checks that URL on the next visit, finds this file, and installs it:
// it clears the Flutter caches, unregisters itself, and reloads open kiosk
// tabs so they load the TypeScript pages straight from the network.
// The TypeScript kiosk registers no service worker of its own.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith('luna-staff-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const tabs = await self.clients.matchAll({ type: 'window' });
    await Promise.all(tabs.map((tab) => tab.navigate(tab.url).catch(() => {})));
  })());
});
