---
version: 1
slug: "site-index-html"
primary_target: "app/src/pages/index.astro"
related_targets: []
---

## Scope

The storefront at the site root (`/`), a hand-written static page. The ordering app stays at `/kiosk/` and is linked into, never duplicated. One route, one artifact, one first viewport. This is a replacement visual world: the jeepney enamel world is retired.

## Audience, job, action

Hungry people inside delivery range of Purok 5, on phones, arriving from a Facebook link, a shared message, or someone's word. They decide in under a minute: what is this, what does it cost, will it come to me. Walk-ins are secondary and only need the landmark. Action: start the order in the app, with a clear notice that the rider confirms the separate delivery fee.

## Proof and content

Real prices from `app/src/data/menu.ts`, real photographs, the rider-confirmed delivery-fee policy, the real address, exact coordinates, the 7/11 landmark, the real Facebook page, hours 9am to 8pm, the owner's new circular Luna logo. No phone number, no ratings, no testimonials.

## Constraints

- Mobile-first over slow data: no framework, no icon library, self-hosted fonts only.
- `/kiosk/` keeps its behaviour; the storefront only links into it.
- Delivery-fee notice visible without interaction; `prefers-reduced-motion` respected; focus rings themed.
- Never invent a fact to fill a hole.

## Direction contract

THESIS: The storefront is a kiosk duplicate order pad — the pink carbonless booklet the cashier writes your order on. It refuses the food-site default of photo hero, headline-and-button and equal menu cards.

OWN-WORLD: Pink watercolor carbon copy as the ground (owner-supplied texture), white top sheets with perforated tear edges, logo pink #EC1C72 printed rules and form labels, butter yellow #FCD04E as the highlighter and the "paid" plate, plum-black ink. Three inks plus paper (raise from risograph). Bricolage Grotesque prints the form; Caveat is the cashier's handwriting, used only for marks written onto the form. Prices always sit in one ruled right column (raise from split-flap). Rubber-stamp marks for B1T1 and offers.

STORY: One look says this is Luna's own order slip — food, real prices, delivery, rider confirms the fee. Tap the pink stamp to start an order.

FIRST VIEWPORT: The logo sits as the pad's printed header next to slip number, date line and "Order slip"; a top sheet carries the tagline, a mounted shawarma photo clipped to the sheet with its handwritten ₱60 line, and the primary Order button; the delivery-fee notice is printed at the bottom of the slip above the tear line. Phones: header, sheet, order, notice in DOM order.

FORM: Pink order pad, sixth on my resonance list; seed:176d4a399b859e5a

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

A contact number is still coming from the owner; until then the page says nothing about it. The rider confirms delivery charges; the site publishes no numeric rate.
