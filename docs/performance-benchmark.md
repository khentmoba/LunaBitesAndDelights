# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

**Caching policy:** `firebase.json` serves HTML, JSON, and kiosk shell assets with `Cache-Control: no-cache`, while static fonts and images (`**/*.@(woff2|webp|avif|png|jpg|jpeg|svg|ico)`) use `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-v5 --out=docs/evidence/perf-after-v5.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-14`, Kerning Prune & Smaller Logo — v5)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile & `1440x900 @ 1x` desktop).

| Metric | v4 (`perf-after-v4.json`) | v5 (`perf-after-v5.json`) | Change |
|---|---:|---:|---:|
| Mobile Cold Wire Transfer | 64,674 B (8 reqs) | **57,839 B** (8 reqs) | **-6,835 B (-10.6%)** |
| Menu Page `/menu/` Cold Wire Transfer | 55,210 B (7 reqs) | **48,374 B** (7 reqs) | **-6,836 B (-12.4%)** |
| Mobile Wi-Fi Wire Transfer | 80,867 B | **74,032 B** | -6,835 B |
| `bricolage.woff2` | 17,048 B (missing J/R/X/Z) | **12,840 B** (complete) | **-24.7%** |
| Hero/bar/footer logo AVIF | 10,198 B (`luna-logo-320.avif`) | **7,567 B** (`luna-logo-240.avif`) | -25.8% |
| Mobile Cold FCP / LCP | 1,560 ms | 1,472 ms | single cold-start sample; noisy (1,040 ms on an earlier v5 run) |
| Desktop / Low-End / Menu Cold FCP / LCP | 700 / 688 / 872 ms | 720 / 692 / 692 ms | within run-to-run noise |
| Mobile Cold CLS | 0 | 0 | — |

Lighthouse 12 (devtools throttling, 3 runs each, mobile `/`): `bricolage.woff2` finishes **~35 ms earlier** (mean 1,413 → 1,378 ms) and its swap relayout moves with it. FCP/LCP are unchanged because the webfont is not on the first-paint path (fallback metrics already match). Performance score stays 100.

### Full Environment Matrix (Latest Measured)

| Environment Profile | FCP | LCP | CLS | TBT | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **52 ms** | **52 ms** | **0** | **0 ms** | **20.1 ms** | 74,032 B |
| **Mobile Repeat Visit** (`390x844@2x`, Slow 3G, 4x CPU) | **524 ms** | **524 ms** | **0** | **0 ms** | **4.0 ms** | 1,058 B (`1` cached) |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **720 ms** | **720 ms** | **0.0052** | **2 ms** | **5.1 ms** | 57,839 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **692 ms** | **692 ms** | **0** | **101 ms** | **5.2 ms** | 57,839 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **692 ms** | **692 ms** | **0.0171** | **30 ms** | — | 48,374 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **1,472 ms** | **1,472 ms** | **0** | **116 ms** | **10.6 ms** | 57,839 B |

---

## What Changed in This Pass (v5)

0. **Restored capital J, R, X, Z in Bricolage.** The `6b4eeba` subset dropped them, so every capital R ("ORDER SLIP", "PARA SA", "DELIVERY") drew in the thin fallback face. `tool/fonts/bricolage-source.woff2` is re-subset from the `7470e70` font (same `wght 400–800` axis, no `opsz`): the 80 existing glyphs match outline-for-outline at 5 weights and kerning matches on all 19,200 shared pairs at 3 weights. `prune_kerning.py` now refuses a source missing any page character. Before/after: `docs/evidence/bricolage-capital-r-before-after-390.png`.
1. **Pruned Bricolage kerning to the pairs the pages render (`site/fonts/bricolage.woff2`)**
   - The variable `kern` lookup was 38% of the WOFF2. `tool/kern_pairs.mjs` lists every adjacent character pair in both pages (with upper/lower-case variants for `text-transform`, `noscript`, and CSS `content:`); `tool/prune_kerning.py` keeps only those pairs (plus their `tnum` forms) with original values and variation deltas.
   - Proof: `tool/font_render_diff.mjs` + `tool/png_diff.py` render both pages full-page at 320/390/768/1440 with each font: **0 differing pixels** across 8 page/width pairs. A no-kerning control font differs by 1.27M pixels, so the diff does detect kerning changes. See `docs/evidence/font-kern-prune.md`.
   - Guard: `test/site/app.test.mjs` fails when page copy gains a pair missing from `tool/fonts/bricolage-kern-pairs.json`; rerun the two tools. The unpruned font is kept at `tool/fonts/bricolage-source.woff2` (not deployed).
2. **240px logo AVIF (`site/img/luna-logo-240.avif`)**
   - The hero logo renders at 112px (mobile, 224px @2x) or 236px (desktop); the bar and footer logos are smaller still. All three now use a 240px AVIF (`7,567 B` vs `10,198 B`); the 640px variant still serves 3x and large-DPR desktop.
3. **Tried and reverted:** deferring the sticky-bar script's first `scrollY`/`getBoundingClientRect()` read to after the first frame. Lighthouse attributed less forced reflow but total style/layout time was unchanged (the read only pulls forward a layout that must happen anyway) and menu FCP regressed ~120 ms.

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
