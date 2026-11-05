# WaFlow product requirements

Product specification, 4 November 2026. This describes the requested product and distinguishes working source from the remaining roadmap. No live-provider acceptance or production deployment is implied.

## Audience and outcome

WaFlow helps retailers, shopkeepers, service providers and SMBs connect official WhatsApp accounts, manage customers and run permission-based marketing campaigns. Banks and regulated businesses require industry/country-specific eligibility and data-handling review. Campaign teams means eligible commercial/nonpolitical teams: political parties, candidates, political campaigns and political campaigning service providers are excluded by the [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy). Recheck current policy before launch.

The first-use journey is register → connect with Embedded Signup → add/import customers → select approved template → review exclusions → send a test/schedule → inspect outcomes and reply in the inbox. Use plain-language errors, visible progress, mobile layouts, keyboard-accessible controls and a short onboarding checklist. Do not require shopkeepers to understand tokens or webhooks.

## Functional requirements

| Area | Product requirement | Acceptance condition |
|---|---|---|
| Authentication | Register/login/logout/reset and secure sessions | Reset invalidates prior sessions; CSRF and session rotation verified |
| Workspace | Business profile, memberships and selection | Server derives tenant from authenticated membership |
| Roles | Owner/admin/manager/agent/viewer; explicit platform operator | Role/resource checks cover HTTP and worker actions |
| WhatsApp | Official Embedded Signup, account health, encrypted credentials | Real staging account connects and completes message round-trip |
| Contacts | Manual entry, CSV preview/import, normalized phones, deduplication | Invalid rows are actionable; import never implies marketing permission |
| Permission | Evidence, category preferences, withdrawal and suppression | Opt-out after scheduling wins before subsequent dispatch |
| Segments | Groups/tags and simple saved filters | Preview and workers share server-owned audience rules |
| Templates | Sync/list/preview, approved-template selection | Unsupported/rejected/paused templates cannot dispatch |
| Campaigns | Draft/review/test/schedule/cancel, recipient outcomes | Recipient uniqueness, timezone validation and limits enforced |
| Delivery | Queued, submitted, sent, delivered, read, failed, suppressed, uncertain | Reordered webhooks cannot regress status; unknown sends not blindly repeated |
| Analytics | Date-filtered counts/rates with clear denominators | Metrics reconcile with persisted recipient rows |
| Billing | Plans, subscriptions, payment verification and quota | Server-owned limits and atomic usage reservations |
| Administration | Tenant support, failed work, usage and audit | Explicit platform permissions and audited access |

## Target permissions

Owners manage everything including subscription and workspace deletion. Admins manage integrations, members and business features. Managers manage contacts/campaigns/inbox. Agents handle inbox/customer interactions. Viewers read permitted records. Platform support privileges are separate; support impersonation is outside initial scope. The current code's workspace-write guard is narrower than this target and must not be described as complete agent support.

## Messaging requirements

WaFlow deliberately requires recorded affirmative marketing permission. Store source, time, category and withdrawal evidence. Unknown permission excludes a customer. Importing a phone or receiving a support message does not grant future marketing permission. Check suppression, account/template eligibility and quota again at dispatch.

Use approved templates for business-initiated marketing. Current application free-form replies enforce a 24-hour customer-service window. The provider's [messaging policy](https://business.whatsapp.com/policy) governs eligibility, restrictions and approved-template requirements. Jurisdiction-specific rules need separate review. Software does not establish legal eligibility by itself.

## Nonfunctional requirements

Retain the approved MySQL database and Knex query builder. Redis/BullMQ remains planned queue work. Keep tenant ownership on every relation and queued action. Use SQL transactions, unique recipient identities, an outbox and bounded batches. Never promise exactly-once external delivery. Paginate lists, bound imports and retries, measure before adding caching, protect credentials and test backup restores.

## Current baseline and release boundary

Next.js 16/React 19 and NestJS 11 already exist. The executable runtime uses MySQL/Knex, MySQL sessions and node_jobs, with Redis/BullMQ not yet integrated. Existing source includes authentication, tenant-scoped workspaces, Embedded Signup, individual approved-template sends, signed webhooks, inbox/AI/catalogue features and Razorpay flows. Configured services and live staging acceptance remain necessary.

This delivery extends the marketing flow with bounded CSV import/permission evidence and scheduled static-template campaigns; [API.md](API.md) documents those contracts. It includes paginated contacts, batched imports and subscription-limited bulk audiences. It does not establish full saved segmentation, general template components, complete platform administration or Redis/BullMQ integration.

A production release needs the complete permitted-campaign journey against staging providers, tenant/role/consent regressions, database restore/cutover rehearsal and assigned monitoring owners. Builds alone do not satisfy release acceptance. Defer mobile apps, omnichannel messaging, visual workflow engines, autonomous financial actions and enterprise SSO.
