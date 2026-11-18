// Compares screenshots without opening them: for each <name>-old.png /
// <name>-new.png pair (or two files given directly) prints the changed-pixel
// count and its bounding box, and writes <name>-diff.png, the old|new crop of
// just the changed region, at most 800px wide. Open that crop, and only when
// a pair reports changes; the full-size shots cost far more to read.
//
//   node tool/png_diff.mjs <dir> [<dir>...]
//   node tool/png_diff.mjs before.png after.png
//
// A pixel differs when any RGB channel differs. Exits 1 when any pair differs.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PNG } from 'pngjs';

const MAX_W = 800;
const PAD = 8;

export function diff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { size: [`${a.width}x${a.height}`, `${b.width}x${b.height}`] };
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return n ? { n, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } } : { n: 0 };
}

/** Old and new crops of `box` (padded) side by side, nearest-neighbour scaled to fit MAX_W. */
export function crop(a, b, box) {
  const x = Math.max(0, box.x - PAD), y = Math.max(0, box.y - PAD);
  const w = Math.min(a.width, box.x + box.w + PAD) - x, h = Math.min(a.height, box.y + box.h + PAD) - y;
  const gap = 4, scale = Math.min(1, MAX_W / (w * 2 + gap));
  const ow = Math.max(1, Math.round((w * 2 + gap) * scale)), oh = Math.max(1, Math.round(h * scale));
  const out = new PNG({ width: ow, height: oh });
  out.data.fill(255);
  for (let oy = 0; oy < oh; oy++) {
    for (let ox = 0; ox < ow; ox++) {
      const sx = Math.floor(ox / scale), sy = y + Math.floor(oy / scale);
      const src = sx < w ? a : sx >= w + gap ? b : null;
      if (!src) continue;
      const si = (sy * a.width + x + (sx < w ? sx : sx - w - gap)) * 4, oi = (oy * ow + ox) * 4;
      src.data.copy(out.data, oi, si, si + 4);
    }
  }
  return out;
}

const load = (f) => PNG.sync.read(readFileSync(f));

function report(name, oldFile, newFile, outFile) {
  const a = load(oldFile), b = load(newFile);
  const r = diff(a, b);
  if (r.size) return console.log(`${name}  SIZE ${r.size[0]} -> ${r.size[1]}`), 1;
  if (!r.n) return console.log(`${name}  same`), 0;
  writeFileSync(outFile, PNG.sync.write(crop(a, b, r.box)));
  console.log(`${name}  ${r.n} px differ in ${r.box.w}x${r.box.h} at (${r.box.x},${r.box.y}) -> ${outFile}`);
  return 1;
}

function main(args) {
  if (!args.length) return console.error('usage: node tool/png_diff.mjs <dir>... | <old.png> <new.png>'), 2;
  if (args.length === 2 && args.every((f) => f.endsWith('.png') && statSync(f).isFile())) {
    return report(basename(args[1], '.png'), args[0], args[1], args[1].replace(/\.png$/, '-diff.png'));
  }
  let changed = 0;
  for (const d of args) {
    for (const f of readdirSync(d).filter((f) => f.endsWith('-old.png')).sort()) {
      const name = f.slice(0, -'-old.png'.length);
      changed += report(name, join(d, f), join(d, `${name}-new.png`), join(d, `${name}-diff.png`));
    }
  }
  console.log(changed ? `${changed} pair(s) differ` : 'no differences');
  return changed ? 1 : 0;
}

if (process.argv[1]?.endsWith('png_diff.mjs')) process.exitCode = main(process.argv.slice(2));
