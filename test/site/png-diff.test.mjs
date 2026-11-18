import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { crop, diff } from '../../tool/png_diff.mjs';

const blank = (w, h) => { const p = new PNG({ width: w, height: h }); p.data.fill(200); return p; };

test('png_diff counts changed pixels and boxes them', () => {
  const a = blank(2000, 100), b = blank(2000, 100);
  for (const [x, y] of [[10, 20], [1500, 60]]) b.data[(y * 2000 + x) * 4 + 2] = 0;
  assert.deepEqual(diff(a, b), { n: 2, box: { x: 10, y: 20, w: 1491, h: 41 } });
  assert.deepEqual(diff(a, blank(2000, 100)), { n: 0 });
  assert.deepEqual(diff(a, blank(10, 10)), { size: ['2000x100', '10x10'] });
});

test('png_diff crop stays within 800px wide', () => {
  const a = blank(2000, 100), b = blank(2000, 100);
  const out = crop(a, b, { x: 10, y: 20, w: 1491, h: 41 });
  assert.ok(out.width <= 800 && out.width > 0 && out.height > 0, `${out.width}x${out.height}`);
});
