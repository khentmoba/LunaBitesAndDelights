# Local run of every `pr-checks` job

Run on the worktree at `t3/identify-improvements`, Flutter 3.47.7, Node 24.22.2.

| Job | Result |
| --- | --- |
| `flutter` — analyze + baseline | pass, 0 issues, baseline 0 |
| `flutter` — format check | pass, 0 changed after formatting |
| `flutter` — regression tests | pass, 44/44 |
| `flutter` — web build | pass, `√ Built build\web` |
| `functions` — TypeScript build | pass, TS 5.9.3, exit 0 |
| `rules` — emulator | **not runnable locally**, see below |
| `site` — storefront script tests | pass, 7/7 |
| `proof` — proof gate | pass, see PR body |

## Notes

**`functions` needed the locked TypeScript.** `functions/node_modules` had no
TypeScript installed, so `npx tsc` fetched a TS 6.x and failed with
`TS5011: The common source directory of 'tsconfig.json' is './src'`. That was a
local environment artifact, not a regression: after `npm ci` installed the locked
TS 5.9.3, `npm run build` exits 0.

Running the build regenerated the committed `functions/lib/*.js` artifacts with
different output than what is checked in. That is a pre-existing version mismatch
unrelated to this change, so `functions/lib` was reverted to keep the diff
focused.

**`rules` cannot run here.** `firebase-tools` requires Java 21; this machine has
Java 8. `npm run test:rules` exits with:

```text
Error: firebase-tools no longer supports Java version before 21.
```

CI runs it on Java 21. This change touches no rules files, and
`firestore.rules` is unchanged.

`npm run check:rules-drift` is read-only but needs GCP credentials, which are not
present locally; it reports `Could not load the default credentials` and exits 0.

## Runtime proof for the `dart:js_interop` geolocation rewrite

`lib/services/location.dart` moved its web path into `lib/services/location_web.dart`
using `dart:js_interop`, replacing the deprecated `dart:js`. Compiling is not
proof that interop resolves at runtime, so the path was exercised in a browser.

Built with `--base-href=/kiosk/`, assembled with `tool/assemble_site.dart`, served
locally, geolocation set to the kiosk's own coordinates (9.0205278, 125.5176389),
then: menu → add item → cart → checkout → DELIVERY → "Tap to pin your location
on map".

The map picker opened and reverse-geocoded the position to
**"Pandanon-Magallanes Road, Poblacion"** — a real address at those coordinates.
That address can only come from `currentPosition()` returning a position, so the
`dart:js_interop` path works at runtime.

![Map picker after the dart:js_interop rewrite](map-picker-geolocation-web-390.png)

The map tiles themselves show "Map preview is unavailable" in this local build;
that is the MapTiler key not being configured locally and is unrelated to this
change.

No order was submitted. The checkout confirmation dialog was dismissed with
Escape rather than clicked, so nothing was written to production Firestore.

![Kiosk menu after the analyzer cleanup](kiosk-after-analyzer-cleanup-390.png)
