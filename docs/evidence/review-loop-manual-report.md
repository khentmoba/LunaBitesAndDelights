# Review loop — manual report lease delivery

- Route: `opencode/deepseek-v4.1-flash-free`, `variant: max` (DeepSeek V4.1 Flash at highest reasoning). The originally requested Pi/Mistral route is not available in this environment (`401: Mistral: Invalid API Key` on the earlier run), and the `magpie/mistral/...` model is not listed by `orchestrator_capabilities`; this is the review-loop skill's sanctioned fallback.
- Base: `a848bed56249ecdb548b0732d16af62bae225503` (also `origin/main` head).
- Scope: `functions/src/reporting/manual_report.ts`, `functions/test/hardening_baseline.test.js`. Snapshot T1: `dd800ed4ebe74673fdb7925a7404120ea28f7500`.
- Budget: default 3 rounds; used 1.

## Round 1

VERDICT: SHIP. No blocker or should. Both findings are nits, so the loop ends here; no ignore-check triage pass was needed.

| id | class | severity | outcome | reason |
| --- | --- | --- | --- | --- |
| D1 | completion-state write left un-retried after side effect | nit | declined | An extended outage that outlasts all four backoff attempts also defeats the fallback write. Rare, and the "log and move on" persist gap is the established convention in `daily_report.ts` and `send_notification.ts`. A second backoff loop would grow a small fix; follow-up, not this change. |
| D2 | success reported for a no-op deliberate re-report | nit | declined | Intentional trade-off: a stuck `sending` guard with every chat recorded must not re-send. Surfacing `skippedChats` in the callable response is an API behavior change outside this fix. |

Usage: not exposed by the delegated reviewer task.
