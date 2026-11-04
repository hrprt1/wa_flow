# WaFlow deployment and security

## Current deployment

Current runtime needs Node.js 22.12+ or 24 and the existing MySQL schema. MySQL is the approved database. The local Compose MySQL service does not restore the existing application schema. See README for current standalone/Hostinger packaging.

1. Back up SQL and secrets; prove isolated restore.
2. Run npm ci from root, including build dependencies.
3. Configure backend environment from backend/.env.example. Preserve exact APP_KEY for saved credential decryption. Set separate strong NODE_SESSION_SECRET, real APP_URL, NODE_ENV=production and SESSION_SECURE_COOKIE=true.
4. Run npm run db:migrate; current migration needs existing tables and is not a fresh installer.
5. Run npm run build and supervise npm run start:api plus npm run start:web. Keep API private behind Next/HTTPS.
6. Set API_INTERNAL_URL at web build time when API is remote. Keep provider secrets out of NEXT_PUBLIC variables.
7. Configure SMTP, signed provider callbacks and workers; verify controlled staging sends before customer traffic.

API defaults to loopback. TRUST_PROXY=true trusts loopback only; verify hosting topology. Proxies must preserve webhook bytes/signature headers. Stop old workers before starting replacements.

## Target infrastructure

MySQL requires TLS, least privilege, backups and tested point-in-time restore. Apply reviewed additive migrations once per release; do not reset the production database. Keep MySQL and Knex; review schema compatibility before applying migrations. Redis should be private/authenticated, use persistence appropriate to queue durability and avoid queue-key eviction. Supervise API/worker/outbox relay with graceful shutdown. SQL outbox and recipient rows recover queue-publication failures. Target compose services are local development infrastructure, not a production deployment or application migration.

## Security gates

- Secure rotating sessions, CSRF/origin checks, strong password hashes and bounded authentication requests.
- Membership-derived tenant and role/resource checks, including worker authorization and composite tenant relations.
- Encrypted provider credentials, versioned key rotation, redacted logs, tested revocation and no browser exposure.
- Exact-byte HMAC, account routing, replay deduplication and bounded webhook payloads.
- Bounded validated imports, private file/error-report storage, retention cleanup and formula-safe CSV exports.
- Dispatch-time permission/suppression, approved template/account eligibility, quotas and provider pacing.
- Explicit platform operator permission and audited minimum-access support actions.

Current in-process HTTP limits are not global across replicas; add shared limits or edge enforcement before scaling. Provider rate limits are separate from HTTP request limits.

## Monitoring and incidents

Monitor API/SQL latency/errors/connections, oldest pending job/outbox, webhook lag, failed/stalled work, account errors, uncertain sends, reservation drift, billing lag and backup health. Correlate request/job IDs; redact tokens, phones and message bodies from normal logs. Assign actionable alert owners.

Pause compromised/disconnected account campaigns, revoke credentials and reconcile provider acceptance before retries. A timeout does not prove a send failed. Define retention/deletion for contacts, permission evidence, imports, message history, webhook bodies, billing and backups before onboarding. Do not send banking credentials/payment authentication data in marketing messages.

Use current [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) for eligibility; political campaigning is excluded. Regulated use needs jurisdiction-specific review. Record policy review date, deployed version, migration logs, acceptance evidence, backup restore and rollback conditions. Writing these guidelines does not deploy the system or certify compliance.
