"""Drop Bricolage kerning pairs that no storefront page renders.

The variable `kern` lookup in the full subset covers every Latin pair and is
~38% of the WOFF2. Only pairs listed by tool/kern_pairs.mjs are kept, with
their original values and variation deltas, so the rendered pages are
unchanged. Digit pairs also keep their `tnum` forms (prices use
tabular-nums).

    node tool/kern_pairs.mjs
    python tool/prune_kerning.py

Source: tool/fonts/bricolage-source.woff2 (the unpruned subset, not served).
It fails if the source lacks a character the pages render, so a lossy
re-subset cannot ship a glyph that silently falls back.
"""
import json
import sys
from pathlib import Path

from fontTools.otlLib.builder import buildPairPosGlyphsSubtable
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tool" / "fonts" / "bricolage-source.woff2"
PAIRS = ROOT / "tool" / "fonts" / "bricolage-kern-pairs.json"
OUT = ROOT / "site" / "fonts" / "bricolage.woff2"
# Only the map coordinates use these; no Bricolage release has them.
KNOWN_FALLBACK = set("\u2032\u2033")


def single_subs(font, tag):
    out = {}
    gsub = font["GSUB"].table
    for rec in gsub.FeatureList.FeatureRecord:
        if rec.FeatureTag != tag:
            continue
        for index in rec.Feature.LookupListIndex:
            for st in gsub.LookupList.Lookup[index].SubTable:
                out.update(getattr(st, "mapping", {}) or {})
    return out


def pair_value(subtables, first, second):
    """Value a shaper applies to (first, second): first matching subtable wins."""
    for st in subtables:
        if first not in st.Coverage.glyphs:
            continue
        if st.Format == 1:
            pair_set = st.PairSet[st.Coverage.glyphs.index(first)]
            for rec in pair_set.PairValueRecord:
                if rec.SecondGlyph == second:
                    return rec.Value1
            continue
        c1 = st.ClassDef1.classDefs.get(first, 0)
        c2 = st.ClassDef2.classDefs.get(second, 0)
        return st.Class1Record[c1].Class2Record[c2].Value1
    return None


def is_zero(value):
    return value is None or (
        not getattr(value, "XAdvance", 0) and getattr(value, "XAdvDevice", None) is None
    )


def main():
    font = TTFont(SOURCE, recalcTimestamp=False)
    cmap = font.getBestCmap()
    tnum = single_subs(font, "tnum")
    pairs = json.loads(PAIRS.read_text(encoding="utf-8"))
    missing = sorted({c for p in pairs for c in p if not c.isspace() and ord(c) not in cmap} - KNOWN_FALLBACK)
    if missing:
        sys.exit(f"{SOURCE.name} lacks page characters {''.join(missing)!r}; re-subset it with them")
    glyph_pairs = set()
    for pair in pairs:
        a, b = (cmap.get(ord(c)) for c in pair)
        if not a or not b:
            continue
        for x in {a, tnum.get(a, a)}:
            for y in {b, tnum.get(b, b)}:
                glyph_pairs.add((x, y))

    gpos = font["GPOS"].table
    kern_lookups = {
        i for rec in gpos.FeatureList.FeatureRecord if rec.FeatureTag == "kern"
        for i in rec.Feature.LookupListIndex
    }
    if len(kern_lookups) != 1:
        sys.exit(f"expected one kern lookup, found {sorted(kern_lookups)}")
    lookup = gpos.LookupList.Lookup[kern_lookups.pop()]
    if lookup.LookupType != 2:
        sys.exit(f"kern lookup is type {lookup.LookupType}, expected PairPos (2)")

    kept = {}
    for first, second in sorted(glyph_pairs):
        value = pair_value(lookup.SubTable, first, second)
        if not is_zero(value):
            kept[(first, second)] = (value, None)

    subtable = buildPairPosGlyphsSubtable(kept, font.getReverseGlyphMap())
    lookup.SubTable = [subtable]
    lookup.SubTableCount = 1

    # Keep every glyph and feature; this only prunes the now-unused
    # variation rows and recompacts the tables.
    options = Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.glyph_names = False
    options.flavor = "woff2"
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=cmap.keys())
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(OUT)
    print(f"{len(glyph_pairs)} text pairs, {len(kept)} kerned -> {OUT} ({OUT.stat().st_size} B)")


if __name__ == "__main__":
    main()
