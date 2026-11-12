import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The storefront prints its prices by hand in `site/index.html` and
/// `site/menu/index.html`, while `lib/data/menu_data.dart` is the only place a
/// price is allowed to change. Nothing connected the two: the kiosk and the
/// server have `menu_price_parity_test.dart`, but the landing page — the surface
/// a delivery customer actually lands on — had no guard. A reprice could ship to
/// the app and silently leave the page quoting the old number.
///
/// This test reads both pages, resolves every printed price back to the menu item
/// or variant it came from, and fails when they disagree. Adding a row to the
/// storefront without recording where its price comes from also fails, so the
/// mapping cannot rot quietly.

/// Where each printed storefront row gets its price.
///
/// `'id'` means the item's own price; `'id#Variant label'` means that variant's
/// price. The keys are the row labels exactly as the pages render them, after
/// HTML entities are decoded and whitespace is collapsed.
const Map<String, String> _priceSources = {
  'Shawarma Wrap': 's1#Solo',
  'Shawarma All Meat': 's2',
  'Shawarma Nachos': 's6',
  'Shawarma Quesadilla': 's7',
  'Shawarma Fries': 's5',
  'Wrap, buy 1 take 1': 's1#Buy 1 Take 1',
  'Combo 1 · burger + fries': 'c1',
  'Combo 2 · shawarma wrap + fries': 'c2',
  'Super Combo 1 · burger + fries + drink': 'sc1',
  'Super Combo 2 · wrap + fries + drink': 'sc2',
  'Combo 3 · 2 burgers + regular fries + 2 drinks': 'c3',
  'Combo 4 · wrap + burger + fries': 'c4_wrap_burger',
  'Combo 6 · wrap + shawarma burger + drink': 's10',
  'D1 · fries + drink': 'fd1',
  'D2 · fries + hotdog + drink': 'fd2',
  'D3 · fries + hotdog + cheesestick + drink': 'fd3',
  'D4 · fries + hotdog + cheesestick + fried siomai + drink': 'fd4',
  'Fries, buy 1 take 1': 'f4',
  'Large Fries': 'f3',
  'Bucket Fries': 'f5',
  'Terra Fries · 3 flavors': 'f2',
  'Fries & Nachos Overload · Buddy, 1–2 pax': 's8#Buddy (1–2 pax)',
  'Fries & Nachos Overload · Barkada, 3–5 pax': 's8#Barkada (3–5 pax)',
  'Burger Patty': 'b1',
  'Ham & Cheese': 'b2',
  'Cheese Burger': 'b3',
  'Burger with Egg': 'b4',
  'Cheese & Egg Burger': 'b5',
  'Shawarma Burger': 's4',
  'Coolers, any three': 'c_3for100',
  'Ube Halo Ice Cream': 'e5',
  'Mango Graham Ice Cream': 'e3',
  'Choco Oreo Ice Cream': 'e6',
  'Vanilla Cheese Ice Cream': 'e7',
  'Luna Leche Flan': 'e4',
  'Milo Dinosaur': 'mc1',
  'Caramel Macchiato': 'cf_macchiato',
  'Classic Lemonade': 'ls1',
};

/// One price the menu can charge, keyed by `id` or `id#Variant label`.
class _MenuPrices {
  final Map<String, int> bySource = {};

  /// The item id alone, for the "is this a real item" check.
  final Set<String> itemIds = {};

  _MenuPrices(String source) {
    // One `MenuItem(...)` declaration, up to its closing `),` at item indent.
    final itemPattern = RegExp(
      'MenuItem\\(\\s*id: \'([^\']*)\',\\s*name: (?:\'[^\']*\'|"[^"]*")'
      '([\\s\\S]*?)\\n      \\),',
    );
    for (final match in itemPattern.allMatches(source)) {
      final id = match.group(1)!;
      final body = match.group(2)!;
      if (body.contains('isHeader: true')) continue;
      itemIds.add(id);

      final variantPattern = RegExp(
        'MenuVariant\\(label: \'([^\']*)\', price: (\\d+)',
      );
      for (final variant in variantPattern.allMatches(body)) {
        bySource['$id#${variant.group(1)}'] = int.parse(variant.group(2)!);
      }

      // The item's own price, ignoring the `price:` inside variant lines.
      final ownPrice = RegExp(
        r'^\s*price: (\d+),',
        multiLine: true,
      ).firstMatch(body.replaceAll(RegExp(r'MenuVariant\([^)]*\)'), ''));
      if (ownPrice != null) {
        bySource[id] = int.parse(ownPrice.group(1)!);
      }
    }
  }
}

/// A row as the storefront prints it.
class _StorefrontRow {
  final String label;
  final int price;
  const _StorefrontRow(this.label, this.price);

  @override
  String toString() => '$label — ₱$price';
}

List<_StorefrontRow> _readStorefront(String path) {
  final html = File(path).readAsStringSync();
  final rowPattern = RegExp(
    r'<span class="row__name">([\s\S]*?)</span>\s*'
    r'<span class="row__price">₱([\d,]+)</span>',
  );

  final rows = <_StorefrontRow>[];
  for (final match in rowPattern.allMatches(html)) {
    final label = match
        .group(1)!
        .replaceAll(RegExp(r'<[^>]*>'), '')
        .replaceAll('&amp;', '&')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    rows.add(
      _StorefrontRow(label, int.parse(match.group(2)!.replaceAll(',', ''))),
    );
  }
  return rows;
}

void main() {
  final menu = _MenuPrices(File('lib/data/menu_data.dart').readAsStringSync());
  const pages = ['site/index.html', 'site/menu/index.html'];

  test('the storefront still prints prices at all', () {
    for (final page in pages) {
      expect(
        _readStorefront(page),
        isNotEmpty,
        reason: '$page printed no price rows; the parser or the markup changed',
      );
    }
  });

  test('every printed price is the price the menu charges', () {
    final problems = <String>[];

    for (final page in pages) {
      for (final row in _readStorefront(page)) {
        final source = _priceSources[row.label];
        if (source == null) {
          problems.add(
            '$page: "${row.label}" has no entry in _priceSources — say which '
            'menu item or variant it quotes',
          );
          continue;
        }

        final itemId = source.split('#').first;
        if (!menu.itemIds.contains(itemId)) {
          problems.add(
            '$page: "${row.label}" points at menu item "$itemId", which does '
            'not exist in menu_data.dart',
          );
          continue;
        }

        final expected = menu.bySource[source];
        if (expected == null) {
          problems.add(
            '$page: "${row.label}" points at "$source", which is not a price '
            'menu_data.dart can charge',
          );
          continue;
        }

        if (row.price != expected) {
          problems.add(
            '$page: "${row.label}" prints ₱${row.price} but the menu charges '
            '₱$expected ($source)',
          );
        }
      }
    }

    expect(problems, isEmpty, reason: problems.join('\n'));
  });

  test('both storefront pages print the same rows', () {
    final first = _readStorefront(
      pages.first,
    ).map((r) => r.toString()).toList();
    final second = _readStorefront(
      pages.last,
    ).map((r) => r.toString()).toList();

    expect(
      second,
      equals(first),
      reason:
          '${pages.first} and ${pages.last} disagree; the landing page and the '
          'full menu page must quote the same prices',
    );
  });

  test('the price source map has no dead entries', () {
    final printed = {
      for (final page in pages)
        for (final row in _readStorefront(page)) row.label,
    };
    final stale = _priceSources.keys
        .where((k) => !printed.contains(k))
        .toList();

    expect(
      stale,
      isEmpty,
      reason:
          'These labels are in _priceSources but no storefront row prints them: '
          '${stale.join(', ')}',
    );
  });
}
