---
name: Luna Bites & Delights — Pink Order Pad
description: The storefront and ordering app printed as Luna's own duplicate order booklet, on the owner's pink wash.
colors:
  logo-pink: "#ec1c72"
  plate-pink: "#d91566"
  pink-press: "#b30e52"
  pink-ink: "#b30e52"
  pink-rule: "#f4afc8"
  blush: "#feb7c9"
  blush-paper: "#fff0f4"
  blush-light: "#ffe3ec"
  wash-base: "#f97cb3"
  paper: "#fffafb"
  card-white: "#ffffff"
  butter: "#fcd04e"
  ink: "#2a0f1e"
  ink-soft: "#6b3a52"
  ink-muted: "#7d4d64"
  on-plate: "#ffffff"
  success: "#1e7a3c"
  warning: "#b45309"
  error: "#b3261e"
  info: "#1f5fad"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 6.2vw, 4.75rem)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 6vw, 4.4rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.15rem, 1.8vw, 1.35rem)"
    fontWeight: 800
    lineHeight: 1.15
  body:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(16px, 1.05vw, 17px)"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.74rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.14em"
  price:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 780
    lineHeight: 1
    fontFeature: "tnum, lnum"
  hand:
    fontFamily: "Caveat, Segoe Print, Bradley Hand, cursive"
    fontSize: "clamp(1.45rem, 2.4vw, 1.75rem)"
    fontWeight: 600
    lineHeight: 1.1
  app-heading:
    fontFamily: "Bricolage"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.02
  app-body:
    fontFamily: "Bricolage"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  app-hand:
    fontFamily: "Caveat"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.1
rounded:
  hairline: "2px"
  slip: "4px"
  stamp: "6px"
  sheet: "8px"
spacing:
  gutter: "clamp(16px, 4.4vw, 56px)"
  inset: "clamp(20px, 3.6vw, 48px)"
  row: "11px"
  section: "clamp(28px, 4vw, 56px)"
  app-gap: "16px"
  app-gutter-compact: "16px"
  app-gutter-wide: "28px"
components:
  stamp-primary:
    backgroundColor: "{colors.plate-pink}"
    textColor: "{colors.on-plate}"
    rounded: "{rounded.stamp}"
    padding: "0.85em 1.45em"
    height: "48px"
  stamp-primary-hover:
    backgroundColor: "{colors.pink-press}"
    textColor: "{colors.on-plate}"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.pink-ink}"
    rounded: "{rounded.stamp}"
    padding: "0.8em 1.2em"
    height: "48px"
  button-line-hover:
    backgroundColor: "{colors.pink-ink}"
    textColor: "{colors.on-plate}"
  slip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "{spacing.inset}"
  section-band:
    backgroundColor: "{colors.plate-pink}"
    textColor: "{colors.on-plate}"
    typography: "{typography.label}"
    padding: "0.5em 0.75em"
  price-row:
    textColor: "{colors.ink}"
    typography: "{typography.price}"
    padding: "11px 0"
  delivery-note:
    backgroundColor: "{colors.blush-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.slip}"
    padding: "16px 24px"
  offer-strip:
    backgroundColor: "{colors.butter}"
    textColor: "{colors.ink}"
    padding: "24px 0"
  promo-tape:
    backgroundColor: "{colors.butter}"
    textColor: "{colors.ink}"
    padding: "5px 10px"
  category-chip:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stamp}"
  category-chip-selected:
    backgroundColor: "{colors.plate-pink}"
    textColor: "{colors.on-plate}"
    rounded: "{rounded.stamp}"
  product-card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stamp}"
    padding: "6px"
  option-row:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stamp}"
    padding: "4px 12px"
  option-row-selected:
    backgroundColor: "{colors.blush-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stamp}"
---

# Design System: Luna Bites & Delights — Pink Order Pad

## Overview

**Creative North Star: "The Pink Order Pad"**

Every Luna surface is a sheet torn from the kiosk's duplicate order booklet. The owner's pink watercolor is the
carbon copy underneath; white slips with perforated top edges sit on it; logo pink prints the form, its rules and
its column heads; the cashier's handwriting fills in what you are ordering. Prices always sit in one ruled column on
the right, the way they do on a real pad, so the eye runs down a single edge to compare them.

The world has three inks plus paper: logo pink, butter yellow and plum-black ink, on white and blush. Pink prints;
butter highlights, tapes and stamps; ink reads. Nothing glows and nothing is glass. Depth is paper lying on paper,
and every photograph is a snapshot taped to the slip.

The storefront (`app/src/pages/`) and the Flutter ordering app (`/kiosk/`) share the logo, palette, fonts and component
language. The storefront is the long, scrolling pad; the app is the same pad at work: the menu is the price
board, the cart is the order slip being written, and checkout prints the summary.

**Key Characteristics:**
- The owner's circular Luna logo is the masthead of the first slip and the mark in every header.
- White slips with a perforated top edge (16px notch rhythm) on the pink wash.
- Pink section bands, pink tick boxes, and a ruled right-hand price column with tabular numerals.
- Caveat handwriting only for what is "written in": sample lines, captions, quantities, the close.
- Butter yellow as highlighter, tape, offer strip and rubber stamp.

## Colors

Three inks and paper, taken from the logo and the owner's two supplied pinks.

### Primary
- **Logo Pink** (`logo-pink`): the logo's own pink. Rules, double rules under slip heads, tick boxes, the
  sticky bar's bottom line and large display type such as the "Order slip" form title. Never behind small text.
- **Plate Pink** (`plate-pink`): every pink surface that carries type: stamp buttons, section bands, selected
  chips and tabs. White on it clears 4.9:1.
- **Pink Press / Pink Ink** (`pink-press`, `pink-ink`): hover and pressed plates; small pink type, form labels,
  icons and outline buttons on paper (6.5:1).

### Secondary
- **Butter** (`butter`): the highlighter behind promotional lines, washi tape on snapshots, the ₱99 offer strip,
  the B1T1 stamp, the coordinates tag and the closing band. Text on butter is always ink (12:1).

### Neutral
- **Blush** (`blush`): the owner's flat pink, the ground under the pink wash and the app scaffold.
- **Pink Wash** (`wash-base`): base color under the owner's watercolor texture (`app/public/img/pink-wash.webp`,
  `images/pink_wash.jpg`).
- **Paper** (`paper`) and **Card White** (`card-white`): slips, sheets, snapshot borders and product cards.
- **Blush Paper / Blush Light** (`blush-paper`, `blush-light`): printed notice boxes, selected option rows and
  quantity steppers.
- **Pink Rule** (`pink-rule`): hairline rules between rows and around cards.
- **Ink** (`ink`): all reading text (17:1 on paper). **Ink Soft** (`ink-soft`) for secondary text (8.6:1);
  **Ink Muted** (`ink-muted`) for small helper text in the app.
- **Status** (`success`, `warning`, `error`, `info`): staff and checkout states only. GCash keeps its own brand
  blue on the payment tile.

### Named Rules
**The Plate Rule.** If pink carries type, it is Plate Pink with white type. Logo Pink is for rules, marks and
type of 24px and up.

**The Ink-on-Butter Rule.** Butter never carries white or pink small type; it carries ink.

## Typography

**Print font:** Bricolage Grotesque (self-hosted WOFF2 on the storefront; static `Bricolage` TTFs 400–800 in the app)
**Hand font:** Caveat (600/700)

**Character:** Bricolage is the printed form, sturdy, slightly quirky, at home in a price column. Caveat is the
cashier's ballpoint: it only ever appears where something has been written onto the form.

### Hierarchy
- **Display** (800, `clamp(2.5rem, 6.2vw, 4.75rem)`, 0.96): the tagline on the first slip.
- **Headline** (800, `clamp(2.4rem, 6vw, 4.4rem)`, 0.95): slip titles such as Menu & prices, Find us, and the
  gallery title on the wash. App category headings use 34px.
- **Form title** (800, `clamp(1.9rem, 4.2vw, 3.1rem)`, uppercase, Logo Pink): "Order slip" beside the logo.
- **Title** (800, `clamp(1.15rem, 1.8vw, 1.35rem)`): notices and offer names.
- **Body** (400, 16–17px, 1.55): prose, capped near 46–62ch.
- **Label** (700, 0.72–0.74rem, 0.14em tracking, uppercase, Pink Ink): form field labels and column heads.
- **Price** (780–800, 1.35rem storefront / 18–20px app, tabular lining numerals): every amount, right-aligned.
- **Hand** (Caveat 600, ~1.45–1.8rem; 22px in the app): sample order lines, field values, captions, quantities,
  the closing "Gigutom na ka?".

### Named Rules
**The Print-and-Pen Rule.** Bricolage prints the form; Caveat writes on it. Caveat never sets a price column,
a button, navigation or a paragraph.

**The One Price Column Rule.** Amounts align right in one column, in tabular figures, with the ₱ sign once.

## Layout

- **Storefront:** one content column, `max-width: 1120px` inside the gutter. Sections are slips (`.sheet > .slip`)
  separated by the section gap; the gallery sits directly on the wash between slips.
- **First slip:** a slip head (logo `clamp(120px, 21vw, 236px)` beside the form title and three handwritten fields),
  a 3px double pink rule, then a two-column body: tagline, lede, sample lines and actions left; a taped snapshot
  right. The delivery notice sits below a dashed tear line at the bottom of the slip.
- **Menu & prices:** three columns divided by pink hairlines above 940px; one continuous column below. A butter
  offer strip runs the full slip width.
- **Breakpoints:** 940px (columns stack; on phones the actions come before the photo so the order action lands in
  the first viewport), 700px, 460px (compact bar; logo leaves the bar).
- **App:** sidebar of 216 at 1000+ logical px, horizontal category chips below; grid columns `floor(width/260)`
  clamped 2–4; 16 gap, gutters 16/28. The cart is one slip, max width 760, with ITEM / AMOUNT heads and ruled rows.
- **No horizontal overflow at 320px** (`overflow-x: clip` on `html`).

## Elevation & Depth

Paper on paper. Slips cast one soft plum shadow; snapshots add a short edge line and a longer cast; buttons carry a
1px lip in Pink Press. There are no glows, no glass and no blur-only depth.

### Shadow Vocabulary
- **Slip cast** (`filter: drop-shadow(0 1px 0 rgba(142,11,65,.22)) drop-shadow(0 16px 18px rgba(110,4,50,.3))` on
  `.sheet`): the masked, perforated slip's shadow follows its torn outline.
- **Snapshot** (`box-shadow: 0 1px 0 rgba(142,11,65,.14), 0 22px 30px -22px rgba(80,0,36,.75)`).
- **Stamp** (`inset 0 0 0 3px plate, inset 0 0 0 4.5px rgba(255,255,255,.6), 0 1px 0 pink-press,
  0 12px 20px -12px rgba(142,11,65,.75)`): the inner ring is the rubber stamp's edge.
- **App cards** (pink-ink at 12–20% alpha, blur 18–34, negative spread): `KioskTheme.shadowMd/Lg/Xl`.

### Named Rules
**The Paper-on-Paper Rule.** Depth is an offset soft cast tinted plum. Never a zero-offset halo or a colored glow.

## Shapes

Small, consistent corners: 2px tick boxes, 4px slips and notices, 6px stamps, chips and cards, 8px app sheets.
Slips have a perforated top edge made with a radial-gradient mask (4px notches on a 16px rhythm). Snapshots and
tape rotate 1.6–2.2° off true; the B1T1 stamp rotates −7°. Rules are 1px pink hairlines, 2px pink for column
heads and bars, and 3px double under slip heads.

## Components

### Buttons
- **Stamp (primary):** Plate Pink, white Bricolage 750, 6px corners, 48px minimum height, with an inner white
  ring that reads as a rubber stamp. Hover lifts 1px to Pink Press; active presses 1px.
- **Line (secondary):** transparent with a 2px Pink Ink ring and Pink Ink text; hover fills Pink Ink with white.
- **App:** `FilledButton` uses Plate Pink, white, 6px corners, 48×52 minimum; disabled uses Blush Paper with Ink Soft.

### Chips
- **Category chips:** white with a 1.5px Pink Ink border and ink text; selected chips are Plate Pink with white text
  and checkmark. Sidebar tiles follow the same selected treatment.

### Cards / Containers
- **Slip:** Paper, perforated top, `--inset` padding, slip cast.
- **Product card:** white, 6px corners, pink rule border, photo inset 6px, name in Bricolage 600, a pink hairline,
  then the price and a 34px Plate Pink add stamp.
- **Snapshot:** white 8px border with a deeper caption strip, butter tape across the top, handwritten caption with price.

### Inputs / Fields
- **App fields:** white fill, 1.5px pink rule border, 6px corners; focus moves to a 2px Plate Pink border; icons in Pink Ink.
- **Form fields (storefront):** label in Label style on the left, handwritten value resting on a pink rule.

### Navigation
- **Storefront bar:** sticky Paper bar with a 2px Logo Pink bottom line; the small logo joins it once scrolled
  (and on keyboard focus); Prices, Photos, Find us links at 44px hit height; compact Order stamp.
- **App header:** Paper with the logo and the Bricolage wordmark, cart badge hidden at zero, utilities menu.

### Price board (signature)
Pink section bands in uppercase Label style; rows of tick box, name and right-aligned tabular price separated by
pink hairlines; promotional names on a butter highlighter with the price in Pink Ink; a butter offer strip for the
two ₱99 meals; a rotated butter B1T1 stamp on the burger band.

### Order slip (signature, app cart)
One Paper slip: "Order slip" in Logo Pink with a handwritten item count, double rule, ITEM / AMOUNT column heads,
then ruled rows with a framed photo, name, variant, an outlined stepper with handwritten quantity, and the amount
right-aligned. Swipe a row left to remove it.

### Motion
The cashier writes the first slip: field values and sample lines reveal left to right with `clip-path`
(0.7s, `cubic-bezier(.16,1,.3,1)`, 140ms stagger) and each amount lands after its line. The B1T1 stamp and ₱99 prices
land once as the menu arrives; snapshots pin on once as the gallery arrives. Everything is visible without script,
and `prefers-reduced-motion: reduce` removes the motion entirely.

## Do's and Don'ts

### Do:
- **Do** put every type-bearing pink surface on Plate Pink with white text.
- **Do** keep prices in one right-aligned tabular column.
- **Do** use Caveat only for what is written onto a slip: values, sample lines, captions, quantities.
- **Do** keep the delivery-fee notice visible without interaction on the storefront, checkout and receipt.
- **Do** use the owner's logo file (`images/luna_logo.png`, `app/public/img/luna-logo-*.webp`) unaltered apart from its transparent surround.

### Don't:
- **Don't** put white or pink small type on butter, or small type on Logo Pink.
- **Don't** add glows, glass, gradient text or zero-offset halos.
- **Don't** put a kicker or eyebrow label above a heading.
- **Don't** invent slip numbers, phone numbers, ratings or testimonials to fill the form.
- **Don't** use emoji as icons; use the Material outline set in the app and drawn SVG on the web.
