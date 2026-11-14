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

| Build | Fast 4G first frame | Wi-Fi first frame | Wi-Fi bytes |
|---|---|---|---|
| Before (338b627) | 11,672 ms | 4,368 ms | 3,855,883 |
| **After (this PR, JS)** | **7,505 ms** | **356 ms** | **3,175,528** |
| After + `--wasm` (not shipped) | 7,119 ms | 239 ms | 3,028,283 |

Medians of 3 runs, headless Chrome, `tool/kiosk_probe.mjs`. Fast 4G = 4 Mbps / 1.5 Mbps / 100 ms, 4× CPU.

What changed:
- **Bootstrap.** `web/flutter_bootstrap.js` stops asking for Flutter's deprecated service worker. The loader was waiting up to 4 s for it on every first visit, and it clashed with the kiosk's own `sw.js`. This accounts for most of the Wi-Fi win.
- **Deferred staff code.** Admin, KDS and analytics load on demand (`staff_screens.dart`). The map picker is prefetched in the background on checkout. `main.dart.js` went from 3,271,882 to 3,035,697 B raw (962 KB → 892 KB on the wire). `main.dart.js_*.part.js` gets `no-cache` in `firebase.json`.
- **Logo.** PNG 665 KB → WebP 80 KB, visually identical (mean pixel diff about 1.2/255).

The splash looks the same before and after (`kiosk-before-390.png`, `kiosk-after-390.png`).

`--wasm` is a further ~5% on fast 4G. It changes the CI and deploy build commands, so it
needs a real-device check of the GCash webview and geolocator first. It's left for a follow-up.

## Local CI

All jobs in `pr-checks.yml` pass locally (`perf-pr-checks.txt`):
- analyze: 0 issues
- dart format: clean
- flutter test: 67 pass
- web build: OK
- functions build and unit tests: 24 pass
- npm audit (high): OK
- rules tests: 23 pass
- site tests: 25 pass

`npm run check:rules-drift` could not run here (no Google credentials). It will show
drift until step 2 below: `firestore.rules` adds the `kds_orders` read rule.

## Rollout

1. Merge. This deploys hosting and functions (including the new `onOrderWritten` trigger). The KDS keeps polling until step 2. The first Firestore-trigger deploy may ask to enable Eventarc permissions.
2. Deploy the rules: `firebase deploy --only firestore:rules`. The KDS then switches to Live.
3. Backfill, from `functions/`: run `node scripts/backfill-derived-views.js` (dry run), then add `--apply`. This writes `dailyStats`, mirrors the last 7 days into `kds_orders`, and sets the flag that moves the lifetime report onto summaries.
4. Optional: add a TTL policy on `stats_events.expireAt`. `kds_orders` is never pruned. The listener only reads the last 7 days, so this costs storage only.

## Follow-up worth doing

Menu photos are up to 2 MB each (44 MB `images/`). `tool/optimize_images.dart` exists,
and running it is likely the next-biggest kiosk win on slow connections.
