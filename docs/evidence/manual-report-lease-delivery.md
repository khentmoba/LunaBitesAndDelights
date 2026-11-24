# Manual report lease delivery proof

## Bug

`runManualSalesReport` wrote `deliveredChatIds: []` into the guard doc after a
successful Telegram send. When every attempt to persist the `sent` state failed,
the guard stayed `status: 'sending'` with an empty delivery list. After the
60-second `MANUAL_REPORT_CLAIM_TTL_MS` lease expired, `evaluateManualReportClaim`
reported `claimed` and the next run re-sent the same report to every chat.
`runDailySalesReport` already carries delivered IDs across a failed persist; the
manual path did not.

## Fix

- Capture `deliveredChatIds` from the successful `sendToAll` result and keep the
  union of previous and new deliveries on the guard in the `sent` payload.
- When all `sent` writes fail, write a best-effort `{ deliveredChatIds, expireAt }`
  merge so the stale `sending` lease knows who already received the report.
- A deliberate later manual report is unaffected: `carryForward` is only read
  from `failed`/`sending` guards, so a `sent` guard still reaches everyone.

## Proof

Commands (from repo root):

```
npm --prefix functions run build
node --test --test-name-pattern="manual report|Manual report|runManualSalesReport" functions/test/hardening_baseline.test.js
```

Result: 3 tests, 3 pass, 0 fail.

- `runManualSalesReport skips chats that already received a failed attempt, then resets`
  — still passes with the updated invariant that delivered chats stay recorded.
- `runManualSalesReport blocks concurrent in-flight sends and retries sent-state persistence`
  — still passes.
- `a manual report with unpersistable sent state is not re-sent after the lease expires`
  — new regression test. Before the fix it failed with
  `actual: []` vs `expected: ['chat1', 'chat2']` on the guard's delivery list;
  after the fix the expired-lease retry skips both chats (`sendMessage` is never
  called again) and reports `skippedChats: 2`.

Baseline `npm run ci -- --no-evidence` at `a848bed`: all functions unit tests
(148), site tests (108), type checks, lint, builds and audit steps passed. The
two emulator suites failed only because a stale process held Firestore emulator
port 8080 at that moment. With the port free, re-running both suites passed:

```
npm --prefix functions run test:rules      # 25 tests, 0 fail
npm --prefix functions run test:derived    # 5 tests, 0 fail
```

The full `npm run ci` is re-run after the review loop.
