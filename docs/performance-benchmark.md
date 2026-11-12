# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

Use this file as the baseline for future performance work: every optimization PR should keep these numbers or beat them.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-v2 --out=docs/evidence/perf-after-v2.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-12`, commit after `perf-after-v2`)

### 1. Before vs After (this optimization pass)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile).

| Metric | Prior Baseline (`perf-before-v2.json`) | Latest (`perf-after-v2.json`) | Change |
|---|---:|---:|---:|
| Cold FCP | 2,324 ms (2.324 s) | **1,392 ms** (1.392 s) | **-932 ms (-40.1%)** |
| Cold LCP | 2,324 ms (2.324 s) | **1,392 ms** (1.392 s) | **-932 ms (-40.1%)** |
| Cold TBT | 241 ms | **170 ms** | **-71 ms (-29.5%)** |
| Cold CLS | 0.0113 | **0.0112** | -0.0001 |
| Cold Wire Transfer | 239,743 B (9 reqs) | **217,503 B** (9 reqs) | **-22,240 B (-9.3%)** |
| Repeat-visit FCP | 516 ms (0.516 s) | **112 ms** (0.112 s) | **-404 ms (-78.3%)** |
| Repeat-visit LCP | 516 ms (0.516 s) | **112 ms** (0.112 s) | **-404 ms (-78.3%)** |
| Repeat-visit Wire Transfer | 1,151 B (2x 304) | **1,151 B** (2x 304) | 0 B |

*(For historical context, the original uncached baseline in `docs/evidence/perf-before.json` had Cold FCP/LCP `2,164 ms` / `320,348 B` and Repeat-visit FCP/LCP `1,320 ms` / `311,763 B`.)*

### 2. Full Environment Matrix (Latest Measured)

| Environment Profile | FCP | LCP | TBT | CLS | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **60 ms** | **60 ms** | **0 ms** | 0.0112 | **34.3 ms** (34,300 µs) | 217,503 B |
| **Mobile Repeat Visit** (`390x844@2x`, Slow 3G, 4x CPU) | **112 ms** | **112 ms** | **0 ms** | 0 | **17.5 ms** (17,500 µs) | 1,151 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **728 ms** | **728 ms** | **132 ms** | 0.0006 | **18.6 ms** (18,600 µs) | 217,503 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **1,392 ms** | **1,392 ms** | **170 ms** | 0.0112 | **4.6 ms** (4,600 µs) | 217,503 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **688 ms** | **688 ms** | **33 ms** | 0.0005 | — | 165,794 B |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **660 ms** | 4,708 ms* | **9 ms** | 0.0019 | — | 217,503 B |

*\*On Desktop Cold Slow 3G, `H1#hero-title` paints at `660 ms` (FCP) while the hero `shawarma-wrap.webp` image finishes downloading at `4,708 ms` over the 400 kbps pipe.*

---

## What Changed in This Pass

1. **Eliminated render-blocking CSS (`site/index.html`, `site/menu/index.html`)**
   - Inlined minified above-the-fold critical CSS directly in `<head>` and switched `/styles.css?v=3` to non-blocking `rel="preload" as="style"` + `onload` (with `<noscript>` fallback).
   - Cuts Cold Slow-3G FCP/LCP by **932 ms (-40.1%)** and Repeat-visit FCP/LCP by **404 ms (-78.3%)** because the browser no longer waits on a render-blocking stylesheet or 304 revalidation before first paint.
2. **Low-end CPU / 2GB RAM rasterization & scroll optimizations (`site/styles.css`, `site/app.js`)**
   - Under `html[data-lite]` (Save-Data, `2g`/`slow-2g`/`3g`, `deviceMemory <= 2`, `hardwareConcurrency <= 2`, or `prefers-reduced-motion: reduce`), replaced the multi-pass `filter: drop-shadow(...)` + `radial-gradient` `mask` on `.sheet`/`.slip` with a lightweight `box-shadow` and dashed top border — avoiding expensive offscreen CPU alpha-masking buffers on 1–2 core phones.
   - Promoted `body::before` (`pink-wash.webp`) to its own compositor layer (`transform: translateZ(0)`) to prevent full-viewport scroll repaints.
   - Added `touch-action: manipulation` on `a, button` to remove legacy 300 ms tap delays on older mobile browsers.
   - Coalesced `window` scroll events in `site/app.js` with `requestAnimationFrame`.
3. **WebP asset re-compression (`site/img/*.webp`)**
   - Re-encoded storefront WebP assets with `ffmpeg` (`libwebp` quality `78`, `pink-wash.webp` quality `60`, compression level `6`), saving **63.9 KB** across `site/img/` (**-22.2 KB** on initial mobile load).
4. **Extended `tool/perf_probe.mjs`**
   - Added real click-to-next-paint interaction timing (`interactionMs` / `interactionUs`), 6x CPU low-end phone profile (`lowEndLite`), unthrottled Wi-Fi mobile (`wifiMobile`), and `/menu/` cold load (`menuCold`).

---

## Regression Guardrails (Keep or Beat)

| Target | Threshold |
|---|---|
| Mobile Cold Wire Transfer (Slow 3G) | `<= 220 KB` |
| Mobile Cold FCP / LCP (Slow 3G + 4x CPU) | `<= 1,500 ms` |
| Mobile Repeat-visit FCP / LCP (Slow 3G + 4x CPU) | `<= 150 ms` |
| Mobile Wi-Fi FCP / LCP | `<= 100 ms` |
| Interaction click-to-paint (`interactionMs`) | `<= 50 ms` (INP Good `< 200 ms`) |
| CLS across all viewports | `<= 0.02` (Good `< 0.1`) |
