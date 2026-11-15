# Storefront Performance Benchmark

Canonical performance benchmark for the Luna Bites & Delights static storefront (`site/`), measured with headless Chrome over CDP against a local HTTP server enforcing `firebase.json` headers and level-9 gzip (`tool/perf_probe.mjs`).

**Caching policy:** `firebase.json` serves HTML, JSON, and kiosk shell assets with `Cache-Control: no-cache`, while static fonts and images (`**/*.@(woff2|webp|avif|png|jpg|jpeg|svg|ico)`) use `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.

## How to Run

```bash
node tool/perf_probe.mjs --label=after-v6 --out=docs/evidence/perf-after-v6.json
```

Add `--screenshots=true` to also capture `320px`, `390px`, `768px`, and `1440px` PNGs in `docs/evidence/`.

---

## Latest Measured Numbers (`2026-11-15`, Menu CLS Zeroing & Initial Frame Trim — v6)

Profile: **Slow 3G** (`400 kbps` down/up, `400 ms` RTT) + **4x CPU slowdown** (`390x844 @ 2x` mobile & `1440x900 @ 1x` desktop), compared against initial baseline (`perf-baseline.json`, **0.0297** CLS / **100,967 B** wire) and v5 (`perf-before-v6.json`).

| Metric | Initial (`perf-baseline.json`) | v5 (`perf-before-v6.json`) | v6 (`perf-after-v6.json`) | Change vs Initial |
|---|---:|---:|---:|---:|
| Mobile Cold Wire Transfer | 100,967 B (10 reqs) | 57,934 B (8 reqs) | **57,010 B** (8 reqs) | **-43,957 B (-43.5%)** |
| Menu Page `/menu/` Cold Wire Transfer | 92,450 B (9 reqs) | 48,432 B (7 reqs) | **47,512 B** (7 reqs) | **-44,938 B (-48.6%)** |
| Mobile Wi-Fi Wire Transfer | 117,161 B | 74,127 B | **73,203 B** | -43,958 B |
| Mobile Cold CLS | 0.0297 | 0.000016 | **0.000207** | **143.0× lower** |
| Menu Page `/menu/` Cold CLS | 0.0060 | 0.0171 | **0** | **eliminated** |
| Low-End Phone (`6x` CPU) TBT | 445 ms | 95 ms | **61 ms** | **-86.3%** |
| Mobile Cold TBT | 791 ms | 153 ms | **169 ms** | **-78.6%** |

### Full Environment Matrix (Latest Measured)

| Environment Profile | FCP | LCP | CLS | TBT | Interaction (click-to-paint) | Wire Transfer |
|---|---:|---:|---:|---:|---:|---:|
| **Mobile Wi-Fi / Broadband** (`390x844@2x`, unthrottled, 1x CPU) | **76 ms** | **76 ms** | **0** | **0 ms** | **29.8 ms** | 73,203 B |
| **Mobile Repeat Visit** (`390x844@2x`, Slow 3G, 4x CPU) | **596 ms** | **596 ms** | **0** | **0 ms** | **13.2 ms** | 1,058 B (`1` cached) |
| **Desktop Cold** (`1440x900@1x`, Slow 3G, 4x CPU) | **728 ms** | **728 ms** | **0.0052** | **6 ms** | **9.2 ms** | 57,010 B |
| **10-Year-Old Low-End Phone** (`360x640@1x`, Slow 3G, 6x CPU) | **720 ms** | **720 ms** | **0.0011** | **61 ms** | **16.4 ms** | 57,010 B |
| **Menu Page `/menu/` Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **680 ms** | **680 ms** | **0** | **55 ms** | — | 47,512 B |
| **Mobile Cold** (`390x844@2x`, Slow 3G, 4x CPU) | **1,020 ms** | **1,020 ms** | **0.0002** | **169 ms** | **7.6 ms** | 57,010 B |

---

## What Changed in This Pass (v6)

1. **Zeroed `/menu/` CLS (`0.0171 -> 0`)**: constrained `.menu__sub` width (`max-width:44ch`) so line wrapping stays consistent between `Bricolage Fallback` and `Bricolage Grotesque`, and removed `content-visibility:auto` from `.slip--menu` on `/menu/` while keeping it on `.close`.
2. **Low-end phone TBT cut (`95 ms -> 61 ms`)**: replaced `.slip__copy{display:contents}` with `display:flex;flex-direction:column` under `@media (max-width:940px)` on `/`, deferred initial sticky-bar height measurement (`syncBarHeight`) to `requestAnimationFrame` unless `location.hash` is set, added `loading="lazy"` on `.snap--hero img`, and quantized `site/img/favicon-32.png` (`1,697 B -> 750 B`).
3. **Kiosk (`/kiosk/`) 109× faster first paint & 28× smaller menu assets**: shipped `--wasm` builds (`skwasm`), inline WebP loading logo + immediate bootstrap (`4,368 ms -> 40 ms` Wi-Fi FCP/LCP, `11,672 ms -> 176 ms` 4G FCP/LCP), post-frame Firebase/App Check initialization (`lib/services/firebase_init.dart`), and WebP/quantized assets in `images/` (`44.9 MB -> 1.59 MB`, up to `93.9×` per dish photo). See `docs/evidence/perf-100x-pass.md` and `docs/evidence/perf-hotspots.md`.

*(Earlier pass highlights from v5: restored J/R/X/Z glyphs, pruned Bricolage kerning pairs with 0 pixel diff across 8 page/width screenshots, and switched hero/bar/footer logo to `luna-logo-240.avif`.)*

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
