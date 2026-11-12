# Storefront script tests

## What was wrong

`site/app.js` is the only script the storefront ships: the sticky bar, the scroll
reveals, and the map/street-view swap. It had no tests. A selector that stopped
matching the markup would fail silently in production — the page would still
load, just without the behaviour, and nothing would say so.

## What changed

`test/site/app.test.mjs` runs the real pages through the real `site/app.js` in
jsdom, so the tests fail if either the script or the markup it depends on drifts.
Driving the actual pages rather than a synthetic fixture means the tests also
prove the selectors still match.

Both pages that ship the script are covered: `site/index.html` and
`site/menu/index.html`.

Nine tests:

1. `index.html` still loads the script the tests exercise;
2. the menu page loads the same script;
3. the menu page keeps its bar and engages the reveal;
4. the bar only sticks once the page has scrolled, and releases at the top;
5. reduced motion hides nothing and writes no reveal state;
6. without `IntersectionObserver` the menu and photos appear at once;
7. with `IntersectionObserver` the reveal waits for the section to arrive, then
   disconnects;
8. a section that never intersects stays unrevealed;
9. the map and street view swap one at a time, `aria-pressed` included.

jsdom ships no `matchMedia` and no `IntersectionObserver`, so both are stubbed —
which is also how the fallback branches get exercised.

## Proof the tests can fail

Broke the sticky-bar selector in `site/app.js` (`.bar` → `.topbar`):

```text
$ npm run test:site
✖ the bar only sticks once the page has scrolled
ℹ pass 6
ℹ fail 1
```

Broke `.bar` on the menu page only (`site/menu/index.html`):

```text
$ npm run test:site
✖ the menu page keeps the bar and reveal behaviour
ℹ pass 8
ℹ fail 1
  AssertionError: site/menu/index.html must keep a .bar for the sticky state
```

Both files were restored byte-identically afterwards.

## Result

```text
$ npm run test:site
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

## Wiring

- `jsdom` added as a root dev dependency.
- `npm run test:site` runs `node --test test/site/app.test.mjs`. The path is
  named explicitly rather than globbed: a glob that matches nothing exits 0 with
  `tests 0`, so the job would go green if the file were renamed or moved.
- New `site` job in `.github/workflows/pr-checks.yml` runs `npm ci` then
  `npm run test:site`.

The test lives in `test/site/`, not `site/`, because `tool/assemble_site.dart`
copies everything under `site/` into the deploy — a test file there would ship to
production.

`site` is not yet a required status check in branch protection. It should be
added alongside `flutter`, `functions`, `rules`, and `proof`.
