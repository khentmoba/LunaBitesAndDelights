# Reliability, performance, and security hardening (2026-11-25)

## Scope

- Added caller proof checks to the public PayMongo checkout and verification callables.
- Forwarded the returned order number from the GCash handoff into payment verification.
- Added retry proof for legacy `sendOrderNotification` callers without an `orderId` match.
- Removed the pre-transaction KDS mirror short-circuit that could leave a stale mirror behind.
- Made daily stats increment maps safe against prototype-polluting item keys.

## Reproduction and validation

- `functions/test/hardening_baseline.test.js` now exercises the shared access helper, the stale-mirror helper, and `incrementPayload` directly. The access and payload assertions fail against the previous implementations.
- `npm --prefix functions test` runs the TypeScript build and all backend unit tests.
- `npm run ci` runs the full local equivalent of `.github/workflows/pr-checks.yml` and writes `docs/evidence/ci-local.txt`.

## Risk

- Anonymous callers must send either the display order number returned by `placeOrder`, the idempotency key used to create the order, or a staff token. Existing kiosk handoffs include the display order number, so normal checkout and receipt flows are unchanged.
- A KDS projection write that was skipped before is now checked inside the transaction, adding one mirror read for repeated order updates.
