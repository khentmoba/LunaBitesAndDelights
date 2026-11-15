//  Strategy: NETWORK FIRST
//  → Always tries to fetch fresh from the server
//  → Falls back to cache only when offline
//  → Auto-detects new versions and notifies the app

// Change this version string every time you deploy
const SW_VERSION = 'v1.1.4';
const CACHE_NAME = 'luna-express-' + SW_VERSION;

// Everything resolves against the worker's own scope, so the same file works
// at / and under /kiosk/.
const BASE = new URL('./', self.location).pathname;

const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.json',
  BASE + 'icons/Icon-192.png',
  BASE + 'icons/Icon-512.png',
  BASE + 'favicon.png',
];

self.addEventListener('install', function(event) {
  console.log('[SW ' + SW_VERSION + '] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function() {
        console.log('[SW ' + SW_VERSION + '] Pre-cache done');
      })
  );
});

// Wipe ALL old caches when this new SW takes over
self.addEventListener('activate', function(event) {
  console.log('[SW ' + SW_VERSION + '] Activating — wiping old caches');
  event.waitUntil(
    caches.keys()
      .then(function(names) {
        return Promise.all(
          names
            .filter(function(name) { return name !== CACHE_NAME; })
            .map(function(name) {
              console.log('[SW] Deleting old cache: ' + name);
              return caches.delete(name);
            })
        );
      })
      .then(function() {
        return self.clients.claim();
      })
      .then(function() {
        // Tell all open tabs the app just updated
        return self.clients.matchAll().then(function(clients) {
          clients.forEach(function(client) {
            client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION });
          });
        });
      })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Always fetch Flutter compiled assets fresh — never serve stale JS/Wasm
  var isFlutterAsset = (
    url.pathname.indexOf('main.dart.') !== -1 ||
    url.pathname.indexOf('.wasm') !== -1 ||
    url.pathname.indexOf('flutter.js') !== -1 ||
    url.pathname.indexOf('flutter_bootstrap.js') !== -1 ||
    url.pathname.indexOf('canvaskit') !== -1 ||
    url.pathname.indexOf('assets/') !== -1
  );

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function() {
        // Offline fallback
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match(BASE + 'index.html');
        });
      })
  );
});

// App sends this when user taps "Update Now"
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW ' + SW_VERSION + '] SKIP_WAITING received — activating');
    self.skipWaiting();
  }
});
