---
version: 1
slug: "lib-screens-menu-page-dart"
primary_target: "app/src/pages/kiosk/menu.astro"
related_targets: ["app/src/layouts/Kiosk.astro","app/src/kiosk/tokens.css","app/src/pages/kiosk/cart.astro","app/src/pages/kiosk/checkout.astro","app/src/pages/kiosk/index.astro","app/src/pages/kiosk/receipt.astro","app/src/data/menu.ts"]
---

## Mode

Operate. Visitors choose a category, inspect a dish and its price, choose any required options, set quantity, and add it to their order.

## Scope

The Astro ordering app at `/kiosk/`, built in the same Pink Order Pad world as the storefront (`/`): splash, menu, item chooser, order-slip cart, checkout, receipt and staff console. Pricing, payment and delivery rules are unchanged.

## Direction contract

THESIS: Stepping from the storefront into the app keeps you on the same pink order pad — the menu is the price board, and the cart is the slip you are writing on.

OWN-WORLD: Blush ground #FEB7C9 (with the owner's pink wash on the splash), paper slips #FFFAFB and white cards, Plate Pink #D91566 for stamps and selected categories, Logo Pink #EC1C72 for rules, Butter #FCD04E for taped promos, plum ink #2A0F1E. Bundled Bricolage 400–800 for printed UI and Caveat 600–700 for handwritten marks (quantities, prompts, tagline). 6px stamp corners, Material outline icons, no emoji icons.

STORY: Pick a category, see real photos and actual prices, satisfy any required choices, add to order, then review the order slip and check out. Closing details leaves the cart untouched.

FIRST VIEWPORT: Paper header with the circular Luna logo, wordmark, cart bag (badge hidden at zero) and utilities; horizontal category chips below 1000px or a 216px paper sidebar at 1000px+; a paper category slip with a 3px pink bottom rule; a 2–4 column grid of white product slips with taped butter promo tags, tabular prices and a Plate Pink add stamp. A paper bottom bar appears once the cart holds items.

FORM: Pink order pad, sixth on my resonance list; seed:176d4a399b859e5a

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
