# Feature Specification: One-language TypeScript rewrite

**Branch**: `feature/ts-baseline` (step 1 of 5)
**Created**: 2026-11-15
**Status**: Approved by the owner, in progress
**Input**: "Do a full rewrite in one language, TypeScript. Keep the look exactly the same, or at least identical. Each step its own PR, with before (Flutter) and after (TypeScript) screenshots."

## Problem

Customers open the kiosk from a Facebook link on a phone over mobile data. The Flutter web build shows a splash in 176 ms but needs about 7.2 s on Fast 4G (1.77 MB) before the menu can be tapped (`docs/evidence/perf-100x-pass.md`). The storefront (`site/`) and the kiosk are two codebases in two languages, and menu prices are copied between them with a guard to stop drift.

## Goal

One TypeScript codebase that serves the storefront, customer ordering and the staff screens, renders real HTML, and looks the same as today.

## Target stack

| Part | Today | After |
|---|---|---|
| Storefront `/` | hand-written HTML/CSS/JS in `site/` | Astro pages (static HTML), same markup and CSS |
| Customer ordering `/kiosk/` | Flutter web (Wasm) | Astro pages + small TypeScript islands (cart, checkout, payment) |
| Staff `/staff/` | Flutter (deferred part of the kiosk build) | Astro + TypeScript, installable PWA on the store tablet |
| Menu and prices | `lib/data/menu_data.dart` + copy in `site/` | one typed module, read by every page and by Functions |
| Backend | Firebase Functions (TypeScript) | unchanged; shares order and menu types with the frontend |
| Data, auth, rules, payments | Firestore, Firebase Auth, App Check, PayMongo, Telegram | unchanged |

## Look-parity contract

- Design tokens come from `DESIGN.md` ("Pink Order Pad") and `lib/widgets/kiosk/kiosk_theme.dart`; fonts are the same Bricolage Grotesque and Caveat files.
- Every screen in the inventory below is captured from Flutter (baseline, this PR) and from TypeScript (each later PR) by the same script, with the same seed data and viewports: 320×640@2, 390×844@2, 768×1024@2, 1440×900@1.
- Each rewrite PR shows the Flutter and TypeScript screenshots side by side, plus a pixel diff where it helps, and calls out every visible difference.
- Accepted differences: text rasterisation (browser vs. Flutter text engine), shadow softness, and removing the Flutter loading splash. Anything else is a bug to fix before merge.

## Screen inventory (baseline in `docs/evidence/parity/flutter/`)

| Screen | Flutter route | TypeScript route |
|---|---|---|
| Storefront home, menu, 404 | `/`, `/menu/`, `/404.html` | same |
| Kiosk splash | `/kiosk/#/` | `/kiosk/` |
| Menu | `#/menu` | `/kiosk/menu` |
| Cart (empty, with items) | `#/cart` | `/kiosk/cart` |
| Checkout | `#/checkout_process` | `/kiosk/checkout` |
| Receipt | pushed after checkout | `/kiosk/receipt` |
| GCash payment | pushed after checkout | `/kiosk/gcash` |
| Staff login (PIN / password) | `#/kds` signed out | `/staff/` |
| Kitchen display | `#/kds` | `/staff/kds` |
| Dashboard | `#/dashboard` | `/staff/dashboard` |
| Analytics, lifetime analytics | `#/analytics`, `#/lifetime-analytics` | `/staff/analytics`, `/staff/lifetime` |

Not yet in the automated set (need taps): the item customisation sheet. The staff console sheet has a TypeScript-only capture (`staff-console`); Flutter's harness cannot open it. POS checkout (`staff-menu`, `staff-checkout`) was added to the baseline in step 4.

TypeScript only, no Flutter baseline (the preview harness cannot reach them): checkout with a pinned delivery (`kiosk-checkout-delivery`) and the map picker (`kiosk-map`, `/kiosk/map`).

## Backend contracts that must not change

Callable Functions used by the client: `createCheckoutSession`, `verifyCheckoutPayment`, `getActiveOrders`, `getSalesAnalytics`, `getLifetimeSalesReport`, `sendOrderNotification`, `triggerManualReport`, `updateOrderStatus`, `verifyStaff`. Firestore collections read or written by the client: `orders`, `kds_orders`. `firestore.rules` stays as deployed.

## Steps (one PR each)

1. **Baseline** (this PR): parity harness (`tool/parity/`), Flutter screenshots of every screen, this spec.
2. **Foundation**: Astro + TypeScript app in `app/`, storefront ported (same markup and CSS), typed menu in `app/src/data/menu.ts` that the storefront prints prices from, CI job.
3. **Customer ordering**: kiosk tokens as CSS variables, order types, menu, cart, checkout, delivery map, GCash/PayMongo, receipt. Built into `build/app/kiosk/` but left out of the deployed site by `tool/assemble_site.dart`; step 5 switches `/kiosk/` over. Build-time settings: `PUBLIC_MAPTILER_KEY` (map tiles), `PUBLIC_RECAPTCHA_SITE_KEY` (App Check), `PUBLIC_FIREBASE_EMULATORS=1` (local emulators). `tool/parity/order_e2e.mjs` places real orders against the emulators.
4. **Staff**: `/staff/` login (PIN and password through `verifyStaff`), `/staff/kds` kitchen display (live `kds_orders` mirror plus the `getActiveOrders` poll, chime, rider dispatch note), `/staff/dashboard`, `/staff/analytics`, `/staff/lifetime`, and an installable PWA manifest scoped to `/staff/`. The kiosk gains the staff hooks: the ORDERS shortcut and "Staff console" sheet on the menu, the splash routing staff to the dashboard, and POS checkout (Walk-In, optional name and phone). Customer pages learn a staff user is signed in by reading the Firebase Auth IndexedDB row, without loading the SDK. Built into `build/app/staff/` and left out of the deployed site like the kiosk. Known differences: Custom date range opens a start/end date dialog instead of Material's calendar, and report numbers print as integers where the dart2wasm build printed `₱1202.0`.
5. **Cutover**: delete Flutter and Dart. Hosting serves `build/app` as is, so `/kiosk/` and `/staff/` are the TypeScript pages. The kiosk's images, fonts, icons and manifest move to `app/public/kiosk/`. `/kiosk/sw.js` (and the old `flutter_service_worker.js` path) become a worker that clears the Flutter caches, unregisters itself and reloads open tabs. Old `/kiosk/#/...` links still land on the right page through the kiosk index's hash redirect. The deploy workflows build only the Astro app, and the `flutter` PR check is gone, so `main`'s branch protection must require `site` in its place.

The live site kept running the Flutter kiosk until step 5 merged.

## How to reproduce the baseline

```bash
flutter build web --release --wasm -t tool/parity/flutter_preview.dart \
  --base-href /kiosk/ --output build/parity-flutter   # Git Bash: prefix MSYS_NO_PATHCONV=1
cd functions && npm ci && npm run build
npx firebase-tools emulators:exec --project demo-lunaexpress --only auth,firestore,functions \
  "node ../tool/parity/shoot.mjs --target=flutter --kiosk=../build/parity-flutter"
```

Needs Chrome and JDK 21+ (Firestore emulator). Runs headless and muted, and talks only to the emulators.
