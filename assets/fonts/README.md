# App fonts

The Flutter app bundles these fonts so its typography does not depend on a runtime font download.
They are static instances, subset to Latin plus the peso sign, cut from the upstream variable fonts with
`fontTools.varLib.instancer` and `fontTools.subset`.

| Local files | Upstream source | License |
|---|---|---|
| `Bricolage-400.ttf` … `Bricolage-800.ttf` (opsz 20, wdth 100) | https://github.com/google/fonts/blob/main/ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz%2Cwdth%2Cwght%5D.ttf | `OFL-Bricolage.txt` |
| `Caveat-600.ttf`, `Caveat-700.ttf` | https://github.com/google/fonts/blob/main/ofl/caveat/Caveat%5Bwght%5D.ttf | `OFL-Caveat.txt` |

Downloaded from Google Fonts on 2026-10-29. Flutter family names are `Bricolage` (printed type) and `Caveat`
(handwritten marks only). The storefront serves WOFF2 subsets of the same fonts from `app/public/fonts/`.
