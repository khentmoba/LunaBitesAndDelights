# TypeScript rewrite, step 4: staff

The staff half of the app now exists as Astro pages: `/staff/` (login, then the kitchen display),
`/staff/dashboard`, `/staff/analytics` and `/staff/lifetime`, plus an installable PWA manifest scoped to
`/staff/`. The TypeScript kiosk gets the staff hooks Flutter has: the ORDERS shortcut and the "Staff
console" sheet on the menu, the splash sending staff to the dashboard, and POS checkout. Production still
serves Flutter: `tool/assemble_site.dart` leaves `build/app/staff` out of the deployed site until step 5.

## Before and after

Before = Flutter (`parity/flutter/`). After = TypeScript (`parity/ts/`). Same script
(`tool/parity/shoot.mjs`), seed data, viewports and headless Chrome, against the emulators, signed in as
the same seeded staff user.

| Screen | Before (Flutter) | After (TypeScript) |
|---|---|---|
| Login, 390 | ![before](parity/flutter/staff-login-390.webp) | ![after](parity/ts/staff-login-390.webp) |
| Login, 1440 | ![before](parity/flutter/staff-login-1440.webp) | ![after](parity/ts/staff-login-1440.webp) |
| Kitchen display, 390 | ![before](parity/flutter/staff-kds-390.webp) | ![after](parity/ts/staff-kds-390.webp) |
| Kitchen display, 1440 | ![before](parity/flutter/staff-kds-1440.webp) | ![after](parity/ts/staff-kds-1440.webp) |
| Dashboard, 390 | ![before](parity/flutter/staff-dashboard-390.webp) | ![after](parity/ts/staff-dashboard-390.webp) |
| Dashboard, 1440 | ![before](parity/flutter/staff-dashboard-1440.webp) | ![after](parity/ts/staff-dashboard-1440.webp) |
| Sales dashboard, 390 | ![before](parity/flutter/staff-analytics-390.webp) | ![after](parity/ts/staff-analytics-390.webp) |
| Sales dashboard, 1440 | ![before](parity/flutter/staff-analytics-1440.webp) | ![after](parity/ts/staff-analytics-1440.webp) |
| Lifetime report, 390 | ![before](parity/flutter/staff-lifetime-390.webp) | ![after](parity/ts/staff-lifetime-390.webp) |
| Lifetime report, 1440 | ![before](parity/flutter/staff-lifetime-1440.webp) | ![after](parity/ts/staff-lifetime-1440.webp) |
| Kiosk menu as staff, 320 | ![before](parity/flutter/staff-menu-320.webp) | ![after](parity/ts/staff-menu-320.webp) |
| POS checkout, 390 | ![before](parity/flutter/staff-checkout-390.webp) | ![after](parity/ts/staff-checkout-390.webp) |
| POS checkout, 1440 | ![before](parity/flutter/staff-checkout-1440.webp) | ![after](parity/ts/staff-checkout-1440.webp) |

All four widths (320, 390, 768, 1440) of every screen are in both folders.

`staff-menu` and `staff-checkout` are new to the Flutter baseline. Flutter's `CheckoutPage` reads
`session.isStaff` once, when it opens. The harness used to bind the staff session after the first frame, so
a checkout opened straight from the URL showed the customer view. `tool/parity/flutter_preview.dart` now has
`push=checkout`, which waits for the staff session and then pushes checkout, as a staff member reaching it
from the menu would.

### TypeScript only

Flutter's harness cannot tap the menu's "Staff console" item, so the sheet has no baseline image. It follows
`StaffMenuDialog` in `lib/screens/staff_menu.dart`.

| Staff console, 390 | Staff console, 1440 |
|---|---|
| ![console](parity/ts/staff-console-390.webp) | ![console](parity/ts/staff-console-1440.webp) |

## Pixel diff

Pixels whose RGB difference is above 30, Flutter vs TypeScript, out of the whole capture:

| Screen | 320 | 390 | 768 | 1440 |
|---|---:|---:|---:|---:|
| login | 7.1% | 3.2% | 1.4% | 1.4% |
| kitchen display | 6.0% | 3.9% | 1.8% | 5.6% |
| dashboard | 4.3% | 4.1% | 2.6% | 2.3% |
| sales dashboard | 2.8% | 2.4% | 1.4% | 2.2% |
| lifetime report | 2.4% | 2.0% | 1.2% | 1.8% |
| kiosk menu as staff | 14.0% | 8.2% | 3.9% | 5.7% |
| POS checkout | 4.6% | 4.6% | 3.0% | 2.3% |

What differs:

- **Text rasterisation.** As in step 3: browser and Flutter glyph edges antialias differently, within 1–2px.
  The menu has the most text, so it scores highest, the same as the customer menu did.
- **Ticket ages.** The kitchen display shows "3m ago" in one capture and "1m ago" in the other because the two
  runs happened minutes apart. At 1440 all three columns are visible, so that scores higher.
- **Report numbers.** The Flutter web build prints "₱1202.0", "5.0" and "8.0 sold". The dart2wasm build
  decodes the callables' JSON numbers as doubles, so `toString` adds ".0". The TypeScript pages print
  "₱1202", "5" and "8 sold", the whole numbers the functions send.
- **Custom date range.** Flutter's "Custom" chip opens Material's full-screen calendar range picker. The
  TypeScript page opens a small dialog with a start date and an end date field. The range it sends to
  `getLifetimeSalesReport` is the same.

## End to end: a staff shift on the emulators

`tool/parity/staff_e2e.mjs` drives the emulator build (`PUBLIC_FIREBASE_EMULATORS=1 npm run build`) in
headless, muted Chrome at 1440×900. It seeds one staff account, `anna`, with a scrypt-hashed PIN, and one
pending pickup order. Full output: [`ts-staff-e2e.json`](ts-staff-e2e.json).

| Step | What happened |
|---|---|
| Wrong PIN `1111` | `verifyStaff` refused it. The login shows "Invalid PIN. Please try again." and stays on the PIN pad. |
| Right PIN | The kitchen display opened in 0.47 s with the snack "Welcome, anna! (STAFF)". The Firebase user is `staff_anna`, and its ID token carries `role: staff`, the claim `firestore.rules` checks. |
| START PREPARING | `updateOrderStatus` set the order, and its `kds_orders` mirror, to `Preparing`. The card moved column and now offers MARK AS READY. |
| MARK AS READY | Saved as `Ready`, mirror `Ready`, card offers COMPLETE & DISPATCH, snack "Order updated: Ready". |
| Dashboard | Today's Sales ₱263, Orders 1, Avg order ₱263, Items sold 3, from `getSalesAnalytics`. Recent orders lists LU-E2E-001. |
| Logout | Landed on `/` with no `staff_` row left in Auth's IndexedDB store, and the kiosk menu hides the ORDERS shortcut. Logout waits for `signOut` to finish before leaving the page, so the row is gone before the next page loads. |

No page errors were logged.

| Kitchen display, pending | After MARK AS READY | Dashboard |
|---|---|---|
| ![pending](ts-staff-e2e-kds-pending-1440.png) | ![ready](ts-staff-e2e-kds-ready-1440.png) | ![dashboard](ts-staff-e2e-dashboard-1440.png) |

The Telegram daily summary in the staff console calls `triggerManualReport`. That needs the Telegram bot
secrets, so it was not run here. Its three outcomes (sent, error message, crash) port
`staff_menu.dart` line for line.

## Unit tests

`test/site/staff.test.mjs` (part of `npm run test:site`, which CI runs):

- month axis labels, with `test/audit_bugfixes_test.dart`'s exact cases
- K/M number shortening
- the date range each preset sends, including the Monday week start
- staff uid to username
- kitchen filters and search, live vs polled order merge, mirror doc mapping
- ticket age text and colour, the ten-minute delay flag
- the rider dispatch note

47 of 47 site tests pass. Local `pr-checks.yml` run: [`ts-staff-pr-checks.txt`](ts-staff-pr-checks.txt).
