// Lists every adjacent character pair the storefront pages can render, so
// tool/prune_kerning.py can drop the Bricolage kerning pairs no page uses.
//
//   node tool/kern_pairs.mjs            # rewrite tool/fonts/bricolage-kern-pairs.json
//   python tool/prune_kerning.py        # rebuild site/fonts/bricolage.woff2 from it
//
// test/site/app.test.mjs fails when page copy gains a pair missing from the
// committed list; rerun both commands when that happens.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const kernPages = ['site/index.html', 'site/menu/index.html'];
export const kernPairsFile = join(root, 'tool', 'fonts', 'bricolage-kern-pairs.json');

/// Text that can be painted: body text (noscript included, since it renders
/// without script) plus CSS `content:` strings. Case variants cover
/// `text-transform`; whitespace is collapsed the way the page lays it out.
export function renderedStrings(html) {
  const doc = new JSDOM(html).window.document;
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  doc.querySelectorAll('noscript').forEach((el) => el.replaceWith(doc.createTextNode(` ${el.textContent} `)));
  const strings = [doc.body.textContent.replace(/\s+/g, ' ')];
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  for (const m of css.matchAll(/content:\s*(['"])(.*?)\1/g)) strings.push(m[2]);
  return strings;
}

export function pagePairs(htmlList) {
  const pairs = new Set();
  for (const html of htmlList) {
    for (const base of renderedStrings(html)) {
      for (const s of [base, base.toUpperCase(), base.toLowerCase()]) {
        const chars = [...s];
        for (let i = 0; i < chars.length - 1; i += 1) pairs.add(chars[i] + chars[i + 1]);
      }
    }
  }
  return [...pairs].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pairs = pagePairs(kernPages.map((p) => readFileSync(join(root, p), 'utf8')));
  writeFileSync(kernPairsFile, JSON.stringify(pairs, null, 0) + '\n');
  console.log(`${pairs.length} pairs -> ${kernPairsFile}`);
}
