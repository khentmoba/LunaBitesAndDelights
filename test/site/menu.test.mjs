import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { menuSections, priceOf } from '../../app/src/data/menu.ts';

/// app/src/data/menu.ts is the one menu the storefront prints and the kiosk
/// and staff screens charge from. These checks keep it self-consistent.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every menu item has a unique id, a price, and a photo that ships', () => {
  const ids = new Set();
  for (const section of menuSections) {
    for (const item of section.items) {
      if (item.isHeader) continue;
      assert.ok(!ids.has(item.id), `duplicate menu id ${item.id}`);
      ids.add(item.id);
      // Multi-select flavours are free picks on a priced item; otherwise each variant is the price.
      const prices = item.variants?.length && !item.allowMultiSelect ? item.variants.map((v) => v.price) : [item.price];
      for (const p of prices) assert.ok(Number.isInteger(p) && p > 0, `${item.id} has price ${p}`);
      for (const v of item.variants ?? []) assert.ok(Number.isInteger(v.price) && v.price >= 0, `${item.id} ${v.label} has price ${v.price}`);
      if (item.imageUrl) {
        assert.ok(existsSync(join(root, 'app', 'public', 'kiosk', item.imageUrl)), `${item.id}: app/public/kiosk/${item.imageUrl} is missing`);
      }
    }
  }
  assert.ok(ids.size > 50, `only ${ids.size} menu items`);
});

test('priceOf reads item and variant prices and rejects unknown ones', () => {
  assert.equal(priceOf('s1', 'Solo'), 60);
  assert.equal(priceOf('b1'), 55);
  assert.throws(() => priceOf('nope'), /Unknown menu item/);
  assert.throws(() => priceOf('s1', 'Made up'), /Unknown variant/);
  assert.throws(() => priceOf('s1'), /no single price/);
});
