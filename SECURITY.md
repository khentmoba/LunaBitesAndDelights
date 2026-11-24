# Security Checklist (1–20) — Luna Express

How each item is enforced, and the manual steps that can't live in code.

## In code (done)

| # | Item | Where |
|---|------|-------|
| 1 | Hide API keys | Server: `functions/src/secrets.ts` declares `TELEGRAM_*`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, and `GOOGLE_MAPS_API_KEY` as Secret Manager secrets (re-exported by `functions/src/index.ts`), never client-visible. Client: Google Maps + reCAPTCHA keys arrive as `PUBLIC_GOOGLE_MAPS_KEY` / `PUBLIC_RECAPTCHA_SITE_KEY` build inputs from GitHub secrets, so no key literal lives in the repo. Deploy: `firebase functions:secrets:set <NAME>` for each. |
| 3 | Public DB key | Firebase web `apiKey` in `app/src/kiosk/firebase.ts` is public by design; access is enforced by rules + App Check, not by hiding it. Restrict it anyway (below). |
| 4,7 | Row-level security / record access | `firestore.rules` — default deny, per-collection rules; order reads/updates only through staff callables. |
| 5 | Encrypt sensitive data | At rest: Google-managed encryption (Firestore/Auth/Storage). In transit: TLS everywhere. PII stripped from logs; `login_attempts` keys are hashed. |
| 6,9 | Server-side auth / sessions | Staff login returns a Firebase custom token w/ `role` claim (`verify_staff.ts`); KDS/analytics/report callables `requireStaff()`. No more forgeable `{success:true}` sessions. |
| 8 | Block field tampering | Rules use `hasOnly()` allowlists on the `orders` create payload; `create_checkout.ts` re-prices every line from a server menu and rejects amount mismatches; webhook re-verifies PAID via PayMongo API. |
| 10 | Hash passwords | Staff: scrypt + per-user salt (`security.ts`); legacy sha256 auto-upgrades on next login. The first-run seed (`ensureStaffSeeded`) writes two accounts with random passwords that are never logged or shown, and logs only `SEEDED staff account <name> (role: <role>); run functions/scripts/reset-staff-credentials.js to set credentials` — set real credentials with that script before first use. |
| 11 | Rate limit login | `checkRateLimit()` — 5 failures → 15-min per-IP lockout plus per-account `staff:pw_user` (20 failures / 15-min) and global PIN failure budgets (Firestore-backed). |
| 12 | Bot protection | App Check wired in `app/src/kiosk/firebase.ts` (`PUBLIC_RECAPTCHA_SITE_KEY`, reCAPTCHA Enterprise key registered 2026-09-28). Enforcement stays OFF until clients roll out — then enable per-service in console. |
| 13 | Parameterize queries | Firestore SDK (no string-built queries); doc IDs allowlisted `^[A-Za-z0-9_-]+$`; webhook/coordinate inputs type-checked. |
| 14 | Validate all input | Server: `cleanStr/optStr/cleanInt/validDocId` on every callable. Client: `app/src/kiosk/order.ts` validates names and phone numbers before an order is sent. |
| 15 | Escape user content | Pages escape user text with `esc()` or set it as `textContent`; Telegram uses `escapeMd()`; the GCash page only opens https PayMongo/GCash/Maya links (`app/src/kiosk/payment-host.ts`); map HTML interpolates numbers only. |
| 16 | Restrict uploads | `storage.rules` — Storage is closed to all clients; nothing in the app uploads. |
| 17 | Trim API responses | KDS returns a fixed projection (no `...data`); error messages generic; provider errors not leaked. |
| 18,19 | Headers / HTTPS | `firebase.json` — HSTS, nosniff, DENY framing, Referrer/Permissions-Policy. Hosting is HTTPS-only by default. |
| 20 | Scan dependencies | CI (`.github/workflows/pr-checks.yml`): `npm audit --audit-level=high` for `functions/` and `app/` + full test/build gate. Run locally: `cd functions && npm audit`, `cd app && npm audit`. |

## Manual steps (Firebase Console — do once)

1. **Secrets**: `firebase functions:secrets:set TELEGRAM_TOKEN|TELEGRAM_CHAT_ID|PAYMONGO_SECRET_KEY|PAYMONGO_WEBHOOK_SECRET|GOOGLE_MAPS_API_KEY`, then deploy functions. `PAYMONGO_WEBHOOK_SECRET` is mandatory: without it the webhook rejects every delivery instead of falling back to an unverified event.
2. **Restrict the web API key** (#3): Google Cloud Console → APIs & Services → Credentials → Browser key → HTTP referrers: `lunabitesanddelights.web.app/*`, `lunaexpress.web.app/*`, `lunabitesanddelights.firebaseapp.com/*`, `lunaexpress.firebaseapp.com/*`.
3. **Google Maps browser key** (#1): GitHub secret `GOOGLE_MAPS_BROWSER_KEY`, injected by both hosting workflows as `PUBLIC_GOOGLE_MAPS_KEY`. Enable the Maps JavaScript API on the billing account and restrict the key to HTTP referrers `lunabitesanddelights.web.app/*` + `lunabitesanddelights.firebaseapp.com/*` + `localhost/*`; a browser key cannot be hidden, only fenced. The build prints a tile-free picker when the secret is missing or the key is rejected, so check the map screen after changing it. Keep it separate from `GOOGLE_MAPS_API_KEY`, which is the server-side Static Maps key for Telegram alerts and must stay unrestricted by referrer.
4. **App Check** (#12): DONE 2026-09-28 — Enterprise SCORE key created (domains: web.app, firebaseapp.com, localhost) and registered via API. Enforcement intentionally OFF (correct sequencing: ship App-Check-ready clients first, enforce later). When ready: Console → App Check → APIs → enforce Firestore + Functions.
5. **Rotate**: any PayMongo/Telegram secret that ever appeared in chat or shell history. Staff credentials are set (never logged) with `node functions/scripts/reset-staff-credentials.js` from the repo root; rotate them there too.

## #2 Purge git secrets

A MapTiler key was hardcoded in the Flutter app's `lib/services/geocoding.dart` until 2026-10. It is a browser key: rotating it in the MapTiler dashboard is the fix, and a history rewrite buys nothing once it is revoked. The kiosk map no longer uses MapTiler at all; only the server-side Telegram static-map fallback still references it. The Firebase web `apiKey` in `app/src/kiosk/firebase.ts` is public by design and stays.
If a real secret ever lands in git:

```bash
# 1. Revoke/rotate the secret FIRST (history rewrites don't un-leak it).
# 2. Purge it:
git filter-repo --replace-text <(echo 'SECRET_VALUE==>***REMOVED***') --force
# 3. Force-push + tell collaborators to re-clone.
```

Prevention: `.env`/`functions/.env` are gitignored; secrets live in Secret Manager, never in code.
