# Storefront price guard

## What was wrong

`test/menu_price_parity_test.dart` checks the kiosk (`lib/data/menu_data.dart`)
against the server price map (`functions/src/payments/create_checkout.ts`).
Nothing checked the storefront. No test in `test/` read `site/index.html` or
`site/menu/index.html`.

Those two pages carry 38 hand-copied price rows — the top-of-funnel surface for a
business whose success metric is "a delivery order placed from a phone". A price
change in `menu_data.dart` shipped to the kiosk and silently left the landing
page quoting the old number.

## Was it already wrong?

No. Measured before writing the guard: 24 rows matched exactly, 14 differed only
in label wording (`&amp;`, `· Buddy, 1–2 pax`), and the one apparent mismatch —
Shawarma Wrap at ₱60 against ₱99 — is correct, because that item has variants
(Solo ₱60, Buy 1 Take 1 ₱99).

So this closes a missing guard, not a live bug. Said plainly because "we fixed a
price bug" would be a nicer story and a false one.

## What changed

`test/site_price_parity_test.dart` reads both pages, resolves every printed price
back to the menu item or variant it came from via an explicit `_priceSources`
map, and asserts:

1. both pages still print prices at all (parser and markup agree);
2. every printed price equals the price the menu charges;
3. both pages print the same rows, so the landing page and the full menu page
   cannot diverge;
4. no `_priceSources` entry is dead, so the map cannot rot.

Adding a storefront row without recording where its price comes from fails the
test. That is the point: the mapping is knowledge, and it has to be maintained.

## Proof the guard can fail

Injected a ₱65 price for Shawarma Wrap into `site/index.html`:

```text
$ flutter test test/site_price_parity_test.dart
00:00 +1 -1: every printed price is the price the menu charges [E]
  Expected: empty
    Actual: [
              'site/index.html: "Shawarma Wrap" prints ₱65 but the menu charges ₱60 (s1#Solo)'
            ]
```

The message names the file, the row, the printed price, the real price, and the
source. `site/index.html` was restored byte-identically afterwards
(`git diff --stat site/index.html` empty).

## Result

```text
$ flutter test
00:03 +44: All tests passed!
```

40 existing tests plus 4 new ones.
