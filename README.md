# LUNA Bites & Delights

Luna Bites & Delights is a food and drink ordering web application for delivery and pickup in Magallanes, Agusan del Norte.

- **Storefront:** https://lunabitesanddelights.web.app
- **Ordering app:** https://lunabitesanddelights.web.app/kiosk/menu/
- **Staff console:** https://lunabitesanddelights.web.app/staff/
- **Legacy domain:** `lunaexpress.web.app` permanently redirects (301) to the canonical domain above.

## Documentation

- [PRODUCT.md](PRODUCT.md) — Product scope, menu & pricing rules, and brand commitments.
- [DESIGN.md](DESIGN.md) — Design system ("Pink Order Pad" palette, typography, components).
- [CODING_STANDARDS.md](CODING_STANDARDS.md) — Backend, frontend, CSP, and Firestore rules invariants.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Codebase directory map and coupled file invariants.
- [docs/DEPLOYMENT_STATE.md](docs/DEPLOYMENT_STATE.md) — Production secrets, App Check, and rules-drift state.
- [SECURITY.md](SECURITY.md) — Security controls checklist.

## Getting Started

1. **Install dependencies:** Run `npm run setup` (installs Node 22 dependencies across root, `app/`, and `functions/`).
2. **Local development:** Run `npm --prefix app run dev` to serve the storefront, kiosk, and staff pages.
3. **Full verification gate:** Run `npm run ci` to execute all typechecks, linters, unit tests, Firebase emulator tests (`rules` + `derived`), and storefront checks from `.github/workflows/pr-checks.yml`.
