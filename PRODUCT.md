# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

One Astro project (`app/`) builds every page into a single Firebase Hosting deploy:

- `/` and `/menu/` — the static storefront (`app/src/pages/index.astro`, `app/src/pages/menu/`).
- `/kiosk/` — the TypeScript ordering app (`app/src/pages/kiosk/`, scripts in `app/src/kiosk/`).
- `/staff/` — the staff console: sign-in, dashboard, kitchen display and sales reports (`app/src/pages/staff/`, scripts in `app/src/staff/`).

Prices for all three come from `app/src/data/menu.ts`. Cloud Functions (`functions/src/`) handle payments, staff sign-in, Telegram notifications and reporting.

## Users

People around Magallanes, Agusan del Norte who want Luna food brought to them. Delivery is the dominant use; walk-in decisions are secondary. They arrive from a Facebook post, a shared link, or word of mouth, usually on a phone, usually hungry and deciding fast. They want to know what the food is, what it costs, and whether it can come to their house.

## Product Purpose

Order Luna Bites & Delights for delivery or pick-up without talking to anyone. The storefront says what the kiosk is, what it serves and what it costs; the kiosk app takes the order. Success is a delivery order placed from a phone.

## Positioning

A neighbourhood kiosk with the prices printed where you can see them: real per-item pricing, buy-1-take-1 burgers, and a separate delivery fee whose amount is confirmed by the rider. The ordering system is the business's own app, not a marketplace listing.

## Operating Context

- Physical kiosk at Purok 5, Poblacion Magallanes, Agusan Del Norte; the landmark people actually use is "unahan lang gamay sa 7/11". The exact spot is 9°01′13.9″N 125°31′03.5″E (9.0205278, 125.5176389), supplied by the owner.
- A second kitchen base exists northeast of the kiosk; distance is recorded from the nearer base. The delivery rider confirms the delivery fee.
- Payment is cash or GCash at the kiosk/on delivery.
- Staff run the same app on a tablet in the store: dashboard, kitchen display, analytics.
- Facebook is the business's main channel for announcements: https://www.facebook.com/profile.php?id=100090686762896

## Capabilities and Constraints

- Menu sections: Shawarma Favorites, French Fries, Combo Meals, Extras, Refreshments (coolers), Burgers (buy 1 take 1).
- Prices live in `app/src/data/menu.ts`. The checkout function keeps its own list (`functions/src/payments/create_checkout.ts`); `test/site/price-parity.test.mjs` fails when the two drift.
- Fries & Nachos Overload has Buddy (1–2 pax, ₱99) and Barkada (3–5 pax, ₱150) sizes. Burger favorites retain buy 1 take 1 pricing.
- The owner's dessert and combo uploads add Ube Halo, Mango Graham, Choco Oreo and Vanilla Cheese ice cream at ₱65 each, Luna Leche Flan at ₱20, and D1–D4 fries/drink bundles at ₱55/₱65/₱75/₱89. Combo 2 is wrap + fries (₱99), Super Combo 1 is burger + fries + drink (₱99), Super Combo 2 is wrap + fries + drink (₱128), Combo 3 is two burgers + regular fries + two drinks (₱169), Combo 4 is wrap + burger + fries (₱139), and Combo 6 is wrap + shawarma burger + drink (₱150). Original uploads and crop mappings are in `docs/reference/menu-update/` and `docs/owner-menu-crops.json`.
- Shawarma Fries and Shawarma Nachos are ₱99. Milo Craze (Dinosaur, Float, Crunch, Oreo) is ₱65; Cream Float Craze is Coke ₱49, Chuckie ₱65, Milo ₱65 and Cookies and Cream ₱65; every Coffee Foam drink is ₱49.
- Delivery fee: rider-confirmed and charged separately. The storefront, checkout and receipt show a delivery-fee notice without quoting an amount. Checkout totals and online payments cover food only.
- Checkout supports cash and GCash; staff verify orders in the dashboard.
- Kiosk routes: `/kiosk/`, `/kiosk/menu/`, `/kiosk/cart/`, `/kiosk/map/`, `/kiosk/checkout/`, `/kiosk/gcash/`, `/kiosk/receipt/`. Staff routes: `/staff/`, `/staff/dashboard/`, `/staff/kds/`, `/staff/analytics/`, `/staff/lifetime/`. Old Flutter hash links (`/kiosk/#/menu`) redirect to the new pages.
- Opening hours are 9am to 8pm, supplied by the owner.
- Undecided: a contact phone number. The owner will supply it later. Do not invent one.

## Brand Commitments

- Name: Luna Bites & Delights. Canonical domain: `https://lunabitesanddelights.web.app`. The legacy `lunaexpress.web.app` domain permanently redirects (301) to it, and "Luna Express" survives only as a search alias in structured data.
- Tagline in the owner's own words: "Good food, sweet drinks, moonlit vibes."
- Intro copy from the Facebook page: "Tambayan ng good food, sweet drinks, at moonlit vibes 🌕✨ Feel the comfort, taste the delight — only at Luna Bites & Delights 💛 Located @ Purok 5, Magallanes, Agusan Del Norte."
- Owner-supplied palette: logo pink `#EC1C72`, blush `#FEB7C9`, pink watercolor wash (`app/public/img/pink-wash.webp`, `app/public/kiosk/images/pink_wash.jpg`), butter yellow `#FCD04E`, paper `#FFFAFB`, plum ink `#2A0F1E`.
- Logo: `app/public/kiosk/images/luna_logo.webp` (and `app/public/img/luna-logo-*.webp`), the owner's circular pink badge with a yellow cooler cup, striped straw, script "Luna" and "Bites & Delights".

## Evidence on Hand

- Real product photography in `app/public/kiosk/images/` (shawarma wrap, fries, burger, three large coolers, couple snack combo, and more) — the kiosk's own menu assets.
- Real prices and item descriptions in `app/src/data/menu.ts`.
- Public Facebook figures as of capture: 866 followers, 270 talking about this.
- No testimonials, reviews, awards, or press exist. Do not fabricate any.

## Product Principles

1. Price before poetry. Every claim on the storefront is a fact from the menu or the delivery code.
2. Delivery is the default path; walk-in is the fallback. The primary action always starts an order.
3. Talk like the kiosk talks — warm, local, a little Bisaya, no corporate voice.
4. The app is proof. Real screens and real prices outperform stock marketing copy.
5. Leave holes where the facts are missing rather than filling them with filler.

## Accessibility & Inclusion

Baseline for a public page on low-end Android phones over mobile data: readable contrast on every text/background pair, visible keyboard focus, and motion that respects `prefers-reduced-motion`. No specific standard was mandated.
