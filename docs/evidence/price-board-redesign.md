# Price board redesign

The storefront price board now uses a continuous cream menu panel, red category signage, readable item names, prominent aligned prices and a joined vermilion strip for the two ₱99 meal offers. The surrounding storefront retains its existing design.

## Rendered evidence

- [Desktop, 1440px](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/price-board-desktop.png?raw=true)
- [Phone, 390px](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/price-board-mobile.png?raw=true)
- [Phone meal offers and delivery notice](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/price-board-offers-mobile.png?raw=true)
- [Small phone, 320px](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/price-board-320.png?raw=true)
- [Tablet, 768px](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/price-board-tablet.png?raw=true)
- [Compact desktop, 1024px](https://github.com/khentmoba/LunaBitesAndDelights/blob/evidence/docs/evidence/price-board-1024.png?raw=true)

Each file is a section viewport captured from the locally served current `site/` source. They are review evidence, not shipping site assets. The desktop capture shows the complete section; the phone captures show the beginning and the offer strip separately. No new product photography or generated raster assets were introduced.

## Verification

Browser checks at 320, 390, 768, 1024 and 1440 CSS pixels found no horizontal overflow. At 320, 768 and 1024 pixels, every element in the board stayed within the viewport. Both board links point to `/kiosk/#/menu` and have at least 44px target heights. Full live kiosk navigation was not exercised by the static preview.

A normalized source comparison against the parent commit confirms that all 17 item rows and both offer blocks retain their content and prices. The misleading combined “Shawarma · rice” category heading is now “Shawarma”; the ₱99 shawarma rice option remains in the Sulit meal description.

A fresh delegated Impeccable finish reviewer returned **ship**, with no material findings in the desktop and 390px captures. It confirmed readable hierarchy, comfortable spacing and source-color contrast: coffee on cream approximately 14.8:1, cream on vermilion approximately 6.1:1, and muted text on the dark board approximately 7.0:1. It did not independently run a browser or inspect the intermediate-width captures.

The mechanical detector ran once. Its cramped-padding warnings do not match the computed browser layout: row padding is 13px vertically, category insets are 20–30px, section gutters are at least 18px, and offer rows have 22px vertical padding. Existing page-wide advisories were left outside this section's scope.

Flutter analysis completed with 119 informational findings and no errors or warnings using `--no-pub`; all 26 Flutter tests passed using `--no-pub`. The initial standard commands encountered Windows symlink support during package setup. The local SDK's incidental lockfile changes were restored and are not part of the redesign.

After installing the locked Functions dependencies, `npm run build` and `npm audit --audit-level=high` passed. The final audit reports 15 moderate advisories and no high or critical advisories. `node --check site/app.js` and `git diff --check` passed. Rules were not changed, so emulator rules tests were not rerun.

Impeccable context also reported pre-existing platform and design-sidecar drift. Those broader repairs were kept outside the requested price-board redesign; the new section treatment is documented locally.
