# WaFlow testing strategy

## Existing checks

From the repository root with pinned dependencies installed:

```powershell
npm test
npm run test:signup-ui
npm run build
```

Backend tests exercise authentication/tenant behavior, credential compatibility, provider helpers, queue/migration behavior, reset mail, exception filtering and raw webhook signatures. Signup checks exercise existing signup helpers. Builds compile Nest and package Next standalone. These do not establish live-provider or database concurrency correctness.

Optional smoke suite needs a running configured API:

```powershell
$env:RUN_API_SMOKE='true'
npm test
```

Use isolated staging services/data. Current tests do not provide a MySQL/Redis integration environment. This document defines required verification, not results claimed as run.

## Consequential backend regressions

| Risk | Required checks |
|---|---|
| Tenant/role leakage | Foreign IDs, forged relations, unauthorized roles, queued tenant payloads |
| Authentication | Session rotation, CSRF, reset expiry and prior-session invalidation |
| Import/consent | Invalid/oversized/duplicate CSV, atomic validation, no implicit opt-in, withdrawal after schedule |
| Campaign duplicates | Repeated schedule/jobs, concurrent claims and restart recovery |
| Provider uncertainty | Timeout after request acceptance marks uncertain; no blind resend |
| Limits | Concurrent reservations, exactly-once release, bounded account pacing/retries |
| Templates/window | Rejected/paused/unsupported template and expired free-form reply window |
| Webhooks | Invalid signature, duplicate message/event, reordered statuses, failed queue publication |
| Billing | Signed replay, authoritative plan state and reservation reconciliation |
| Migration | Fresh schema, ETL counts/relations, JSON/time conversion and token decryption |

Use database-backed tests for real unique constraints, locks and concurrency; mocks cannot establish those guarantees. Add focused backend regressions for consequential behavior. Do not create frontend tests/tooling unless requested; use existing types/build and focused interaction checks.

## Staging acceptance

Register and reset via SMTP; connect a test WABA through Embedded Signup; recover cancelled/expired flows. Preview/import valid, invalid, duplicate and unpermitted contacts. Select approved template, inspect exclusions and test/schedule a small permitted campaign. Withdraw one recipient before dispatch and cancel pending work. Compare received/status webhooks, provider records and UI counts. Exercise sandbox billing, worker restart/provider outage and backup restore. Review responsive layout, keyboard access and useful errors with a nontechnical user.

Release records must include actual command/results, service versions, known gaps and acceptance evidence. A passing build does not mean production readiness.

## Checks recorded during this implementation

Primary-agent verification reported: API TypeScript build passed; backend suite 34 passed and 2 opt-in integrations skipped; existing signup helper suite 4 passed. Web TypeScript and optimized compilation/static generation passed, but standalone packaging failed on Windows EPERM creating a directory. Root API packaging failed during nested npm ci with npm's "Exit handler never called". These packaging failures remain limitations; live MySQL/Meta execution was not verified. Docker was unavailable for validating the local Compose services. Documentation path/content review and git diff --check passed (line-ending warnings only).
