# WaFlow — Next.js + NestJS

The default application now runs natively on Next.js 16 (React 19 App Router) and NestJS 11 with TypeScript. The existing MySQL schema, accounts, business memberships, records, and encrypted provider credentials are preserved. The Node runtime does not proxy requests to Laravel or require PHP.

## WhatsApp marketing platform

The workspace now includes a guided first-campaign checklist, CSV contact import,
consent evidence and opt-out management, approved text-template campaign review,
immediate or future scheduling, cancellation, and per-recipient delivery counts.
Run `npm run db:migrate` before using these additions: it adds consent history,
campaign runs and campaign recipients alongside the existing runtime tables.
Existing contacts and campaign drafts are preserved. Each draft supports one run;
create another draft to send another campaign. Contact storage has no fixed cap;
the customer list uses server-side pagination and search. CSV imports accept up to
10,000 contacts / 5 MB per file, with batched writes and duplicate skipping.
Campaign audiences use the whole matching contact set and must fit the remaining
monthly plan allowance (trial 100, Starter 1,000, Business 5,000 messages).
Template variables, buttons and media are excluded from campaign sends.

CSV headers are `name,phone,email,tag,opted_in`; only name and phone are required.
Use E.164 phones such as `+919876543210`, and literal `true` or `false` consent.
A consent source is required for opt-ins. Existing numbers are skipped without
changing their consent. Exact inbound STOP, UNSUBSCRIBE, CANCEL, END and QUIT
messages revoke marketing consent. Consent is rechecked at dispatch; messages
already being sent cannot be recalled. Unknown provider outcomes require review
in Meta and are not automatically resent.

Product and implementation documents: [PRD](PRD.md), [architecture](ARCHITECTURE.md),
[database](DATABASE.md), [API](API.md), [roadmap](ROADMAP.md),
[testing](TESTING.md), and [deployment/security](OPERATIONS.md).
MySQL is the approved database. The runtime uses MySQL/Knex and the durable
database queue; no database or query-builder replacement is planned.
Redis/BullMQ integration remains roadmap work. Compose provides isolated local MySQL/Redis services and does not
restore the existing application schema or migrate records.

## Install and run

Use Node.js 22.12+ or Node.js 24 and the existing MySQL database.

```powershell
npm ci
```

Copy `backend/.env.example` to `backend/.env` and fill in the existing database and provider settings. Preserve the exact existing `APP_KEY`: changing it makes saved WhatsApp credentials unreadable. For local development, set `NODE_ENV=development`, `APP_URL=http://127.0.0.1:3000`, and `SESSION_SECURE_COOKIE=false`. Production uses the public HTTPS origin and secure cookies. `APP_URL` must match the browser origin for CSRF checks. Never put secrets in `NEXT_PUBLIC_*` variables.

The API reads its configuration from `backend/.env`; explicit process values take precedence. The web app's optional `API_INTERNAL_URL` defaults to `http://127.0.0.1:4000`; set it before building if the API lives elsewhere.

```powershell
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:3000/app/`. Next serves the UI on port 3000 and forwards `/api/v1/*` to Nest on port 4000. Nest's development command compiles TypeScript before Node runs it so dependency-injection metadata is available.

The additive migration verifies the existing schema and creates missing `node_sessions`, `node_jobs`, `customer_consent_events`, `campaign_runs`, and `campaign_recipients` tables. It does not reset, rename, or delete application tables. This conversion targets the existing database; provisioning a fresh database requires restoring its complete schema first.

## Preserved application features

- All nine workspace pages, both themes, responsive sidebar/header, forms, dropdowns, and dashboard charts.
- Registration creates the business and owner membership transactionally. Existing Laravel bcrypt passwords remain valid; users sign in again because Node sessions use a separate cookie and table.
- Login/logout, Remember me, password reset, local-only demo workspaces, and CSRF protection. SMTP configuration is required for reset emails.
- Tenant-scoped customers, products, automations, knowledge, campaign drafts, inbox notes, assignment, status, and human/AI handling.
- Native WhatsApp manual connection, Facebook Embedded Signup, approved templates, signed webhooks, queued replies, delivery updates, and the 24-hour reply window.
- Native AI source validation, keyword automations, usage reservations, human handover, and recovery.
- Native Razorpay checkout, subscription verification/sync/cancellation/reconciliation, signed webhooks, payment history, and server-owned plan limits.

Existing `/api/v1` URLs and JSON response shapes are retained for the UI. Webhook paths remain `/api/v1/webhooks/whatsapp`, tenant-specific `/api/v1/webhooks/whatsapp/{key}`, and `/api/v1/webhooks/razorpay`. Meta configuration must allow the deployed HTTPS origin.

## Cutover and deployment

1. Back up MySQL and save the existing `APP_KEY` and provider configuration.
2. Stop accepting writes on the old deployment, drain or review Laravel queued jobs and uncertain provider sends, then stop its web/queue/scheduler processes. Node intentionally does not deserialize PHP jobs. Do not run both provider workers during cutover.
3. Install dependencies, configure the API environment, and run `npm run db:migrate`.
4. Build with `npm run build` and start supervised processes with `npm run start:api` and `npm run start:web`.
5. Route your HTTPS domain to Next and forward `/api/v1/*` to Nest while preserving the original request body, host, and forwarded HTTPS scheme. Keep API ports private. If a trusted loopback proxy terminates TLS, set `TRUST_PROXY=true`; do not trust arbitrary public forwarded headers.
6. Set `NODE_ENV=production`, `SESSION_SECURE_COOKIE=true`, a strong `NODE_SESSION_SECRET`, and the real `APP_URL`. Use the unchanged `APP_KEY` for credential compatibility.
7. Set `NODE_WORKER_ENABLED=true` to process durable Node jobs and scheduled recovery/cleanup. Interrupted sends are marked uncertain rather than automatically resent; review them in Meta.
8. Verify login, existing workspace data, real provider onboarding, inbound messages, outgoing replies, billing webhooks, SMTP, backups, and monitoring before allowing customer traffic.

Next's build prepares a standalone deployment including static assets. `start:web` runs that generated server. Configure `HOSTNAME`/`PORT` if needed; defaults are loopback and port 3000. The Nest listener defaults to loopback and `API_PORT=4000`.

## Hostinger build configuration

The production web build explicitly uses Webpack. This avoids the Turbopack
PostCSS child-process crash shown in the Hostinger build log; it does not require
removing Tailwind or changing application styles.

For a deployment whose application root is `frontend`, use `npm run build`,
output directory `.next`, and `npm start` as the start command. From the repository
root, use `npm run build:web` and `npm run start:web`. Install workspace dependencies
from the repository root with `npm ci`, including build-time dev dependencies.
Use Node.js 22.12+ or 24.

On Windows, run dependency installation and production builds from a normal
terminal with write access to the workspace. If a restricted execution sandbox
reports `EPERM` while Next creates `.next` directories, run the build outside that
sandbox. This environment required unrestricted execution for standalone tracing.
If TypeScript reports missing standard libraries or installed type packages,
restore the lockfile-pinned dependencies with `npm ci` from the repository root,
then run `npm run build:web` again. Type checking and standalone dependency checks
remain enabled.

The frontend build traces dependencies from the repository root and copies shared
standalone dependencies beside the generated `server.js`. This keeps `next` and
React available when hosting publishes only the nested frontend server folder.
The build fails if core runtime packages resolve outside that folder. For the
Next.js hosting preset, keep application root `frontend`, build `npm run build`,
and output `.next`.

The web deployment alone does not run the API. Deploy and supervise the NestJS API
separately using `npm run build:api` and `npm run start:api` from the repository
root. Set `API_INTERNAL_URL` in the web build environment to an address reachable
from the web server. Its loopback default works only when both processes share
the same host. A changed API address requires rebuilding Next's rewrites.
Keep database credentials and provider secrets in the API environment only.

For the API deployment, use the repository root as the application root, install
with `npm ci` (including dev dependencies), build with `npm run build:api`, and
select `dist` as the output directory. The build includes the compiled backend
and its lockfile-pinned production dependencies inside that directory. If the
host preserves the output folder, the entry is `dist/main.js`; if it deploys the
contents of that folder as the application root, the entry is `main.js`.
Use hosting environment variables for API secrets; `.env` files are not copied.
Do not deploy `backend/dist` by itself: it contains only JavaScript and will fail
with errors such as `Cannot find module 'dotenv'` without installed dependencies.

If API logs report `ER_NO_SUCH_TABLE`, verify `DB_DATABASE` points to the existing
application database. To run the migration automatically on every API deployment
and restart, set `DB_MIGRATE_ON_START=true` in the backend hosting environment.
Migration finishes before HTTP requests or background workers start; failures
stop startup. It uses the same database settings as the API and skips existing
runtime tables. It still requires the existing application schema; it cannot
initialize an empty database. Leave the variable unset or false to migrate manually.

For a manual migration, verify `DB_DATABASE` points to the existing
application database and run the additive migration with the API's production
environment variables. From the deployed `nodejs` directory with output under
`dist`, run `node dist/backend/dist/migrate.js`. If the contents of the output
folder are deployed directly, run `node backend/dist/migrate.js` instead. This
checks the existing application schema and creates missing `node_sessions` and
`node_jobs` tables; it does not provision a fresh application database.

For a loopback reverse proxy, set `TRUST_PROXY=true` on the API deployment and
restart it. The application maps this value to Express's `loopback` trust policy,
not unrestricted proxy trust. If the proxy connects from another address, verify
the hosting proxy topology before changing that policy.

There are no Laravel PHP sources in the current tracked application. Keep
`APP_KEY` and Laravel-compatible password/encryption handling: existing records
still depend on them. The ignored `.local-backups` archive is a recovery backup,
not part of the deployment.

## Verification commands

```powershell
npm test
npm run test:signup-ui
npm run build
```

The optional native API smoke test uses an already running API and creates no application records:

```powershell
$env:RUN_API_SMOKE='true'
npm test
```

Tests cover validation, tenant boundaries, Laravel bcrypt and encryption compatibility, password-reset session invalidation, raw webhook signatures, template restrictions, AI source validation, reply-window enforcement, and Graph transport ambiguity. Local API smoke tests additionally exercise MySQL-backed sessions, CSRF, and guest access. Live Meta/OpenAI/Razorpay calls and complete production transaction/concurrency parity still require acceptance testing; passing builds and unit tests do not establish that coverage.

## Code map

- `frontend/app/`: Next routes and layouts.
- `frontend/features/workspace/`: preserved React workspace and provider UI.
- `frontend/styles/workspace.css`: existing theme and responsive styles.
- `backend/src/auth/`: native authentication and demo fixtures.
- `backend/src/workspace/`: tenant-scoped workspace APIs.
- `backend/src/providers/`: WhatsApp, AI, Razorpay, signup, and webhook processing.
- `backend/src/common/`: MySQL, sessions, CSRF boundary, authenticated access, credential encryption, and durable job queue.
- `backend/src/migrate.ts`: additive Node runtime-table migration.

The product documents distinguish implemented behavior from the remaining roadmap.
Team invitations, platform-wide administration, full-history pagination, tax
invoices, advanced template authoring and media campaigns remain future work.
