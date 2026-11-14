# Kiosk redirect loop

## Symptom
Safari: "Load cannot follow more than 20 redirections" on lunabitesanddelights.web.app. Every Order button links to `/kiosk/#/menu`.

## Cause
`d17acb5` added `{"source": "/kiosk", "destination": "/kiosk/", "type": 301}` to the `app-site` hosting config. Production Hosting matches a redirect source with or without a trailing slash, so `/kiosk/` matched too and redirected to itself (`live-before.txt`). The local superstatic emulator serves `/kiosk/` with a 200, so local testing missed it.

## Fix
Removed the rule. Hosting already adds the trailing slash for a directory with an `index.html`, as `/menu` -> `/menu/` shows on production with no rule.

## Guards
- `test/site/hosting.test.mjs` (runs in the `site` PR job): fails when a redirect's destination, with or without its trailing slash, matches its own source. It fails on the old config (`test-against-old-config.txt`) and passes on the new one (`test-site.txt`).
- `firebase-hosting-merge.yml`: after deploy, `curl -L --max-redirs 3` against `/`, `/menu`, `/kiosk`, `/kiosk/`, and the payment pages. Any loop or non-200 fails the deploy run.

## Local checks
| Job | Result |
|---|---|
| site (`npm run test:site`) | 23/23 pass |
| flutter analyze + baseline | 0 issues |
| flutter test | 52 pass |
| functions build | pass |
| rules (`npm run test:rules`) | not run: local JDK < 21. `firestore.rules` is unchanged; CI runs it. |
| flutter build web | not run locally: no Dart or web changes; CI runs it. |
