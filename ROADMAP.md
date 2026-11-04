# WaFlow development roadmap

Ordered delivery gates, not completed milestones. Current Next/Nest/MySQL implementation is the starting point.

| Stage | Deliverable | Exit gate |
|---|---|---|
| Baseline | PRD/contracts/tenant matrix/schema inventory | Existing checks recorded; backup restored in staging |
| Marketing foundation | Bounded import, permission evidence, opt-out and campaign flow | Invalid/duplicate rows cannot grant consent; tenant/withdrawal regressions pass |
| Provider acceptance | Embedded Signup health, templates and round-trip | Real staging business connects, receives webhook and sends approved test |
| Campaign reliability | Review/test/schedule/cancel, recipient ledger and usage reservations | Duplicate/concurrent/stalled work and permission-change checks |
| Queue reliability | Retain MySQL/Knex; add Redis/BullMQ and SQL outbox | Recovery, duplicate-job and worker cutover rehearsal |
| Reporting/operations | Reconciled metrics, billing view, platform audit/admin | Role/financial-state checks and safe uncertain-send operations |
| Production release | Usability, monitoring, privacy/retention and restore | Full permitted first-campaign journey and assigned operating owners |

The current 100-contact static-template flow is a bounded first implementation. MySQL is approved; no PostgreSQL conversion is required. Keep the working Knex adapter. Redis/BullMQ integration remains a separate delivery stage. Expand import pagination, saved segments and supported template components after the core reliability gates.

External dependencies include Meta app review/permissions, eligible verified business and numbers, SMTP, billing account, DNS/TLS and a worker cutover window. Political campaigning is excluded by provider policy; regulated industries need current eligibility review. Dates depend on actual schema/provider approval and staging evidence.

Keep existing catalogue/AI/inbox behavior. Defer microservices, omnichannel messaging, complex workflow builders, enterprise SSO and speculative caching. No schema reset or destructive replacement is part of this roadmap.
