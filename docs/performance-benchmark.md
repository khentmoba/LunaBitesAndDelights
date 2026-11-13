# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

**No-cache policy:** `firebase.json` serves all storefront assets with `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, and `Expires: 0`. Every visit (cold and repeat) transfers fresh bytes over the wire (`0` cached requests, `0` 304 revalidations). Performance comes from minimal payload size, zero external CSS/JS roundtrips, and minimal main-thread work.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-nocache --out=docs/evidence/perf-after-nocache.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-13`, Zero-Cache Redesign)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile & `1440x900 @ 1x` desktop).

| Metric | Baseline (`perf-baseline.json`) | Zero-Cache Redesign (`perf-after-nocache.json`) | Change |
|---|---:|---:|---:|
| Mobile Cold Wire Transfer | 100,967 B (10 reqs) | **71,348 B** (8 reqs) | **-29,619 B (-29.3%)** |
| Mobile Cold FCP / LCP | 2,284 ms / 2,284 ms | **1,956 ms** / 2,404 ms | -328 ms FCP / +120 ms LCP |
| Mobile Cold TBT | 791 ms | **69 ms** | **-722 ms (-91.3%)** |
| Mobile Wi-Fi FCP / LCP | 284 ms | **164 ms** | **-120 ms (-42.3%)** |
| Mobile Wi-Fi Interaction | 53.1 ms | **35.2 ms** | **-17.9 ms (-33.7%)** |
| Repeat Visit FCP / LCP (Slow 3G, 4x CPU, no cache) | 156 ms (0 B cached) | **768 ms** (69,061 B, `0` cached) | +612 ms (+69,061 B; cache removed) |
| Desktop Cold FCP / LCP | 684 ms | 836 ms | +152 ms (+22.2%) |
| Low-End 6x CPU FCP / LCP | 696 ms | 936 ms | +240 ms (+34.5%) |
| Menu Page `/menu/` Cold Wire Transfer | 92,450 B | **61,614 B** | **-30,836 B (-33.4%)** |
| Menu Page `/menu/` Cold FCP / LCP | 956 ms | **824 ms** | **-132 ms (-13.8%)** |

### Full Environment Matrix (Latest Measured)

| Environment Profile | FCP | LCP | TBT | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **164 ms** | **164 ms** | **34 ms** | **35.2 ms** | 87,554 B |
| **Mobile Repeat Visit (No Cache)** (`390x844@2x`, Slow 3G, 4x CPU) | **768 ms** | **768 ms** | **312 ms** | **8.5 ms** | 69,061 B (`0` cached) |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **836 ms** | **836 ms** | **341 ms** | — | 71,348 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **936 ms** | **936 ms** | **406 ms** | **16.4 ms** | 71,348 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **824 ms** | **824 ms** | **283 ms** | — | 61,614 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | 1,956 ms | 2,404 ms | **69 ms** | **12.2 ms** | 71,348 B |

---

## What Changed in This Pass

1. **Removed all HTTP & query-string caching (`firebase.json`, `site/index.html`, `site/menu/index.html`)**
   - Replaced all `Cache-Control: max-age=...` / `stale-while-revalidate` / `public, no-cache` rules in `firebase.json` with `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, and `Expires: 0` on `**`.
   - Removed all `?v=` cache-busting query strings from HTML and CSS.
2. **Inlined deduplicated per-page CSS & JS (`site/index.html`, `site/menu/index.html`)**
   - Eliminated `/styles.css` and `/app.js` external requests (10 → 8 requests), removed the duplicate critical-CSS / late-stylesheet double-layout penalty, and replaced synchronous initial `getBoundingClientRect()` reflow with `ResizeObserver` sizing.
3. **Static & subsetted fonts + optimized favicon/manifest (`site/fonts/`, `site/img/favicon-32.png`, `site/manifest.webmanifest`)**
   - Instantiated `Caveat` at static `wght=600` and subsetted both `caveat.woff2` (`26,184 B` → `9,528 B`) and `bricolage.woff2` (`24,464 B` → `17,048 B`) to site glyphs (`-24,072 B` total).
   - Palette-quantized `favicon-32.png` (`2.5 KB` → `1.7 KB`) and minified `manifest.webmanifest` (`1,056 B` → `763 B`).

---

## Regression Guardrails (Zero-Cache Baseline)

Every optimization PR should keep these numbers or beat them without adding HTTP or browser caches:

| Target | Threshold |
|---|---|
| Mobile Wi-Fi FCP / LCP | `<= 200 ms` |
| Mobile Repeat-visit FCP / LCP (Slow 3G + 4x CPU, `0` cached) | `<= 850 ms` |
| Interaction click-to-paint (`interactionMs`) | `< 50 ms` (INP Good `< 200 ms`) |
| Mobile Cold Wire Transfer (Slow 3G) | `<= 75 KB` (`<= 8` requests) |
| Desktop / Low-End / Menu Cold FCP / LCP (Slow 3G + 4x/6x CPU) | `< 1,000 ms` |
