# Site-Wide Bug Audit & Fixes — Evidence

- `flutter analyze --no-fatal-infos --no-fatal-warnings`: 0 issues (baseline 0)
- `dart format --output=none --set-exit-if-changed`: 0 formatting issues on changed Dart files
- `flutter test`: 52/52 passed (including `site_price_parity_test.dart` and `menu_price_parity_test.dart`)
- `flutter build web --release --base-href /kiosk/` + `dart run tool/assemble_site.dart`: succeeded, 0 `.json` sidecars in `build/web/img` or `build/web/images`
- `cd functions && npm test`: 18/18 passed (including `verifyPaymongoSignature` and `isCountableOrder` tests)
- `npm run test:site`: 17/17 passed
- Headless browser screenshots captured at `docs/evidence/site-wide-audit/`:
  - `home-1440.png`, `home-390.png`
  - `menu-1440.png`, `menu-390.png`
  - `payment-success-390.png`
