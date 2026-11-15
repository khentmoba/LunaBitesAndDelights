{{flutter_js}}
{{flutter_build_config}}

// No serviceWorkerSettings on purpose. web/sw.js (registered in index.html)
// is the kiosk's service worker. Flutter's own worker is deprecated, shares
// the /kiosk/ scope with sw.js, and made the loader wait up to 4 s
// (timeoutMillis) for it before fetching the engine on a first visit.
_flutter.loader.load();
