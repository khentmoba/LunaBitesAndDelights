# Storefront script tests

## What was wrong

`site/app.js` is the only script the storefront ships: the sticky bar, the scroll
reveals, and the map/street-view swap. It had no tests. A selector that stopped
matching the markup would fail silently in production — the page would still
load, just without the behaviour, and nothing would say so.

## What changed

`test/site/app.test.mjs` runs the real `site/index.html` through the real
`site/app.js` in jsdom, so the tests fail if either the script or the markup it
depends on drifts. Driving the actual page rather than a synthetic fixture means
the tests also prove the selectors still match.

Seven tests:

1. `index.html` still loads the script the tests exercise;
2. the bar only sticks once the page has scrolled, and releases at the top;
3. reduced motion hides nothing and writes no reveal state;
4. without `IntersectionObserver` the menu and photos appear at once;
5. with `IntersectionObserver` the reveal waits for the section to arrive, then
   disconnects;
6. a section that never intersects stays unrevealed;
7. the map and street view swap one at a time, `aria-pressed` included.

jsdom ships no `matchMedia` and no `IntersectionObserver`, so both are stubbed —
which is also how the fallback branches get exercised.

## Proof the tests can fail

Broke the sticky-bar selector in `site/app.js` (`.bar` → `.topbar`):

```text
$ npm run test:site
✔ index.html still loads the script these tests exercise
✖ the bar only sticks once the page has scrolled
✔ reduced motion hides nothing and writes no reveal state
✔ without IntersectionObserver the menu and photos appear at once
✔ with IntersectionObserver the reveal waits for the section to arrive
✔ a section that never intersects stays unrevealed
✔ the map and street view swap one at a time
ℹ pass 6
ℹ fail 1
```

`site/app.js` was restored byte-identically afterwards (`git diff --stat
site/app.js` empty).

## Result

```text
$ npm run test:site
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

## Wiring

- `jsdom` added as a root dev dependency; `npm run test:site` runs the suite.
- New `site` job in `.github/workflows/pr-checks.yml` runs `npm ci` then
  `npm run test:site`.

The test lives in `test/site/`, not `site/`, because `tool/assemble_site.dart`
copies everything under `site/` into the deploy — a test file there would ship to
production.

`site` is not yet a required status check in branch protection. It should be
added alongside `flutter`, `functions`, `rules`, and `proof`.
