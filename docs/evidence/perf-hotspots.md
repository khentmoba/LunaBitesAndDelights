# Performance hotspots: live KDS, daily stats, kiosk first load

The app is I/O-bound (Firestore reads, network, Flutter web boot), so these fixes
cut work and bytes; a rewrite in another language would not help.

## 1. Kitchen screen pushes instead of polling

| | Before | After |
|---|---|---|
| How orders arrive | `getActiveOrders` callable every 10 s | Firestore listener on `kds_orders` (staff-only mirror kept by the `onOrderWritten` trigger) |
| New order → card on screen | up to 10 s + callable round trip | **74 ms median** (131 / 74 / 77 / 62 / 64), emulator |
| Status change → screen | up to 10 s | **57–64 ms** (57 / 59 / 64), emulator |
| Reads per open screen per day (worst case) | 8,640 calls × up to 200 docs ≈ **1.7 M** | ≤ 200 on connect, then 1 per changed order |
| If the listener fails (for example, before the rules are deployed) | — | falls back to the old 10 s polling, header says "Auto-sync every 10s" |

The mirror holds the same trimmed projection the callable returns, without payment IDs.
The rules let staff read it, and nobody can write it.

Evidence: `kds-live-latency.json`, `kds-live-probe.txt`, `kds-live-{320,390,768,1440}.png`
(real KdsPage on the auth, firestore and functions emulators, headless Chrome),
`perf-rules-tests.txt` (23/23), `test/kds_live_feed_test.dart`.

## 2. No per-second rebuild

The 1 s countdown timer and its `setState` are gone. The header shows the feed state
(Live / Connecting… / Auto-sync every 10s) instead.

## 3. Lifetime report reads daily summaries

`onOrderWritten` keeps `dailyStats/{date}` exact with `FieldValue.increment` in a
transaction, guarded by event ID (`stats_events`) so retried events don't double-count.
`getLifetimeSalesReport` reads one doc per day instead of every order, once
`stats_meta/dailyStats.backfilledAt` is set. Until then, it scans orders as before.

- Equivalence: the new report matches the old logic (copied from 338b627) across 25 random datasets. Summed per-write deltas match a full recount across 41 seeds × 300 writes (`functions/test/daily_stats.test.js`).
- End to end on emulators: create, status change, GCash paid, cancel, delete; the report is identical before and after the switch; the backfill dry run writes nothing (`perf-derived-views-emulator.txt`, 2/2).
- Reads per report: every order ever placed → ~1 per trading day.

## 4. Kiosk first load

| Build | Fast 4G FCP / LCP | Fast 4G first frame | Wi-Fi FCP / LCP | Wi-Fi first frame | Wi-Fi bytes |
|---|---|---|---|---|---|
| Before (`338b627`) | 11,672 ms | 11,672 ms | 4,368 ms | 4,368 ms | 3,855,883 |
| Pre-v2 (`49efcde`, JS) | — | 7,418 ms | — | 392 ms | 3,177,891 |
| **After (Wasm + instant shell + deferred Firebase)** | **176 ms** | **7,184 ms** | **40 ms** | **188 ms** | **1,770,963** |

Medians of 3 runs, headless Chrome, `tool/kiosk_probe.mjs` (`kiosk-before-v2.json`, `kiosk-after-v2.json`). Fast 4G = 4 Mbps / 1.5 Mbps / 100 ms, 4× CPU.

What changed:
- **Bootstrap.** `web/flutter_bootstrap.js` stops asking for Flutter's deprecated service worker. `web/index.html` now loads `flutter_bootstrap.js` directly with `async` (instead of waiting for `window.load`) and defers `sw.js` registration until `window.load` and `version.json` polling until 1.5 s after `flutter-first-frame`.
- **Instant loading shell (`109×` faster Wi-Fi FCP/LCP).** `web/index.html` embeds the splash logo as an inline `120×144` WebP data URI instead of fetching `icons/Icon-512.png`, so Chrome paints FCP/LCP in **40 ms** on Wi-Fi (`176 ms` on Fast 4G).
- **Wasm (`--wasm`) + post-first-frame Firebase init.** `flutter build web --release --wasm` switches web rendering to `skwasm` + `main.dart.wasm`, and `lib/services/firebase_init.dart` moves `Firebase.initializeApp()` and App Check activation past `addPostFrameCallback`, halving Wi-Fi first-frame time (`392 ms -> 188 ms`) and cutting Wi-Fi bytes on the wire by `44%` (`3,177,891 B -> 1,770,963 B`). `firebase.json` and `web/sw.js` (`v1.1.4`) mark `main.dart.mjs` and `.wasm` `no-cache` / network-first.
- **Bundled `images/` (`44.9 MB -> 1.59 MB`, `28.2×` total reduction).** Removed 3 duplicate unused assets, compressed `pink_wash.jpg`/`terra_fries.jpg`, quantized `gcash_qr.png`, resized `luna_logo.webp` (`80.7 KB -> 41.3 KB` on wire), and converted menu photos to `384px` WebP (`mango_graham_ice_cream` `2,022,725 B -> 21,540 B`, `93.9×`).

The splash looks crisp after the pass (`kiosk-after.png`).

## Local CI

All jobs in `pr-checks.yml` are recorded in `docs/evidence/perf-100x-pr-checks.txt` (`perf-100x-pass.md`).
