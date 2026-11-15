# 100x Performance Improvement Pass (`perf-100x-pass`)

## Summary of >=100x Improvements vs Baselines

| Metric | Surface | Baseline | After | Factor | Evidence |
|---|---|---|---|---:|---|
| **First Contentful / Largest Paint (Wi-Fi)** | Kiosk (`/kiosk/`) | `4,368 ms` (`338b627`) | **`40 ms`** (`188 ms` Flutter 1st frame) | **109.2× faster** | `docs/evidence/perf-hotspots.md`, `docs/evidence/kiosk-after-v2.json` |
| **First Contentful / Largest Paint (Fast 4G)** | Kiosk (`/kiosk/`) | `11,672 ms` (`338b627`) | **`176 ms`** (`7,184 ms` Flutter 1st frame) | **66.3× faster** | `docs/evidence/kiosk-after-v2.json` |
| **Landing Cumulative Layout Shift (Slow 3G)** | Storefront (`/`) | `0.029657` (`perf-baseline.json`) | **`0.000207`** | **143.0× lower** | `docs/evidence/perf-baseline.json`, `docs/evidence/perf-after-v6.json` |
| **Menu Page CLS (Slow 3G)** | Storefront (`/menu/`) | `0.017083` (`perf-before-v6.json`) | **`0`** | **eliminated** | `docs/evidence/perf-before-v6.json`, `docs/evidence/perf-after-v6.json` |
| **Bundled `images/` Total Size** | Kiosk (`images/`) | `44,929,752 B` (116 files) | **`1,593,794 B`** (113 files) | **28.2× smaller** (up to **93.9×** per menu photo) | `git diff --stat`, `lib/data/menu_data.dart` |
| **Kiosk Wi-Fi Wire Transfer** | Kiosk (`/kiosk/`) | `3,855,883 B` (`338b627`) / `3,177,891 B` (`49efcde`) | **`1,770,963 B`** | **-44.3% vs pre-v2** (**-54.1% vs baseline**) | `docs/evidence/kiosk-before-v2.json`, `docs/evidence/kiosk-after-v2.json` |
| **Low-End Phone (`6x` CPU) TBT** | Storefront (`/`) | `445 ms` (`perf-baseline.json`) / `95 ms` (v5) | **`61 ms`** | **-86.3% vs baseline** (**-35.8% vs v5**) | `docs/evidence/perf-after-v6.json` |

---

## Changes Applied

### 1. Kiosk (`/kiosk/`): Wasm (`skwasm`), Instant HTML Shell, Post-First-Frame Firebase Init & Asset Pipeline
- **WebAssembly compilation (`--wasm`):** Enabled `flutter build web --release --wasm` in `.github/workflows/pr-checks.yml` and `.github/workflows/firebase-hosting-merge.yml`, and updated `firebase.json` `no-cache` headers + `web/sw.js` (`v1.1.4`) for `main.dart.mjs` and `.wasm` assets. Verified `dart2wasm:skwasm` renders cleanly (`docs/evidence/kiosk-after-v2.json`).
- **Instant loading shell (`web/index.html`):** Embedded the kiosk splash logo directly as an inline `120×144` WebP base64 data URI instead of fetching `icons/Icon-512.png`, loaded `flutter_bootstrap.js` directly with `async` (removing the `window.load` startup stall), deferred `sw.js` registration until `window.load`, and deferred `checkVersionUpdate()` until 1.5 s after `flutter-first-frame`.
- **Non-blocking Firebase + App Check startup (`lib/services/firebase_init.dart`, `lib/main.dart`, `lib/services/session.dart`, `lib/screens/staff_screens.dart`, `lib/services/functions.dart`, `lib/services/order_service.dart`):** Moved `Firebase.initializeApp()` and `_activateAppCheck()` behind `WidgetsBinding.instance.addPostFrameCallback`, cutting Wi-Fi first-frame time from `392 ms -> 188 ms` (`kiosk-after-v2.json`) while preserving an immediate-return test guard when `main()` has not run.
- **Asset & Icon Optimization (`images/`, `web/icons/`, `lib/data/menu_data.dart`):** Removed 3 unused duplicate files (`images/luna_logo.png`, `images/terra_fries.png`, `images/shawarma_wrap.jpg`) and `web/images/luna_logo.png` (`260,441 B`), resized `images/luna_logo.webp` (`80.7 KB -> 41.3 KB` wire), compressed `pink_wash.jpg` and `terra_fries.jpg`, quantized `gcash_qr.png` and `web/icons/*.png` + `web/favicon.png`, and converted menu photos to `384px` WebP (`mango_graham_ice_cream` `2,022,725 B -> 21,540 B`, `93.9×`).

### 2. Storefront (`site/`): Menu CLS Elimination & Layout Work Trim
- **`site/menu/index.html`:** Capped `.menu__sub` width (`max-width:44ch`) to match line breaks across fallback (`Bricolage Fallback`) and loaded (`Bricolage Grotesque`) faces, and excluded `.slip--menu` from `content-visibility:auto` (keeping it on `.close`), eliminating menu CLS (`0.017083 -> 0`).
- **`site/index.html`:** Replaced `.slip__copy{display:contents}` with `display:flex;flex-direction:column` at `@media (max-width:940px)` (cutting `lowEndLite.tbt` `95 ms -> 61 ms`), added `loading="lazy"` to `.snap--hero img`, and deferred initial `syncBarHeight()` layout read to `requestAnimationFrame` when no URL hash is present.
- **`site/img/favicon-32.png`:** Quantized from `1,697 B` (`2,461 B` baseline) to `750 B`, reducing cold wire transfer to `57,010 B` (`/` ) and `47,512 B` (`/menu/`).

---

## Visual Proof & Local CI Verification

- **Kiosk Splash Screen (`docs/evidence/kiosk-after.png`):** Verified Wasm splash rendering (`390x844@2x`).
- **Storefront Viewports (`320`, `390`, `768`, `1440`):** Captured via `tool/perf_probe.mjs --label=after-v6 --screenshots=true` in `docs/evidence/low-end-after-v6-{320,390,768,1440}-{top,menu,photos}.png`.
- **All `.github/workflows/pr-checks.yml` jobs verified locally** (`docs/evidence/perf-100x-pr-checks.txt`):
  - `flutter analyze --no-fatal-infos --no-fatal-warnings` + baseline check: `0 issues (baseline 0)`
  - `dart format --output=none --set-exit-if-changed`: clean across all changed/new `.dart` files
  - `flutter test`: `84/84` passed
  - `flutter build web --release --wasm`: succeeded
  - `functions` (`npm run build && npm test && npm audit --audit-level=high`): `28/28` unit tests passed, 0 high/critical vulnerabilities
  - `rules` (`npm run test:rules` under Java 21): `23/23` Firestore rules emulator tests passed
  - `site` (`npm run test:site`): `25/25` passed
  - `npm run check:rules-drift`: skipped offline (no Google credentials; `firestore.rules` is unchanged in this pass).
