# TypeScript rewrite, step 1: Flutter baseline

The look the TypeScript rewrite must match. Every storefront and kiosk screen, captured from the real Flutter app and the real `site/` pages against the Firebase emulators (demo project, fixed seed of 5 orders), at 320×640@2, 390×844@2, 768×1024@2 and 1440×900@1.

- Captures: `docs/evidence/parity/flutter/` (60 images; lossless WebP, pixel-identical to the PNG Chrome produced; the three tall storefront-home shots stay PNG because WebP caps at 16,383 px).
- Index: `docs/evidence/parity/flutter/manifest.json` (route, width, file, and whether the first frame painted for every capture: all 60 did).
- Harness: `tool/parity/flutter_preview.dart` (app wired to the emulators) and `tool/parity/shoot.mjs` (headless, muted Chrome; a fresh browser context per capture).
- Spec and screen inventory: `specs/008-typescript-rewrite/spec.md`.

Each later rewrite PR runs `shoot.mjs --target=ts` with the same seed, screens and viewports, and shows the two sets side by side.

| Screen | 390 | 1440 |
|---|---|---|
| Storefront home | <img src="parity/flutter/storefront-home-390.png" width="180"> | <img src="parity/flutter/storefront-home-1440.webp" width="320"> |
| Storefront menu | <img src="parity/flutter/storefront-menu-390.webp" width="180"> | <img src="parity/flutter/storefront-menu-1440.webp" width="320"> |
| Storefront 404 | <img src="parity/flutter/storefront-404-390.webp" width="180"> | <img src="parity/flutter/storefront-404-1440.webp" width="320"> |
| Kiosk splash | <img src="parity/flutter/kiosk-splash-390.webp" width="180"> | <img src="parity/flutter/kiosk-splash-1440.webp" width="320"> |
| Menu | <img src="parity/flutter/kiosk-menu-390.webp" width="180"> | <img src="parity/flutter/kiosk-menu-1440.webp" width="320"> |
| Cart, empty | <img src="parity/flutter/kiosk-cart-empty-390.webp" width="180"> | <img src="parity/flutter/kiosk-cart-empty-1440.webp" width="320"> |
| Cart | <img src="parity/flutter/kiosk-cart-390.webp" width="180"> | <img src="parity/flutter/kiosk-cart-1440.webp" width="320"> |
| Checkout | <img src="parity/flutter/kiosk-checkout-390.webp" width="180"> | <img src="parity/flutter/kiosk-checkout-1440.webp" width="320"> |
| Receipt | <img src="parity/flutter/kiosk-receipt-390.webp" width="180"> | <img src="parity/flutter/kiosk-receipt-1440.webp" width="320"> |
| GCash payment | <img src="parity/flutter/kiosk-gcash-390.webp" width="180"> | <img src="parity/flutter/kiosk-gcash-1440.webp" width="320"> |
| Staff login | <img src="parity/flutter/staff-login-390.webp" width="180"> | <img src="parity/flutter/staff-login-1440.webp" width="320"> |
| Kitchen display | <img src="parity/flutter/staff-kds-390.webp" width="180"> | <img src="parity/flutter/staff-kds-1440.webp" width="320"> |
| Dashboard | <img src="parity/flutter/staff-dashboard-390.webp" width="180"> | <img src="parity/flutter/staff-dashboard-1440.webp" width="320"> |
| Sales analytics | <img src="parity/flutter/staff-analytics-390.webp" width="180"> | <img src="parity/flutter/staff-analytics-1440.webp" width="320"> |
| Lifetime report | <img src="parity/flutter/staff-lifetime-390.webp" width="180"> | <img src="parity/flutter/staff-lifetime-1440.webp" width="320"> |

## Checks on this branch

- `flutter analyze`: no issues (baseline 0); `dart format` clean on the new Dart file
- `flutter test`: 88 passed
- `npm run test:site`: 28/28
- `npm run test:rules` (emulator, JDK 21): 23/23 with the new `emulators` block in `firebase.json`
- functions `npm audit --audit-level=high`: pass
