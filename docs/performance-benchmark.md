# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

Use this file as the baseline for future performance work: every optimization PR should keep these numbers or beat them.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-v3 --out=docs/evidence/perf-after-v3.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-13`, all profiles under `1,000 ms`)

### 1. Before vs After (sub-1000ms pass)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile & `1440x900 @ 1x` desktop).

| Metric | Prior (`perf-before-v3.json`) | Latest (`perf-after-v3.json`) | Change |
|---|---:|---:|---:|
| Mobile Cold FCP | 1,036 ms | **920 ms** | **-116 ms (-11.2%)** |
| Mobile Cold LCP | 1,036 ms | **920 ms** | **-116 ms (-11.2%)** |
| Mobile Cold Wire Transfer | 240,475 B (11 reqs) | **168,478 B** (10 reqs) | **-71,997 B (-29.9%)** |
| Desktop Cold FCP | 692 ms | **688 ms** | **-4 ms (-0.6%)** |
| Desktop Cold LCP | 4,828 ms | **688 ms** | **-4,140 ms (-85.7%)** |
| Menu Page `/menu/` Cold FCP / LCP | 1,012 ms | **896 ms** | **-116 ms (-11.5%)** |
| Repeat-visit FCP / LCP | 128 ms | **112 ms** | **-16 ms (-12.5%)** |
| Repeat-visit Wire Transfer | 1,644 B (2x 304) | **1,644 B** (2x 304) | 0 B |

### 2. Full Environment Matrix (Latest Measured — Every Profile `< 1,000 ms`)

| Environment Profile | FCP | LCP | TBT | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **124 ms** | **124 ms** | **0 ms** | **15.5 ms** | 184,672 B |
| **Mobile Repeat Visit** (`390x844@2x`, Slow 3G, 4x CPU) | **112 ms** | **112 ms** | **0 ms** | **14.2 ms** | 1,644 B |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **688 ms** | **688 ms** | **40 ms** | **15.3 ms** | 168,478 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **896 ms** | **896 ms** | **290 ms** | — | 159,982 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **916 ms** | **916 ms** | **738 ms** | **11.0 ms** | 168,478 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **920 ms** | **920 ms** | **179 ms** | **6.8 ms** | 168,478 B |

---

## What Changed in This Pass

1. **Moved & minified JSON-LD (`site/index.html`, `site/menu/index.html`)**
   - Moved `<script type="application/ld+json">` from the top of `<head>` (which was 15 KB of indented JSON on `/menu/` blocking `<style>` and `<body>` discovery) to before `</body>` and minified it.
   - Stripped redundant HTML indentation/blank lines so `<style>` and `<body>` arrive in the first TCP packet.
2. **Synced inline critical CSS with `site/styles.css` (`site/index.html`, `site/menu/index.html`)**
   - Updated the inline `<style>` in both pages to match the `@media (max-width: 520px)` and `@media (max-width: 360px)` single-row sticky bar and stacked button rules from PR #38.
3. **Eliminated Slow-3G bandwidth contention & added AVIF hero (`site/index.html`, `site/styles.css`, `site/img/shawarma-wrap.avif`)**
   - Removed the `<link rel="preload" href="/img/pink-wash.webp">` hint and replaced `body::before`'s raster image under `html[data-lite]` with a pure CSS gradient, saving `15.2 KB` on `3g`/`2g`/low-end devices.
   - Added `340px` AVIF (`site/img/shawarma-wrap.avif`, `5.5 KB` vs `47.7 KB` WebP) with `<picture>` fallback and desktop-only `<link rel="preload" ... media="(min-width: 941px)">`.
   - Re-encoded `site/img/apple-touch-icon.png` with a 64-color palette (`20.0 KB` -> `7.8 KB`).
   - Sized desktop `.snap--hero` to `max-width: 295px; justify-self: center` so `H1#hero-title` stays the LCP element (`688 ms` vs `4,828 ms` previously).
   - Added `.avif` MIME and cache-control support in `firebase.json` and `tool/perf_probe.mjs`.

---

## Regression Guardrails (Keep or Beat)

| Target | Threshold |
|---|---|
| Mobile Cold Wire Transfer (Slow 3G) | `<= 180 KB` |
| All FCP / LCP across all 6 profiles (incl. Slow 3G + 4x/6x CPU) | `< 1,000 ms` |
| Mobile Repeat-visit FCP / LCP (Slow 3G + 4x CPU) | `<= 150 ms` |
| Mobile Wi-Fi FCP / LCP | `<= 150 ms` |
| Interaction click-to-paint (`interactionMs`) | `<= 50 ms` (INP Good `< 200 ms`) |
