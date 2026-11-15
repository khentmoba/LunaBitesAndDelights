# LUNA Bites & Delights

Luna Bites & Delights is a food business application that enables customers to order, pay, and choose between delivery or pickup.

- **Storefront:** https://lunabitesanddelights.web.app
- **Ordering app:** https://lunabitesanddelights.web.app/kiosk/menu
- **Legacy domain:** `lunaexpress.web.app` permanently redirects (301) to the canonical domain above.

## Project Vision

Our goal is to provide a seamless, mobile-optimized experience for food ordering while ensuring robust data security and payment processing.

## Governance

This project is governed by the [Project Constitution](.specify/memory/constitution.md). All contributors and developers must adhere to the core principles defined therein:
1. **User-Centric Ordering**
2. **Payment-First Fulfillment**
3. **Fulfillment Flexibility**
4. **Data Integrity & Security**
5. **Spec Kit Compliance**

## Development Workflow

We use the Spec Kit (Specify -> Plan -> Implement) methodology for all feature development. Ensure you have the `.agent` skills available for automated workflow management.

## Getting Started

1. **Environment Setup**: Install Node 22, then `npm ci` in `app/` and `functions/`. `npm run dev --prefix app` serves the storefront, kiosk and staff pages.
2. **Firebase Configuration**: Link the project to your Firebase instance using `firebase init`.
3. **Explore Specs**: View planned features in the `specs/` directory.
