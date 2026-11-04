# WaFlow database design

## Actual persistence

Current backend uses MySQL/Knex. The additive migration checks existing application tables and adds runtime tables; it is not a fresh-database installer. MySQL and Knex are the supported persistence stack. Preserve existing tables, data, password hashes and APP_KEY.

## Target conventions

Shared schema with business_id on tenant rows. Preserve numeric IDs initially for API compatibility; assess integer safety before serialization. Use MySQL DATETIME(3) with UTC at the application/database boundary for instants and an IANA business timezone. Use integer minor units/currency for money. Provider IDs are strings. Encrypt secrets with key version; keep keys outside SQL. Use JSON only for validated filters/components/provider payloads, not an entire recipient ledger. Schema changes use reviewed, additive, versioned Knex migrations.

| Entity | Core data and constraints |
|---|---|
| User | Normalized unique email, hash, session version, status |
| Business/Membership | Business timezone/status; unique business/user membership and explicit role |
| WhatsAppAccount | Tenant, globally unique phone number ID, WABA ID, encrypted token/key version/status |
| Customer | Tenant/name/normalized phone/email; unique tenant+phone |
| ConsentEvent | Tenant/customer/category/action/source/evidence/time; append-only history |
| CustomerPreference | Tenant/customer/category/allowed/version; unique category preference |
| Tag/CustomerTag | Unique tenant/name and tenant/customer/tag pair |
| Segment | Tenant/name/version and validated allowlisted filter |
| ContactImport | Tenant/requestor/file reference/state/counts/error-report reference |
| Template | Tenant/account/provider ID/name/language/status/category/components; unique account/name/language |
| Campaign | Tenant/name/state/account/template snapshot/audience snapshot/scheduled time/creator/version |
| CampaignRecipient | Tenant/campaign/customer/state/message/error; unique tenant/campaign/customer |
| Conversation/Message | Tenant/customer/account; timestamped intent/provider status and idempotency key |
| WebhookEvent | Provider/account/event key/payload/state; unique provider/account/event key |
| OutboxEvent | Tenant/kind/aggregate/dedupe key/payload/availability/publication; unique dedupe key |
| Plan/Subscription | Server-owned limits, currency, provider identity and billing period |
| UsagePeriod/Reservation | Tenant/metric/period counters; unique subject identity and reservation lifecycle |
| Payment | Unique provider/payment ID, amount/currency/state |
| AuditLog | Tenant/actor/action/subject/request ID and redacted metadata |

Current extension uses customer_consent_events and campaign recipient tables on MySQL. These incremental tables are not equivalent to the complete category-preference/target domain above. Retain unrelated catalogue/AI/automation tables.

## Tenant integrity and indexes

Tenant-owned parent rows have a unique (business_id,id) key. Child relations use composite tenant foreign keys, for example recipient(business_id,customer_id) → customer(business_id,id), preventing cross-tenant relationships even if a malformed ID reaches persistence. Application authorization still derives tenant from membership.

Index customer(business_id,created_at,id), campaign(business_id,created_at,id), campaign(status,scheduled_at,id), recipient(business_id,campaign_id,status,id), conversation(business_id,status,last_message_at,id), message(business_id,conversation_id,created_at,id), and outbox(published_at,available_at,id). Inspect plans before adding redundant indexes. Verify existing MySQL indexes and composite foreign-key compatibility before applying new constraints.

## Transactions and state

Schedule saves reviewed audience/template version and outbox row together. Recipient expansion is chunked and unique. Before dispatch atomically claim a recipient and reserve allowance after rechecking current consent/suppression/template/account. Deterministic queue IDs supplement SQL uniqueness, not replace it.

Campaigns move draft → scheduled → processing → completed, with cancellation preventing new claims. Recipient states distinguish queued/submitted/sent/delivered/read/failed/suppressed/cancelled/uncertain. Apply explicit transitions so reordered events cannot overwrite read with sent. External send and SQL cannot share one transaction: ambiguous transport requires reconciliation.

## MySQL evolution gates

1. Inventory real MySQL DDL, counts, orphan relations, timestamps, collations, JSON and encrypted formats; these documents are not a dump.
2. Restore the existing schema into isolated staging and apply reviewed additive migrations.
3. Keep legacy consent evidence intact; never bulk grant permission to unknown customers.
4. Verify tenant relations, indexes, financial totals, sampled histories and credential decryption.
5. Rehearse backup restore and rollback before deployment.
6. For Redis/BullMQ adoption, drain old workers, verify outbox recovery and start only the new workers after smoke checks.

Keep MySQL and Knex. Apply schema evolution through reviewed Knex migrations without resetting or recreating existing application data.

Bound raw event/import/message retention and cleanup expired sessions/reset/signup state. Store large files privately with expiry. Add aggregates, replicas or partitions only after measured workload demonstrates need.
