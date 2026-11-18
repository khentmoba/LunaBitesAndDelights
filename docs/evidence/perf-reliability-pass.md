# Performance & Reliability Pass

All changes preserve the existing UI while improving bundle sizes, font delivery, caching, network reliability, and backend Firestore/API efficiency.

## Summary of Changes

1. **Lazy Per-Service Firebase SDK Splitting (`app/src/kiosk/firebase.ts`, `order.ts`, `session.ts`, `kds.ts`)**
   - Split `firebase()` into lazy, per-service getters: `firebaseApp()`, `firebaseAuth()`, `firebaseFunctions()`, `firebaseDbLite()` (`firebase/firestore/lite`), and `firebaseDb()` (`firebase/firestore`).
   - `/kiosk/checkout/` (`placeOrder`) now uses `firebase/firestore/lite` (`114,614 B` chunk) instead of the full `firebase/firestore` SDK (`571,518 B` chunk — **~80% smaller**).
   - `/staff/` (login), `/staff/dashboard/`, `/staff/analytics/`, `/staff/lifetime/`, and `/kiosk/gcash/` no longer download `firebase/firestore` at all (**0 B** vs `581,404 B`).

2. **Kiosk & Staff Font Compression (`.ttf` → `.woff2`)**
   - Converted all 7 static fonts in `app/public/kiosk/fonts/` (`Bricolage-400..800`, `Caveat-600..700`) from uncompressed `.ttf` (`461,976 B` total) to `.woff2` (`208,660 B` total — **54.8% smaller**, saving `253,316 B`), and updated `app/src/kiosk/tokens.css`, `app/src/layouts/Kiosk.astro`, and `app/src/layouts/Staff.astro`.

3. **Immutable Caching for Content-Hashed Astro Chunks (`firebase.json`)**
   - Added `Cache-Control: public, max-age=31536000, immutable` for `/_astro/**`.

4. **HTML Compression (`app/astro.config.mjs`)**
   - Enabled `compressHTML: true`. `/kiosk/menu/index.html` dropped from `94,662 B` to `66,292 B` (**-30.0%**).

5. **Map Geocoding Reliability (`app/src/kiosk/geo.ts`, `app/src/pages/kiosk/map.astro`)**
   - Added `AbortSignal.timeout(8_000)` and request cancellation (`AbortController`) to `reverseGeocode` and `searchAddress` so stale Nominatim responses never overwrite newer pins/searches and slow requests cannot hang indefinitely.

6. **Backend Performance & Reliability (`functions/src/`)**
   - `updateOrderStatus` (`functions/src/orders/kds.ts`): removed the extra `orderRef.get()` round-trip before `orderRef.update()`, handling Firestore `NOT_FOUND` (`code === 5 || code === 'not-found'`) directly — cutting Firestore read cost and latency by 50% on every KDS status update.
   - `getSalesAnalytics` (`functions/src/reporting/analytics.ts`, `daily_stats.ts`): added `salesAnalyticsFromDay()` fast-path reading the single `dailyStats/{dateLabel}` doc when `stats_meta/dailyStats` is backfilled (1 read instead of scanning all daily orders), with fallback to the `orders` query when not backfilled.
   - `fetchSessionPayments` & `createCheckoutSession` (`functions/src/payments/paymongo.ts`, `create_checkout.ts`): added `AbortSignal.timeout(10_000)` to PayMongo API `fetch()` calls.

## Measured Storefront Probe (`tool/perf_probe.mjs`)

| Metric | Baseline (`perf-baseline-current.json`) | After (`perf-after-perf.json`) |
|---|---:|---:|
| Mobile Cold FCP / LCP (Slow 3G, 4x CPU) | 1,152 ms | **988 ms** |
| Mobile Cold TBT | 165 ms | **160 ms** |
| Mobile Cold CLS | 0.000112 | **0.000112** |
| Menu `/menu/` Cold FCP / LCP | 680 ms | **640 ms** |
| Menu `/menu/` Cold TBT | 40 ms | **33 ms** |
| Low-End Lite FCP / LCP | 824 ms | **792 ms** |
| Low-End Lite TBT | 42 ms | **35 ms** |
| Desktop Cold TBT | 5 ms | **2 ms** |

## Verification

- `cd app && npm run check && npm run build`: 0 errors, 0 warnings, 17 pages built.
- `npm run test:site`: 52/52 passed.
- `cd functions && npm test`: 32/32 passed (including new `salesAnalyticsFromDay` test).
