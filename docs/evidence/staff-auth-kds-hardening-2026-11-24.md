# Staff PIN Rate Limiting & KDS Hardening (2026-11-24)

## Changes

1. **Rate-limit `updateStaffPin` per staff UID (`functions/src/auth/verify_staff.ts`).**
   `updateStaffPin` only checked the failure lockout counter, so an authenticated session could call it repeatedly with valid passwords and trigger unbounded scrypt hashing and Firestore writes. Added an atomic fixed-window limit (`10` attempts per `15` minutes per UID via `enforceFixedWindowRateLimit`) before password verification and scrypt work.

2. **Keep KDS manual sync fresher than stale cached snapshots (`app/src/staff/kds.ts`, `app/src/staff/kds-data.ts`).**
   When the Firestore listener delivered a cached snapshot (`snap.metadata.fromCache === true`), a manual sync (`fetchActive`) lost to the stale cache in `mergeKdsOrders`, and a subsequent unchanged cached snapshot could overwrite the manual sync. Added `polledWins` to `mergeKdsOrders`, extended `shouldSkipUnchangedLiveSnapshot` to skip stale cached replays when a fresher manual sync is displayed, and bumped `fetchSeq` on live server snapshots (`!fromCache`) so older in-flight `getActiveOrders` responses are dropped.

3. **Pause KDS 30-second elapsed-time DOM updates while hidden (`app/src/staff/kds.ts`).**
   Skipped the 30-second `refreshElapsedTimes()` tick when `document.hidden` is true, and refreshed elapsed times immediately in `onVisibilityChange` when the tab becomes visible again.

## Verification

- **Unit & regression tests:**
  - `functions/test/staff_auth.test.js`: covers `updateStaffPin` fixed-window throttling at the 11th call.
  - `test/site/staff.test.mjs`: covers `mergeKdsOrders(..., polledWins)` precedence and `shouldSkipUnchangedLiveSnapshot` handling of cached vs. server snapshots after manual sync.
- **Full local CI:** `npm run ci` (output recorded in `docs/evidence/ci-local.txt`).
- **Rendered staff page screenshots:** captured headless at `1440x900` and `390x844` and published to the `evidence` branch (`b4903a6`).

## Blast radius

- **Core safety invariant:** `mergeKdsOrders` and `shouldSkipUnchangedLiveSnapshot` default their new trailing parameters to `false`, preserving existing callers. `updateStaffPin` uses the existing `enforceFixedWindowRateLimit` transactional helper on a dedicated `staff:pin_update_window:${uid}` key before any password scrypt work or Firestore mutations.
- **Verification level:** Level 4 (executed in `functions` unit tests, site unit tests, and full `npm run ci`).
