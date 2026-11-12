# Low-end device and slow-network optimization

Measurement profile: headless Chrome (`--headless=new --mute-audio`) over a local server enforcing `firebase.json` headers + level-9 gzip, throttled to **slow 3G (400 kbps down/up, 400 ms RTT)** and **4x CPU slowdown** (`tool/perf_probe.mjs`).

## Before vs After

### Mobile (`390x844 @ 2x`, slow 3G + 4x CPU)

| Metric | Before (`perf-before.json`) | After (`perf-after.json`) | Change |
|---|---:|---:|---|
| Cold FCP / LCP | 2,164 ms | 1,912 ms | -252 ms (-11.6%) |
| Cold wire transfer | 320,348 B (10 reqs) | 239,734 B (9 reqs) | -80,614 B (-25.2%) |
| Repeat-visit FCP / LCP | 1,320 ms | 484 ms | -836 ms (-63.3%) |
| Repeat-visit wire transfer | 311,763 B (9 x `200`) | 1,151 B (2 x `304`, rest disk cache) | -310,612 B (-99.6%) |
| CLS (cold) | 0.0111 | 0.0113 | unchanged (<= 0.012) |

### Desktop (`1440x900 @ 1x`, slow 3G + 4x CPU, cold cache)

| Metric | Before | After | Change |
|---|---:|---:|---|
| Cold FCP / LCP | 1,912 ms | 1,720 ms | -192 ms (-10.0%) |
| Cold wire transfer | 476,225 B | 239,734 B | -236,491 B (-49.7%) |

## What changed and why

1. **Allow browser + CDN caching (`firebase.json`)**
   - Replaced `Cache-Control: no-cache, no-store, must-revalidate` (which forced Chrome to re-download all 312 KB on every repeat visit) with:
     - `public, max-age=2592000, stale-while-revalidate=604800` for fonts (`.woff2`, `.ttf`, `.otf`, `.woff`)
     - `public, max-age=604800, stale-while-revalidate=604800` for images (`.webp`, `.png`, `.jpg`, `.jpeg`, `.gif`)
     - `public, no-cache` for `.html`, `.js`, `.css`, `.wasm`, `.json`, `.svg`, `.ico`, `.bin`, `.frag`, `.symbols` (revalidates via `ETag`/`304` instead of `no-store` re-downloads).
2. **Subset display font and version font URLs (`site/fonts/bricolage.woff2`, `site/styles.css`, `site/index.html`, `site/menu/index.html`)**
   - Subset `bricolage.woff2` with `fontTools.subset` to the full ASCII + storefront glyph set (64,592 B -> 48,624 B, preserving `opsz` 12–96 and `wght` 400–800 variable axes, 0 lost characters).
   - Added `?v=2` to `@font-face` and `<link rel="preload">` URLs so both match byte-for-byte and bust older caches cleanly.
3. **Responsive hero logo & preload cleanup (`site/index.html`, `site/menu/index.html`)**
   - Removed the preload of the hidden sticky-bar logo (`luna-logo-320.webp`) and added `srcset="/img/luna-logo-320.webp 320w, /img/luna-logo-640.webp 640w" sizes="(max-width: 700px) 112px, 236px"` on `.slip__logo` so phones fetch the 29 KB 320w logo instead of the 65 KB 640w logo.
   - Preloaded `pink-wash.webp` at `fetchpriority="low"` and marked `.snap--hero img` `fetchpriority="low"`.
4. **Defer offscreen street-view embed (`site/index.html`, `site/app.js`, `site/styles.css`)**
   - Moved the street-view iframe `src` to `data-src` and set `src` only when the user clicks the `Street view` tab (with a `<noscript>` fallback link to Google Maps).
5. **Weak-device / slow-network mode & offscreen rendering (`site/index.html`, `site/menu/index.html`, `site/styles.css`, `site/app.js`)**
   - Inline `<head>` probe sets `html[data-lite]` before CSS loads when `navigator.connection.saveData`, `2g`/`slow-2g`/`3g`, `deviceMemory <= 2`, `hardwareConcurrency <= 2`, or `prefers-reduced-motion: reduce` is active; `site/app.js` skips `js-motion` and `IntersectionObserver` setup on `[data-lite]`, keeping every line and stamp immediately visible with zero animation work.
   - Added `content-visibility: auto` with `contain-intrinsic-size` on `.slip--menu`, `.window`, `.slip--find`, and `.close` so offscreen sections skip layout/paint and offscreen lazy images wait until scrolled near.
   - Removed `text-rendering: optimizeLegibility` on `body` to avoid slow-device kerning/ligature overhead on large menus.
6. **Secret scanner allowlist (`.gitleaks.toml`)**
   - Documented the existing public Firebase web `apiKey` in `lib/firebase_options.dart` (per `SECURITY.md` section 3) and generated `build/` artifacts.

## Local checks (`docs/evidence/pr-checks-local.txt`)

- `npm run test:site`: 15/15 passed
- `cd functions && npm run build`: passed (`tsc`)
- `cd functions && npm audit --audit-level=high`: 0 high/critical vulnerabilities (exit 0)
- `cd functions && npm run check:rules-drift`: skipped live comparison (no GCP default credentials locally; exit 0)
- `cd functions && npm run test:rules` (with Android Studio JDK 21): 8/8 passed across 4 suites
- `flutter analyze --no-fatal-infos --no-fatal-warnings` + `node tool/check_analyzer_baseline.mjs`: 0 issues (baseline 0)
- `flutter test`: 44/44 passed
- `flutter build web --release`: succeeded

## Visual proof

Rendered screenshots captured at `320px`, `390px`, `768px`, and `1440px` in `docs/evidence/low-end-before-*.png` and `docs/evidence/low-end-after-*.png` (top, `#board`, and `#window`).
