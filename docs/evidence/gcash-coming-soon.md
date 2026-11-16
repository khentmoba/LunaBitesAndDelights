# GCash Coming Soon — Verification & Evidence

## Summary
- Disabled the GCash payment option in `app/src/pages/kiosk/checkout.astro` with `disabled`, `aria-disabled="true"`, and a `COMING SOON` badge so only Cash payments can be selected.
- Reset any stale `paymentMethod: 'GCash'` checkout draft in `sessionStorage` back to `'Cash'` on `restore()`, and guarded the tile click handler.
- Added a regression test in `test/site/app.test.mjs` verifying that the built checkout page renders the GCash tile disabled with `COMING SOON` and keeps Cash active.

## Local Checks
- `cd app && npm run check`: `0 errors, 0 warnings, 0 hints` (53 files)
- `cd app && npm run build`: `17 page(s) built`
- `npm run test:site`: `52/52 passed` (`0 failed`, `0 skipped`)
- `cd functions && npm run build`: `tsc` exited `0`

## Visual Proof
- Mobile (`390x844`): [checkout-gcash-coming-soon-mobile.png](checkout-gcash-coming-soon-mobile.png)
- Desktop (`1440x900`): [checkout-gcash-coming-soon-desktop.png](checkout-gcash-coming-soon-desktop.png)
