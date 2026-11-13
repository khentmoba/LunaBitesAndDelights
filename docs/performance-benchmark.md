# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

Use this file as the baseline for future performance work: every optimization PR should keep these numbers or beat them.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-v4 --out=docs/evidence/perf-after-v4.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-13`, `< 100 ms` Wi-Fi, `0 B` repeat-visit wire transfer, all profiles `< 1,000 ms`)

### 1. Before vs After (sub-100ms Wi-Fi & 0 B repeat-visit pass)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile & `1440x900 @ 1x` desktop).

| Metric | Prior (`perf-after-v3.json`) | Latest (`perf-after-v4.json`) | Change |
|---|---:|---:|---:|
| Mobile Wi-Fi FCP / LCP | 124 ms | **60 ms** | **-64 ms (-51.6%)** |
| Repeat-visit FCP / LCP (Slow 3G, 4x CPU) | 112 ms | **108 ms** | **-4 ms (-3.6%)** |
| Repeat-visit Wire Transfer | 1,644 B (2x 304) | **0 B (0 reqs over wire)** | **-1,644 B (-100%)** |
| Mobile Cold FCP / LCP | 920 ms | 992 ms | +72 ms |
| Mobile Cold Wire Transfer | 168,478 B (10 reqs) | **100,846 B** (10 reqs) | **-67,632 B (-40.1%)** |
| Desktop Cold FCP / LCP | 688 ms | **672 ms** | **-16 ms (-2.3%)** |
| Low-End 6x CPU FCP / LCP | 916 ms | **664 ms** | **-252 ms (-27.5%)** |
| Menu Page `/menu/` Cold FCP / LCP | 896 ms | **768 ms** | **-128 ms (-14.3%)** |
| Menu Page `/menu/` Cold Wire Transfer | 159,982 B | **92,329 B** | **-67,653 B (-42.3%)** |

### 2. Full Environment Matrix (Latest Measured)

| Environment Profile | FCP | LCP | TBT | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **60 ms** | **60 ms** | **0 ms** | **27.8 ms** | 117,040 B |
| **Mobile Repeat Visit** (`390x844@2x`, Slow 3G, 4x CPU) | **108 ms** | **108 ms** | **0 ms** | **4.1 ms** | **0 B** |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **672 ms** | **672 ms** | **7 ms** | — | 100,846 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **664 ms** | **664 ms** | **109 ms** | **15.2 ms** | 100,846 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **768 ms** | **768 ms** | **33 ms** | — | 92,329 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **992 ms** | **992 ms** | **171 ms** | — | 100,846 B |

---

## What Changed in This Pass

1. **Zero-roundtrip repeat-visit caching (`firebase.json`)**
   - Added `Cache-Control: public, max-age=604800, stale-while-revalidate=604800` for `/styles.css`, `/app.js`, and `/manifest.webmanifest` (with `?v=4` cache-busting on `styles.css`), eliminating all 304 revalidation roundtrips on repeat visits (`1,644 B` -> `0 B` wire transfer).
2. **Font instancing & subsetting (`site/fonts/bricolage.woff2?v=3`, `site/fonts/caveat.woff2?v=3`)**
   - Pinned `opsz=36` on `Bricolage Grotesque` (keeping full `wght 400..800` variable axis: `48 KB` -> `24 KB`) and subsetted `Caveat` to Latin + `₱` + site punctuation (`57 KB` -> `26 KB`), cutting cold font bytes by `55 KB` and speeding up 4x-CPU WOFF2 decode on repeat visits.
3. **AVIF logo with alpha + deferred stylesheet & `/menu/` JSON-LD (`site/img/luna-logo-*.avif`, `site/styles.css`, `site/index.html`, `site/menu/index.html`)**
   - Encoded `luna-logo-320.avif` (`13 KB` vs `24 KB` WebP) and `luna-logo-640.avif` (`26 KB` vs `51 KB` WebP) with preserved alpha channel via `<picture>`.
   - Removed a stray top-level `.bar__home{display:none}` fragment from `site/index.html` inline `<style>`, moved & minified `FAQPage` JSON-LD in `site/menu/index.html` before `</body>`, and minified `site/styles.css` (`26.7 KB` -> `17.4 KB`) to eliminate the double-layout penalty on repeat visits.

---

## Regression Guardrails (Keep or Beat)

| Target | Threshold |
|---|---|
| Mobile Wi-Fi FCP / LCP | `< 100 ms` |
| Mobile Repeat-visit FCP / LCP (Slow 3G + 4x CPU) | `<= 115 ms` (0 B wire transfer) |
| Interaction click-to-paint (`interactionMs`) | `< 50 ms` (INP Good `< 200 ms`) |
| Mobile Cold Wire Transfer (Slow 3G) | `<= 110 KB` |
| All FCP / LCP across all 6 profiles (incl. Slow 3G + 4x/6x CPU) | `< 1,000 ms` |
