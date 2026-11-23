# Production Deployment & Environment State

Read-only reference for production state that cannot be inspected from a local checkout without credentials. Update this file whenever secrets, App Check enforcement, or Firestore rules change in production (`lunaexpress`).

## 1. Secret Manager (`functions/src/secrets.ts`)

| Secret Name | Declared in `secrets.ts` | Provisioned in Prod | Notes |
| --- | --- | --- | --- |
| `TELEGRAM_TOKEN` | Yes (`telegramToken`) | Yes (v1) | Bot token for order, payment, and daily report alerts. |
| `TELEGRAM_CHAT_ID` | Yes (`telegramChatIds`) | Yes (v1, v2) | Comma-separated target chat IDs. |
| `PAYMONGO_SECRET_KEY` | Yes (`paymongoSecret`) | Yes (v1) | Used by `createCheckoutSession`, `verifyCheckoutPayment`, and `paymongoWebhook`. |
| `GOOGLE_MAPS_API_KEY` | Yes (`googleMapsApiKey`) | Yes (v1) | Optional static map preview fallback in `send_notification.ts`. |
| `PAYMONGO_WEBHOOK_SECRET` | **No** (read via `process.env`) | **Yes (v1)** | Provisioned in Secret Manager (v1 created `2026-07-06`), but not yet declared with `defineSecret` in `functions/src/secrets.ts` or bound in `paymongoWebhook`'s `secrets: [...]` array. `paymongoWebhook` (`functions/src/payments/webhook.ts`) MUST keep its PayMongo API-verification fallback (`fetchCheckoutSessionDetailed`) until `PAYMONGO_WEBHOOK_SECRET` is bound via `defineSecret` and verified against live PayMongo webhook delivery. |

## 2. Build-Time Public Keys (`.github/workflows/firebase-hosting-*.yml`)

- `PUBLIC_RECAPTCHA_SITE_KEY` (from GitHub secret `RECAPTCHA_SITE_KEY`) — Initializes Firebase App Check (reCAPTCHA Enterprise) in `app/src/kiosk/firebase.ts`.
- `PUBLIC_MAPTILER_KEY` (from GitHub secret `MAPTILER_KEY`) — Tile key for `/kiosk/map/`; falls back to a tile-free picker if unset locally.

## 3. Firebase App Check Enforcement

- **Client:** Active in production builds (`app/src/kiosk/firebase.ts` registers `ReCaptchaEnterpriseProvider` with `isTokenAutoRefreshEnabled: true`).
- **Cloud Functions (`enforceAppCheck`):** Intentionally **OFF** on public callables (`placeOrder`, `createCheckoutSession`, `verifyCheckoutPayment`, `sendOrderNotification`, `verifyStaff`) until App Check token metrics in Firebase Console confirm zero legitimate client drops. Do not enable `enforceAppCheck: true` in code-only PRs without explicit user instruction.

## 4. Firestore Rules & Indexes (`firestore.rules`, `firestore.indexes.json`)

- **Rules drift gate:** `.github/workflows/rules-drift.yml` runs on every push to `main` and daily at `03:17 UTC`, comparing `firestore.rules` in git against live production (`cloud.firestore` release on `lunaexpress`).
- **Deploy policy:** `.github/workflows/firebase-hosting-merge.yml` deploys Hosting and Cloud Functions automatically on merge to `main`, but does **not** auto-deploy `firestore.rules` or `firestore.indexes.json`.
- **Consequence for PRs:**
  - Any edit to `firestore.rules` merged to `main` without a coordinated `firebase deploy --only firestore:rules` will cause `.github/workflows/rules-drift.yml` to fail.
  - Legacy rule blocks in `firestore.rules` (direct client `create` on `orders/{orderId}`, `pasugo_errands`, `pasugo_sessions`, `riders`) and composite index rollouts in `firestore.indexes.json` are tracked as production-gated items (`SEC-01`, `SEC-02`, `REL-01`, `PERF-01` in `docs/reliability-performance-security-baseline.md`). Do not modify `firestore.rules` in routine code PRs unless the task explicitly targets rules and coordinates deployment.

## 5. Local Read-Only Inspection (`check:prod-config` & `check:rules-drift`)

- Both `npm --prefix functions run check:prod-config` and `npm --prefix functions run check:rules-drift` automatically resolve an OAuth token from:
  1. `FIREBASE_RULES_ACCESS_TOKEN`
  2. The local Firebase CLI session (`~/.config/configstore/firebase-tools.json` via `firebase-tools/lib/auth`)
  3. `gcloud auth print-access-token`
  4. `GOOGLE_APPLICATION_CREDENTIALS` (Application Default Credentials)
- Run `npm --prefix functions run check:prod-config` to inspect live Secret Manager secret names (metadata only), live Firestore ruleset release status, and composite indexes without touching secret values or deploying anything.
