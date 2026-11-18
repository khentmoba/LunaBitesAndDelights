import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { menuSections } from '../../app/src/data/menu.ts';

/// createCheckoutSession rejects any line whose name, variant or price is not in
/// its own price list. These checks fail when that list drifts from the menu the
/// kiosk charges from, so a price change in menu.ts cannot break online payment.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'functions', 'src', 'payments', 'create_checkout.ts'), 'utf8');

function objectLiteral(name) {
  const match = source.match(new RegExp(`const ${name}: [^=]+= (\\{[\\s\\S]*?\\n\\});`));
  assert.ok(match, `${name} not found in create_checkout.ts`);
  return new Function(`return ${match[1]}`)();
}

const MENU_PRICES = objectLiteral('MENU_PRICES');
const VARIANT_PRICES = objectLiteral('VARIANT_PRICES');
const menuItems = menuSections.flatMap((s) => s.items).filter((i) => !i.isHeader);

/** Every price the kiosk sheet can put on a line: base plus up to maxSelect flavour surcharges. */
function multiSelectPrices(item) {
  const totals = new Set();
  const walk = (start, picked, total) => {
    if (picked > 0) totals.add(total);
    if (picked === (item.maxSelect ?? 1)) return;
    for (let i = start; i < item.variants.length; i++) walk(i + 1, picked + 1, total + item.variants[i].price);
  };
  walk(0, 0, item.price ?? 0);
  return [...totals];
}

function linePrices(item) {
  if (item.allowMultiSelect) return multiSelectPrices(item);
  if (item.variants?.length) return item.variants.map((v) => v.price);
  return [item.price];
}

test('the checkout price list knows every menu item at every price the kiosk can charge', () => {
  for (const item of menuItems) {
    const allowed = MENU_PRICES[item.name];
    assert.ok(allowed, `"${item.name}" (${item.id}) is missing from MENU_PRICES in functions/src/payments/create_checkout.ts`);
    for (const price of linePrices(item)) {
      assert.ok(allowed.includes(price), `"${item.name}" (${item.id}) can cost ₱${price}, but MENU_PRICES allows only ${allowed.join(', ')}`);
    }
  }
});

test('items whose variants cost different amounts pin each variant to its price', () => {
  for (const item of menuItems) {
    if (item.allowMultiSelect || !item.variants?.length) continue;
    const pinned = VARIANT_PRICES[item.name];
    if (new Set(item.variants.map((v) => v.price)).size > 1) {
      assert.ok(pinned, `"${item.name}" (${item.id}) has variants at different prices but no VARIANT_PRICES entry`);
    }
    if (!pinned) continue;
    const fromMenu = Object.fromEntries(item.variants.map((v) => [v.label, v.price]));
    assert.deepEqual(pinned, fromMenu, `VARIANT_PRICES["${item.name}"] does not match the menu's variants`);
  }
});

test('the parser reads the real price list', () => {
  assert.ok(Object.keys(MENU_PRICES).length > 50);
  assert.ok(Object.keys(VARIANT_PRICES).length > 0);
});
