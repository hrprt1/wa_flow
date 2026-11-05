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

The plan-based bulk campaign update passed 50 backend tests with two opt-in integration tests skipped. API compilation, frontend/backend unused-symbol checks and diff checks passed. Added coverage exercises 1,201-row contact imports, nonconsecutive MySQL IDs, pagination/tenant isolation, 5,000-recipient campaigns, full-audience rejection, competing reservations, cancellation, consent withdrawal and month-scoped allowance. Independent review findings around background refresh and older conversation selection were fixed. The initial frontend build was blocked by Windows EPERM creating generated `.next` directories; see the subsequent build verification below. Live MySQL concurrency, large-import HTTP acceptance and Meta delivery were not verified.

Primary-agent verification reported: API TypeScript build passed; backend suite 34 passed and 2 opt-in integrations skipped; existing signup helper suite 4 passed. Web TypeScript and optimized compilation/static generation passed, but standalone packaging failed on Windows EPERM creating a directory. Root API packaging failed during nested npm ci with npm's "Exit handler never called". These were earlier packaging failures; see subsequent build verification below. Live MySQL/Meta execution was not verified. Docker was unavailable for validating the local Compose services. Documentation path/content review and git diff --check passed (line-ending warnings only).

## Subsequent production build verification

The incomplete dependency installation was restored with `npm ci --no-audit --no-fund`, using the unchanged lockfile. `npm run build:web` completed outside the restricted execution sandbox, including TypeScript, prerendering, standalone dependency tracing and static-asset packaging. The generated standalone server started on an isolated local port; `/`, `/login`, `/register`, `/forgot-password`, `/app/campaigns` and `/reset-password` returned HTTP 200, as did the referenced production JavaScript and CSS. No database or provider actions were performed. Type checking and standalone runtime checks remain enabled.

The complete root `npm run build` also passed, including the isolated API production dependency installation and a second frontend standalone build. The generated `dist/main.js` API package started with synthetic configuration, workers and migrations disabled; a guest workspace request returned 401 and a mutation without CSRF returned 419. Package manifests and the lockfile were unchanged.

## Local production runtime acceptance

The frontend and backend were started with NODE_ENV=production on loopback ports 3000 and 4000 using the configured MySQL database. The user explicitly approved running the existing additive migration to create missing campaign/consent tables; existing application records were preserved. Sending workers and automatic migrations remain disabled during this local check. HTTP loopback uses a non-secure cookie for local testing; deployment still requires HTTPS and secure cookies.

A user-authorized QA account/workspace was created through the production registration form. All nine signed-in pages rendered: overview, inbox, customers, automations, knowledge, products, campaigns, settings and billing. Browser checks exercised registration, logout/login, a 150-contact CSV import, repeat-import duplicate skipping, three-page navigation, a contact-to-inbox link, internal-note persistence, product creation, paused automation creation, knowledge creation and campaign draft/review. Synthetic contacts have no marketing consent; no live campaign was scheduled or sent. Billing displayed the trial allowance and disabled checkout while provider configuration was missing. The test browser captured no errors.

All 52 existing backend tests passed with RUN_API_SMOKE=true through the production frontend proxy, including the two previously opt-in integrations. Fifteen public/workspace page routes returned server HTML, twelve referenced static assets returned nonempty HTTP 200 responses, protected guest APIs returned 401, and invalid workspace paths rendered Next's streamed not-found response. Real Meta delivery, billing transactions, SMTP delivery and concurrent multi-worker load were not exercised. Local QA credentials, process details, logs and a verification screenshot are stored under the ignored `.local-backups/production-check/` directory.
