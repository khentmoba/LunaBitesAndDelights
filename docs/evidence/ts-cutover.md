# TypeScript rewrite, step 5: cutover

Steps 2 to 4 built the TypeScript kiosk and staff pages next to Flutter, but production still served
Flutter at `/kiosk/`. This step switches it over: Hosting now serves the Astro build (`build/app`) as is, so
`/kiosk/` and `/staff/` are the TypeScript pages, and the Flutter app, its Dart tooling and its CI job are
deleted.

## Before and after

Before = the Flutter kiosk as production serves it today (`parity/flutter/`, captured in step 1 and step 4).
After = this branch's build (`parity/cutover/`), captured with the same script (`tool/parity/shoot.mjs`),
seed data, viewports and headless muted Chrome, against the emulators.

| Screen | Before (Flutter) | After (TypeScript) |
|---|---|---|
| Splash, 390 | ![before](parity/flutter/kiosk-splash-390.webp) | ![after](parity/cutover/kiosk-splash-390.webp) |
| Splash, 1440 | ![before](parity/flutter/kiosk-splash-1440.webp) | ![after](parity/cutover/kiosk-splash-1440.webp) |
| Menu, 390 | ![before](parity/flutter/kiosk-menu-390.webp) | ![after](parity/cutover/kiosk-menu-390.webp) |
| Menu, 1440 | ![before](parity/flutter/kiosk-menu-1440.webp) | ![after](parity/cutover/kiosk-menu-1440.webp) |
| Cart, 390 | ![before](parity/flutter/kiosk-cart-390.webp) | ![after](parity/cutover/kiosk-cart-390.webp) |
| Cart, 1440 | ![before](parity/flutter/kiosk-cart-1440.webp) | ![after](parity/cutover/kiosk-cart-1440.webp) |
| Checkout, 390 | ![before](parity/flutter/kiosk-checkout-390.webp) | ![after](parity/cutover/kiosk-checkout-390.webp) |
| Checkout, 1440 | ![before](parity/flutter/kiosk-checkout-1440.webp) | ![after](parity/cutover/kiosk-checkout-1440.webp) |
| GCash, 390 | ![before](parity/flutter/kiosk-gcash-390.webp) | ![after](parity/cutover/kiosk-gcash-390.webp) |
| GCash, 1440 | ![before](parity/flutter/kiosk-gcash-1440.webp) | ![after](parity/cutover/kiosk-gcash-1440.webp) |
| Receipt, 390 | ![before](parity/flutter/kiosk-receipt-390.webp) | ![after](parity/cutover/kiosk-receipt-390.webp) |
| Receipt, 1440 | ![before](parity/flutter/kiosk-receipt-1440.webp) | ![after](parity/cutover/kiosk-receipt-1440.webp) |
| Staff login, 390 | ![before](parity/flutter/staff-login-390.webp) | ![after](parity/cutover/staff-login-390.webp) |
| Staff login, 1440 | ![before](parity/flutter/staff-login-1440.webp) | ![after](parity/cutover/staff-login-1440.webp) |
| Kitchen display, 390 | ![before](parity/flutter/staff-kds-390.webp) | ![after](parity/cutover/staff-kds-390.webp) |
| Kitchen display, 1440 | ![before](parity/flutter/staff-kds-1440.webp) | ![after](parity/cutover/staff-kds-1440.webp) |
| Dashboard, 390 | ![before](parity/flutter/staff-dashboard-390.webp) | ![after](parity/cutover/staff-dashboard-390.webp) |
| Dashboard, 1440 | ![before](parity/flutter/staff-dashboard-1440.webp) | ![after](parity/cutover/staff-dashboard-1440.webp) |
| Sales dashboard, 390 | ![before](parity/flutter/staff-analytics-390.webp) | ![after](parity/cutover/staff-analytics-390.webp) |
| Sales dashboard, 1440 | ![before](parity/flutter/staff-analytics-1440.webp) | ![after](parity/cutover/staff-analytics-1440.webp) |

All four widths (320, 390, 768, 1440) of every kiosk and staff screen, plus the delivery map, delivery
checkout and staff console, are in `parity/cutover/`. The storefront did not change: its captures match
the step 1 baseline to within 0.1%, so they are not repeated here.

### Pixel diff

Pixels whose RGB difference is above 30, Flutter vs this branch, out of the whole capture:

| Screen | 320 | 390 | 768 | 1440 |
|---|---:|---:|---:|---:|
| splash | 6.9% | 4.4% | 2.0% | 1.4% |
| menu | 14.1% | 8.1% | 3.9% | 5.7% |
| empty cart | 0.7% | 0.4% | 0.3% | 0.3% |
| cart | 6.9% | 4.1% | 1.8% | 1.3% |
| checkout | 3.8% | 3.9% | 2.7% | 2.0% |
| receipt | 3.6% | 4.3% | 2.9% | 1.8% |
| GCash | 3.5% | 2.2% | 1.0% | 1.0% |
| staff login | 7.1% | 3.2% | 1.4% | 1.4% |
| kitchen display | 5.9% | 3.8% | 1.8% | 5.6% |
| dashboard | 4.3% | 4.1% | 2.6% | 2.3% |
| sales dashboard | 2.8% | 2.4% | 1.4% | 2.2% |
| lifetime report | 2.4% | 2.0% | 1.2% | 1.8% |
| kiosk menu as staff | 14.0% | 8.2% | 3.9% | 5.7% |
| POS checkout | 4.6% | 4.6% | 3.0% | 2.3% |

These match the step 3 and step 4 numbers. Against the step 3 and 4 TypeScript captures, every screen is
within 0.1%, except the splash at 320 and 390. The splash dots pulse, and the two captures caught them at
different points. Moving the images, fonts and icons into `app/public/kiosk/` changed nothing on screen. The
causes of the remaining differences are written up in `ts-ordering.md` and `ts-staff.md`. Browsers and
Flutter antialias text differently, so the screens with the most text score highest. Ticket ages differ
because the two runs happened minutes apart.

## Devices that installed the Flutter kiosk

The Flutter build registered a service worker at `/kiosk/` that serves the app from its cache. Left alone,
a device that opened the kiosk before the cutover could keep showing Flutter. Both paths it used,
`/kiosk/sw.js` and `/kiosk/flutter_service_worker.js`, now serve a worker that deletes every cache except the
staff PWA's (`luna-staff-*`), unregisters itself and reloads open kiosk tabs. Both files are served
no-cache, so the browser picks the new worker up on the next visit.

`tool/parity/sw_retire.mjs` checks this in headless muted Chrome. It registers a stand-in Flutter worker
that fills a `flutter-app-cache`, swaps in the built file, and reloads:

| Worker path | Before | After |
|---|---|---|
| `/kiosk/flutter_service_worker.js` | worker active; caches `flutter-app-cache`, `luna-staff-v1` | no worker; cache `luna-staff-v1` |
| `/kiosk/sw.js` | worker active; caches `flutter-app-cache`, `luna-staff-v1` | no worker; cache `luna-staff-v1` |

Output: [`cutover/sw-retire.json`](cutover/sw-retire.json).

Old links still work. `/kiosk/#/menu`, `/kiosk/?pick=s1#/menu` and the staff hash routes go to their new
pages through the kiosk index's redirect. The storefront now links to `/kiosk/menu` and `/staff/`.

## End to end on this branch's build

The step 3 order run and the step 4 staff shift were run again on this branch's emulator build. They used one
emulator session, after the screenshots, so the dashboard also counts the seeded and e2e orders.

- `order_e2e.mjs`: a pickup order and a delivery order, each paid in cash, were saved and reached the
  receipt. Telegram cannot send on the emulators (no bot secrets), so the kiosk shows its "Order saved!
  Telegram notification could not be sent" snack, as it did in step 3. Output:
  [`cutover/ts-kiosk-order-e2e.json`](cutover/ts-kiosk-order-e2e.json).
- `staff_e2e.mjs`: wrong PIN refused; right PIN reached the kitchen display in 0.16 s as `staff_anna` with
  `role: staff`. START PREPARING and then MARK AS READY saved to the order and its mirror. The dashboard
  loaded. After logout, Auth's IndexedDB holds no staff session. Output:
  [`cutover/ts-staff-e2e.json`](cutover/ts-staff-e2e.json).

| Pickup receipt | Kitchen display after MARK AS READY | Dashboard |
|---|---|---|
| ![pickup](cutover/ts-kiosk-order-e2e-pickup-cash-390.png) | ![ready](cutover/ts-staff-e2e-kds-ready-1440.png) | ![dashboard](cutover/ts-staff-e2e-dashboard-1440.png) |

## GCash link check

The Flutter GCash WebView only loaded PayMongo, GCash and Maya hosts (SECURITY.md #15). The TypeScript page
opened whatever `checkoutUrl` the function returned. It now opens the link only if it is https on one of
those hosts or their subdomains (`app/src/kiosk/payment-host.ts`). Any other link shows the page's error
state. `test/site/kiosk.test.mjs` covers lookalike hosts, http and `javascript:` URLs.

## Checks

Local run of every `pr-checks.yml` job: [`ts-cutover-pr-checks.txt`](ts-cutover-pr-checks.txt).

- functions: build passes, `npm audit --audit-level=high` passes
- rules: 23 of 23 emulator tests pass; `firestore.rules` is unchanged
- site: `astro check` 0 errors, build passes, 48 of 48 site tests pass. A new `npm audit --audit-level=high`
  step for `app/` passes in place of Flutter's `pub outdated`. The audit still lists one moderate advisory
  for astro 7.4.4. It covers dynamic tag names and the `@astrojs/node` image endpoint. This build uses
  neither: the output is static and there is no Node adapter.
- `build/app` contains the kiosk's images, fonts, icons, manifest and both worker files, and no Flutter
  files.
