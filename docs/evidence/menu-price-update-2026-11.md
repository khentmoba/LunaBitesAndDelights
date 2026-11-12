# Menu Update: Retirements, ₱99 Shawarma Sides, and Drink Repricing

Branch: `t3/update-menu-items-and-prices`

## Summary

The owner's price-board update, applied to every ordering surface:

1. **Retired** Lemon Yakult, Lemon Yogurt, Hotdog Sandwich, and the standalone Ice Cream Halo-Halo.
2. **Shawarma Fries and Shawarma Nachos** are now **₱99** (was ₱75).
3. **Milo Craze** is now **₱65** for all four drinks (was ₱59).
4. **Chuckie Float** and the Cream Float Craze **Milo Float** are **₱65** (was ₱59).
5. **Coke Float** is a flat **₱49** — the Medium/Large chooser is gone.
6. **Coffee Foam** is a flat **₱49** for all four drinks (was Medium ₱39 / Large ₱49).
7. The kiosk burger category is renamed **Burgers** because the hotdog sandwich is gone.

## Changes by Surface

| Surface | Before | After |
|---|---|---|
| `lib/data/menu_data.dart` (Shawarma Favorites) | Shawarma Fries ₱75, Shawarma Nachos ₱75 | Both ₱99 |
| `lib/data/menu_data.dart` (Extras) | Ice Cream Halo-Halo, Solo ₱49 / Overload ₱65 | Removed |
| `lib/data/menu_data.dart` (Lemon Series) | Classic Lemonade, Lemon Yakult, Lemon Strawberry, Lemon Cucumber, Lemon Yogurt | Lemon Yakult and Lemon Yogurt removed |
| `lib/data/menu_data.dart` (Milo Craze) | Milo Dinosaur, Float, Crunch, Oreo at ₱59 | All ₱65 |
| `lib/data/menu_data.dart` (Cream Float Craze) | Coke Float Medium ₱39 / Large ₱49; Chuckie Float ₱59; Milo Float ₱59 | Coke Float ₱49 flat; Chuckie and Milo Float ₱65 |
| `lib/data/menu_data.dart` (Coffee Foam) | Cafe Latte, Caramel Macchiato, Ice Cappuccino, Chocolate Coffee at Medium ₱39 / Large ₱49 | All ₱49 flat, no size chooser |
| `lib/data/menu_data.dart` (Burgers) | Section `Burger & Hotdog Sandwich` with 6 items | Section `Burgers` with 5 items; Hotdog Sandwich removed |
| `lib/screens/kds_page.dart` | Sample Ready order used `Solo Halo-Halo Special` | Uses active `Classic Lemonade` at the same ₱49 × 2 total |
| `functions/src/payments/create_checkout.ts` | Active prices for the retired items and old drink prices | Active prices updated; retired names kept only in the cached-clients allowlist |
| `site/index.html` | Nachos/Fries ₱75; Halo-Halo row; Milo ₱59; Macchiato Medium ₱39; halo-halo in meta and JSON-LD | Nachos/Fries ₱99; Halo-Halo row removed; Milo ₱65; Macchiato ₱49; copy no longer advertises halo-halo |
| `site/menu/index.html` | Same rows and JSON-LD | Same updates; `Ice Cream Halo-Halo` removed from the `Sweet · cold` Schema.org section |
| `site/llms.txt` | ₱75 sides, Halo-Halo Solo ₱49, Macchiato ₱39, Milo ₱59 | ₱99 sides, Halo-Halo removed, Macchiato ₱49, Milo ₱65 |
| `PRODUCT.md` | Documented the old section name, hotdog B1T1, and halo-halo photography | Documents `Burgers`, the new drink prices, and no halo-halo |
| `test/regression_test.dart` | No coverage for these items | Asserts the retirements, ₱99 sides, ₱65 Milo/floats, and flat ₱49 Coke Float and coffee |
| `test/menu_ordering_test.dart` | Used the retired `e2` halo-halo in two chooser tests | Uses `s1` (Shawarma Wrap) and `e3` (Mango Graham) |

## Decisions

- **Coke Float and Coffee are flat ₱49.** The owner's lines ("Coke float is 49", "Coffee is now ₱49 for all of them") replace the old Medium/Large chooser, so the size variants are removed instead of leaving a meaningless chooser.
- **The `Combo Promo - Halo Halo + Fries + Shawarma Wrap` (₱149) stays.** The owner retired the standalone halo-halo, not the combo, and the project's precedent (S3 Shawarma Rice after the standalone rice bowl was retired) is to keep component meals. Flagged for the owner to confirm.
- **Retired names stay in the server allowlist.** `createCheckoutSession` still accepts Lemon Yakult, Lemon Yogurt, Hotdog Sandwich, and Ice Cream Halo-Halo at their last prices so a cached browser tab can finish a checkout. Changed prices are *not* grandfathered: Milo, floats, sides, Coke Float, and coffee only accept the new amounts.

## Visual Proof

All screenshots were captured headless at 2× device pixel ratio from the assembled `build/web` bundle (`flutter build web --release --base-href /kiosk/` + `dart run tool/assemble_site.dart`).

### Storefront — Menu & prices

![Storefront price board at 1440px](menu-storefront-1440.png)
*Desktop 1440px: Shawarma Nachos and Fries at ₱99; Sweet · cold has no Ice Cream Halo-Halo, Milo Dinosaur is ₱65, and Caramel Macchiato is a flat ₱49.*

![Storefront price board at 768px](menu-storefront-768.png)
*Tablet 768px price board.*

![Storefront price board at 390px](menu-storefront-390.png)
*Mobile 390px: Shawarma Favorites with both sides at ₱99.*

![Storefront price board at 320px](menu-storefront-320.png)
*Narrow mobile 320px price board.*

![Storefront Sweet · cold at 390px](menu-storefront-sweet-390.png)
*Mobile 390px Sweet · cold column: no halo-halo row, Milo Dinosaur ₱65, Caramel Macchiato ₱49.*

![Storefront Sweet · cold at 320px](menu-storefront-sweet-320.png)
*Narrow mobile 320px Sweet · cold column.*

![Storefront Sweet · cold at 768px](menu-storefront-sweet-768.png)
*Tablet 768px Sweet · cold column.*

### Full menu page

![Full menu at 1440px](menu-page-1440.png)
*Desktop 1440px full menu with the same rows and Schema.org prices.*

![Full menu at 768px](menu-page-768.png)
*Tablet 768px full menu.*

![Full menu at 390px](menu-page-390.png)
*Mobile 390px full menu.*

![Full menu at 320px](menu-page-320.png)
*Narrow mobile 320px full menu.*

### Kiosk — Refreshments

![Kiosk Lemon Series at 1440px](kiosk-drinks-1440.png)
*Desktop 1440px LEMON SERIES: Classic Lemonade, Lemon Strawberry, Lemon Cucumber — no Lemon Yakult or Lemon Yogurt.*

![Kiosk Lemon Series at 390px](kiosk-drinks-390.png)
*Mobile 390px LEMON SERIES with the same three drinks.*

![Kiosk Milo Craze at 1440px](kiosk-milo-craze-1440.png)
*Desktop 1440px MILO CRAZE: Dinosaur, Float, Crunch, and Oreo all at ₱65.*

![Kiosk Cream Float and Coffee at 1440px](kiosk-coffee-1440.png)
*Desktop 1440px CREAM FLOAT CRAZE (Coke Float ₱49, Chuckie Float ₱65, Milo Float ₱65, Cookies and Cream Float ₱65) and COFFEE FOAM (all four at ₱49).*

![Kiosk Coke Float chooser at 390px](kiosk-coke-chooser-390.png)
*Mobile 390px item details for Coke Float: no size options, "Add to order · ₱49".*

### Kiosk — Burgers and Extras

![Kiosk Burgers at 1440px](kiosk-burgers-1440.png)
*Desktop 1440px Burgers category: five buy-1-take-1 burgers, no Hotdog Sandwich.*

![Kiosk Burgers at 390px](kiosk-burgers-390.png)
*Mobile 390px Burgers category.*

![Kiosk Extras at 1440px](kiosk-extras-1440.png)
*Desktop 1440px Extras: Quesadilla and the four ice creams, no Ice Cream Halo-Halo.*

![Kiosk Extras at 390px](kiosk-extras-390.png)
*Mobile 390px Extras category.*

## Verification & CI Parity

Every job in `.github/workflows/pr-checks.yml` was executed locally:

| Job | Command | Result |
|---|---|---|
| flutter (analyze) | `flutter analyze --no-fatal-infos --no-fatal-warnings` + baseline check | 87 issues, baseline 87 — PASS |
| flutter (format) | `dart format --output=none --set-exit-if-changed` on changed files | 0 changed — PASS |
| flutter (tests) | `flutter test` | 40 passed, 0 failed — PASS |
| flutter (web build) | `flutter build web --release` | Built release web app — PASS |
| functions (build) | `cd functions && npm run build` | TypeScript compiled `src/` to `lib/` — PASS |
| functions (audit) | `cd functions && npm audit --audit-level=high` | 0 high or critical vulnerabilities — PASS |
| functions (tests) | `cd functions && npm test` | 16 passed, 0 failed — PASS |
| rules (emulator) | `cd functions && npm run test:rules` (JDK 21) | 8 passed, 0 failed — PASS |
| proof (verification) | `node tool/check_pr_proof.mjs` | Proof check passed — PASS |

The new regression test fails without the change: it asserts the four retired names are absent, the two shawarma sides are ₱99, the Milo/floats are ₱65, and Coke Float and the four coffees are flat ₱49 with no variants.

**Language-server note.** The worktree's Dart and TypeScript language servers started before `flutter pub get` and `npm ci` finished, so they briefly reported unresolved imports and an implicit `any` in `create_checkout.ts`. The authoritative compilers are clean: `dart analyze lib/screens/kds_page.dart lib/data/menu_data.dart` reports "No issues found!" (the whole-project result is the 87-issue baseline in the table above), and `npx tsc --noEmit` (with `strict: true`) exits 0.
