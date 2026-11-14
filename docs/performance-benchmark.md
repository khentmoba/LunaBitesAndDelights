# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

**Caching policy:** `firebase.json` serves HTML, JSON, and kiosk shell assets with `Cache-Control: no-cache`, while static fonts and images (`**/*.@(woff2|webp|avif|png|jpg|jpeg|svg|ico)`) use `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-v4 --out=docs/evidence/perf-after-v4.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-14`, Mobile Zero-CLS & Payload Trim — v4)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile & `1440x900 @ 1x` desktop).

| Metric | Prior Baseline (`perf-after-nocache.json`) | v4 (`perf-after-v4.json`) | Change |
|---|---:|---:|---:|
| Mobile Cold Wire Transfer | 71,348 B (8 reqs) | **64,674 B** (8 reqs) | **-6,674 B (-9.4%)** |
| Mobile Cold FCP / LCP | 1,956 ms / 2,404 ms | **1,560 ms / 1,560 ms** | **-396 ms FCP / -844 ms LCP** |
| Mobile Cold CLS | 0.030 | **0** | **-100%** |
| Mobile Cold TBT | 69 ms | 129 ms | +60 ms (single-sample cold-start run) |
| Mobile Wi-Fi FCP / LCP | 164 ms | **56 ms** | **-108 ms (-65.9%)** |
| Mobile Wi-Fi Interaction | 35.2 ms | **28.5 ms** | **-6.7 ms (-19.0%)** |
| Repeat Visit FCP / LCP (Slow 3G, 4x CPU) | 768 ms (`0` cached) | **524 ms** (`1,058 B`, `1` cached) | -244 ms (reflects `firebase.json` image/font `max-age=86400` + probe fix) |
| Desktop Cold FCP / LCP | 836 ms | **700 ms** | **-136 ms (-16.3%)** |
| Low-End 6x CPU FCP / LCP | 936 ms | **688 ms** | **-248 ms (-26.5%)** |
| Menu Page `/menu/` Cold Wire Transfer | 61,614 B | **55,210 B** | **-6,404 B (-10.4%)** |
| Menu Page `/menu/` Cold FCP / LCP | 824 ms | **872 ms** | +48 ms |

### Full Environment Matrix (Latest Measured)

| Environment Profile | FCP | LCP | CLS | TBT | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **56 ms** | **56 ms** | **0** | **0 ms** | **28.5 ms** | 80,867 B |
| **Mobile Repeat Visit** (`390x844@2x`, Slow 3G, 4x CPU) | **524 ms** | **524 ms** | **0** | **0 ms** | **14.8 ms** | 1,058 B (`1` cached) |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **700 ms** | **700 ms** | **0.0052** | **60 ms** | **9.2 ms** | 64,674 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **688 ms** | **688 ms** | **0** | **158 ms** | **10.6 ms** | 64,674 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **872 ms** | **872 ms** | **0.0171** | **31 ms** | — | 55,210 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **1,560 ms** | **1,560 ms** | **0** | **129 ms** | **6.8 ms** | 64,674 B |

---

## What Changed in This Pass (v4)

1. **Zero-CLS font metric fallbacks (`site/index.html`, `site/menu/index.html`)**
   - Added `'Bricolage Fallback'` and `'Caveat Fallback'` `@font-face` rules with `size-adjust`, `ascent-override`, `descent-override`, and `line-gap-override`, eliminating mobile font-swap layout shifts (`CLS: 0.030 → 0`).
2. **Eliminated redundant initial-load DOM/observer work (`site/index.html`, `site/menu/index.html`)**
   - Replaced the `ResizeObserver` on `.bar` with an initial `syncBarHeight()` plus `resize`, `hashchange`, and `#` anchor click listeners, and removed the redundant initial `show('map')` DOM writes.
3. **Critical-path & image payload optimization (`site/img/`, `site/index.html`)**
   - Quantized `apple-touch-icon.png` (`7,921 B → 3,758 B`) and re-encoded `luna-logo-320.avif` (`12,733 B → 10,198 B`), cutting cold wire transfer by `6.7 KB`.
   - Removed `fetchpriority="high"` from the below-fold mobile hero photo (`snap--hero` already has a desktop-only `media="(min-width: 941px)"` preload).
   - Added AVIF sources (`fries-b1t1.avif`, `burger-egg.avif`, `dark-chocolate.avif`) for the `#window` photo wall (`136.4 KB → 78.7 KB`, `-42.3%`).
4. **Fixed `tool/perf_probe.mjs` glob matching for current `firebase.json` rules**
   - Updated `globToRegExp` to recursively handle nested globs inside `{...}` and `@(...)`.

---

## Regression Guardrails

Every optimization PR should keep these numbers or beat them:

| Target | Threshold |
|---|---|
| Mobile Wi-Fi FCP / LCP | `<= 200 ms` |
| Mobile Repeat-visit FCP / LCP (Slow 3G + 4x CPU) | `<= 850 ms` |
| Mobile Cold CLS (Slow 3G + 4x CPU) | `<= 0.01` (Good `< 0.1`) |
| Interaction click-to-paint (`interactionMs`) | `< 50 ms` (INP Good `< 200 ms`) |
| Mobile Cold Wire Transfer (Slow 3G) | `<= 75 KB` (`<= 8` requests) |
| Desktop / Low-End / Menu Cold FCP / LCP (Slow 3G + 4x/6x CPU) | `< 1,000 ms` |
