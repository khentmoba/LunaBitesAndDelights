# Mobile-First & Android/iOS Adaptive Audit Evidence

## Scope

Audited and updated both surfaces (`site/` storefront and `lib/` Flutter app + `android/` / `ios/` native manifests) to ensure the UI is mobile-first and behaves natively on Android and iOS rather than desktop/kiosk web.

## Automated Verification

- `flutter analyze --no-fatal-infos --no-fatal-warnings`: **0 issues**
- `flutter test`: **56/56 tests passed**, including new mobile/adaptive tests in `test/adaptive_layout_test.dart`:
  - `KioskSplashScreen` at `320x568`, `640x360` landscape, and `disableAnimations: true` (Reduce Motion)
  - `KioskCartPage` steppers meeting `>= 44x44` touch targets and compact mobile bottom bar at `320x640`
  - `MapPickerPage` using native `FlutterMap` on both `TargetPlatform.android` and `TargetPlatform.iOS` with `>= 48x48` My Location control and bottom-sheet `CONFIRM LOCATION` button at `320x640`
  - `StaffLoginDialog` and `AdminDashboard` fitting `320x640` without horizontal overflow
- `npm run test:site`: **20/20 tests passed** (sticky bar height `--bar-h`, Bricolage kerning parity, font preloads, reduced motion, weak-device probe)
- `flutter build web --release --base-href /kiosk/` + `dart run tool/assemble_site.dart`: succeeded

## Visual Evidence (Headless Chromium)

- `docs/evidence/mobile-storefront-320.png` (`320x640`): sticky bar stays on a single 62px row with `scrollWidth <= innerWidth` (`overflow: false`).
- `docs/evidence/mobile-storefront-390.png` (`390x844`): sticky bar, slip header, headline, lede, and both primary action buttons visible in the first viewport (`overflow: false`).
- `docs/evidence/mobile-kiosk-menu-320.png` (`320x640`): compact mobile section header + 2-column product grid render cleanly without clipping.
- `docs/evidence/mobile-kiosk-menu-390.png` (`390x844`): category chips, compact header, and product cards render cleanly.

## Hardware / Simulator Gaps

- No Android emulator/device (`adb devices -l` empty) or iOS Simulator (Windows host) is attached in this environment; native `apk`/`ipa` runtime gestures (predictive back swipe, iOS edge-swipe, native geolocation prompt, and TalkBack/VoiceOver traversal) remain verified via Flutter widget tests (`TargetPlatform.android` / `TargetPlatform.iOS`) and static manifest checks rather than live device execution.
