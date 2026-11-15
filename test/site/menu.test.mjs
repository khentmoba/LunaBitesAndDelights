import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDartMenu } from '../../tool/dart_menu.mjs';
import { menuSections, priceOf } from '../../app/src/data/menu.ts';

/// The storefront prints prices from app/src/data/menu.ts; the Flutter kiosk
/// and checkout still charge from lib/data/menu_data.dart. Until Flutter is
/// removed the two must be the same menu, field for field, or the page would
/// quote one price and the kiosk charge another.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ITEM_DEFAULTS = {
  price: null, imageUrl: '', variants: [], isBuy1Take1: false, allowMultiSelect: false,
  maxSelect: 1, optionHeader: 'CHOOSE OPTION', promoLabel: null, isHeader: false,
};

function withDefaults(sections) {
  return sections.map((s) => ({
    subtitle: '',
    ...s,
    items: s.items.map((i) => ({
      ...ITEM_DEFAULTS,
      ...i,
      variants: (i.variants ?? []).map((v) => ({ isBuy1Take1: false, ...v })),
    })),
  }));
}

test('menu.ts is the same menu as lib/data/menu_data.dart', () => {
  const dart = parseDartMenu(join(root, 'lib', 'data', 'menu_data.dart'));
  assert.ok(dart.length > 0, 'parsed no sections from menu_data.dart');
  assert.deepEqual(withDefaults(menuSections), withDefaults(dart));
});

test('priceOf reads item and variant prices and rejects unknown ones', () => {
  assert.equal(priceOf('s1', 'Solo'), 60);
  assert.equal(priceOf('b1'), 55);
  assert.throws(() => priceOf('nope'), /Unknown menu item/);
  assert.throws(() => priceOf('s1', 'Made up'), /Unknown variant/);
  assert.throws(() => priceOf('s1'), /no single price/);
});
