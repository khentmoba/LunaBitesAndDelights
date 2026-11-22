# Telegram Order Notification Hardening Evidence

## Problem

Orders occasionally failed to appear in the staff Telegram group chat (GC) because:

- Transient Telegram failures (5xx, 429 rate limits, network blips) failed immediately without in-process retry or `retry_after` handling.
- Partial multi-chat failures (when one chat succeeded and the GC failed) treated the order as delivered if any chat succeeded, silently dropping the GC.
- Supergroup upgrades (`migrate_to_chat_id`) returned HTTP 400 and were misclassified as permanent errors, dropping the order.
- A Firestore trigger drop or an outage longer than the 10-minute Eventarc retry window left orders permanently unnotified with no recovery path.
- Split-mode delivery notifications skipped the full itemized text message if photo delivery partially failed.

## Changes Verified

- **Telegram transport hardening (`functions/src/telegram_api.ts`)**
  - Trimmed `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` entries so trailing newlines in Secret Manager cannot break Bot API calls.
  - Added in-process exponential backoff retries (up to 3 attempts) for transient 5xx, 408, and network errors.
  - Honored Telegram 429 `retry_after` headers when within the 10-second in-process cap and deferred longer cooldowns to outer Eventarc/reconciler retries.
  - Detected `migrate_to_chat_id` responses, retried immediately against the migrated supergroup ID, and prevented permanent-error classification.
  - Changed multi-chat delivery from "any chat succeeded" to "all active chats succeeded": transient failures on any chat throw a structured error carrying `deliveredChatIds` and `failedChatIds`, while permanent 403/400 errors on one dead chat do not block delivery to healthy chats.
- **Deduplication, resume, and safety-net reconciler (`functions/src/orders/send_notification.ts`, `functions/src/orders/derived.ts`, `functions/src/index.ts`)**
  - Persisted `deliveredChatIds` across retries so resumed attempts skip already-notified chats via `skipChatIds` instead of spamming them.
  - Fixed split-mode delivery so a partial photo failure falls back to text only for undelivered chats while still sending the full itemized order text to all chats.
  - Added bounded backoff retries when persisting `telegramSent: true` to Firestore after Telegram already accepted the message, logging instead of flipping status to `failed` if Firestore is temporarily unreachable.
  - Exported `reconcileMissedOrderNotifications`, a scheduled Cloud Function running every 2 minutes that scans recent kitchen-visible orders (up to 2 hours old) and retries any missing `telegramSent: true` record using a dedicated `reconcileAttempts` counter (60-attempt budget, isolated from trigger retry attempts).

## Blast-Radius Proof

- **Invariant:** High trigger retry counts cannot exhaust the reconciler's retry budget, and the reconciler delivers any kitchen-visible order whose Eventarc trigger failed or dropped while skipping orders already marked `telegramSent: true`.
- **Verification (Level 4, real Firestore + Functions emulators):**
  - `functions/test/emulator/derived-views.test.js` runs `reconcileMissedOrderNotifications` against a real Firestore emulator containing an unnotified order with `attempts: 100` (simulating exhausted trigger retries). The reconciler claims and sends it, marks `telegramSent: true`, and records `attempts: 101, reconcileAttempts: 1`.
  - `functions/test/telegram_notification.test.js` (25/25 passing) verifies MarkdownV2 escaping, chunking, 429 `retry_after` capping, `migrate_to_chat_id` recovery, partial multi-chat `deliveredChatIds`/`skipChatIds` resume, dead-chat isolation, split-mode photo fallback, and token trimming.

## Local CI Verification

Full local CI (`npm run ci`) passed at `742bcbf` and is recorded in `docs/evidence/ci-local.txt`:

- `functions`: TypeScript build, ESLint promise checks, unit tests (all 25 Telegram notification tests plus existing suites), runtime dependency audit.
- `rules`: Firestore rules emulator tests and derived views emulator tests (`firestore.rules` unchanged).
- `site`: Astro type check, ESLint, build, runtime audit, and storefront tests.
