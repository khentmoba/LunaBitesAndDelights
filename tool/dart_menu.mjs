// Reads lib/data/menu_data.dart into plain objects, with the defaults from
// lib/models/menu.dart applied. Used by test/site/menu.test.mjs to keep
// app/src/data/menu.ts equal to the Flutter menu until Flutter is removed.
import { readFileSync } from 'node:fs';

const DEFAULTS = {
  MenuSection: { subtitle: '' },
  MenuItem: {
    price: null, imageUrl: '', variants: [], isBuy1Take1: false, allowMultiSelect: false,
    maxSelect: 1, optionHeader: 'CHOOSE OPTION', promoLabel: null, isHeader: false,
  },
  MenuVariant: { isBuy1Take1: false },
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1; let s = '';
      while (src[j] !== c) {
        if (src[j] === '\\') { const n = src[j + 1]; s += n === 'n' ? '\n' : n; j += 2; } else { s += src[j]; j++; }
      }
      const prev = tokens[tokens.length - 1];
      if (prev && prev.t === 'str') prev.v += s; else tokens.push({ t: 'str', v: s });
      i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+/.exec(src.slice(i)); tokens.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); tokens.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    tokens.push({ t: 'p', v: c }); i++;
  }
  return tokens;
}

export function parseDartMenu(path) {
  const src = readFileSync(path, 'utf8');
  const tokens = tokenize(src.slice(src.indexOf('kMenuSections')));
  let k = tokens.findIndex((t) => t.v === '[');
  const expect = (v) => { if (tokens[k].v !== v) throw new Error(`expected ${v} at token ${k}, got ${tokens[k].v}`); k++; };
  function value() {
    const t = tokens[k];
    if (t.t === 'str' || t.t === 'num') { k++; return t.v; }
    if (t.v === 'true' || t.v === 'false') { k++; return t.v === 'true'; }
    if (t.v === 'null') { k++; return null; }
    if (t.v === 'const') { k++; return value(); }
    if (t.v === '[') {
      k++; const out = [];
      while (tokens[k].v !== ']') { out.push(value()); if (tokens[k].v === ',') k++; }
      k++; return out;
    }
    if (t.t === 'id' && DEFAULTS[t.v]) {
      const type = t.v; k++; expect('(');
      const obj = {};
      while (tokens[k].v !== ')') {
        const key = tokens[k].v; k++; expect(':');
        obj[key] = value();
        if (tokens[k].v === ',') k++;
      }
      k++;
      return { ...DEFAULTS[type], ...obj };
    }
    throw new Error(`unexpected token ${JSON.stringify(t)} at ${k}`);
  }
  return value();
}
