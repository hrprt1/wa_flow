# WaFlow REST API

Base path `/api/v1`. This documents current controllers and the bounded marketing extension; the target additions section is a roadmap, not available routes.

## Session and errors

Browser requests use the HttpOnly waflow.sid cookie. GET /session first, retain cookies and send data.csrf as X-CSRF-TOKEN on mutations including login. Origin must match APP_URL. Refresh session after authentication because tokens rotate. Webhooks use provider HMAC instead of CSRF.

Success normally wraps data; webhooks return received:true. Errors contain message and sometimes field errors. Current API has no universal error code. Typical statuses: validation 422, unauthenticated 401, forbidden 403, not found 404, expired CSRF 419 and rate limit 429. Nest POST defaults to 201 unless overridden; accept successful 2xx codes. Never repeat provider mutations merely because the browser lost a response.

## Authentication

| Method/path | Behavior |
|---|---|
| GET /session | user (nullable), csrf, demo_available |
| POST /auth/register | name,business,email,password,password_confirmation; password 10–200 chars with letter and digit |
| POST /auth/login | Login and session rotation |
| POST /auth/logout | Regenerate session |
| POST /auth/forgot-password | Reset request; real SMTP required |
| POST /auth/reset-password | Token/email/confirmed password; invalidate old sessions |
| POST /auth/demo | Nonproduction demo |

## Workspace

GET /workspace returns a bounded tenant snapshot. Optional conversation_id includes a tenant-owned older conversation and its latest 100 messages. Tenant is derived from membership, currently the user's first membership; explicit workspace selection is a target feature. It is not a full-history export.

POST /:resource supports customers (name, E.164 phone, optional email, tag, optional opted_in and consent_source required if true), products (name,sku,category,price_paise,stock), automations (name,keyword,response), knowledge (title,content), campaigns (name,audience,body). Campaign audience is All opted-in customers, VIP or New. Unknown resources are rejected.

PATCH /:resource/:id supports conversations (open/resolved, ai/human, assignee, unread=0), automations (active), customers (status,tag and marketing permission extension), businesses (name,industry,email). Workspace mutations currently require owner/admin/manager. POST /conversations/:id/messages handles notes/replies; live replies need unique client_key and an open reply window. POST /conversations/:id/simulate is demo behavior.

GET /customers accepts cursor (positive contact ID), limit (1–100, default 50) and q (search text, max 100). It returns data:{items,next_cursor,total}; IDs descend and total reflects the full search. GET /customers/:id/conversation returns the tenant-owned conversation ID for opening older contacts in the inbox.

## Bounded marketing extension

| Method/path | Payload / behavior |
|---|---|
| POST /customers/import | {csv,consent_source?}; required headers name,phone; optional email,tag,opted_in; up to 10,000 rows / 5 MB per file; no total contact-storage cap; source required if any opted_in=true; validate atomically, skip existing duplicates without re-opting them in |
| PATCH /customers/:id | opted_in:boolean and consent_source required when granting; permission events persisted in customer_consent_events |
| POST /campaigns/:id/preview | {scheduled_at?:ISO}; count the full audience and return plan allowance |
| POST /campaigns/:id/schedule | template_name,language,scheduled_at? (ISO with offset, within 90 days),consent_confirmed:true |
| POST /campaigns/:id/cancel | {}; stop pending campaign work |
| GET /campaigns/:id/status | Campaign recipient/outcome status |

Only approved static templates without parameters/media/buttons are supported by this campaign path. Existing body drafts do not permit arbitrary free-form bulk sends. Scheduling and worker processing must preserve tenant scope, suppression, usage limits and duplicate protection. Configured MySQL schema/provider access is needed for end-to-end execution; source/build checks are not live-send acceptance.

## Integration and billing

Integration operations require owner/admin. Billing mutations require owner. Temporary demo tenants cannot perform real provider actions.

| Method/path | Request/behavior |
|---|---|
| POST /integrations/whatsapp | phone_number_id,access_token,app_secret?,waba_id?; advanced manual connection |
| GET /integrations/whatsapp/templates | Connected account templates |
| POST /integrations/whatsapp/templates/send | phone,name,language,parameters,client_key,consent:true; individual send |
| POST /integrations/whatsapp/subscribe | Subscribe WABA |
| POST /integrations/whatsapp/signup/start | Session/user/tenant-bound state |
| POST /integrations/whatsapp/signup/exchange | state,code |
| POST /integrations/whatsapp/signup/complete | state,waba_id,phone_number_id |
| PATCH /integrations/ai | ai_enabled:boolean |
| POST /integrations/ai/test | question |
| POST /billing/subscribe | Server-owned plan key |
| POST /billing/sync | Refresh subscription |
| POST /billing/cancel | Schedule cancellation |
| POST /billing/reconcile | provider_id |
| POST /billing/verify | Razorpay payment/subscription IDs and signature |

## Webhooks

GET /webhooks/whatsapp and /webhooks/whatsapp/:key verify hub.mode, hub.verify_token and hub.challenge. POST to either validates X-Hub-Signature-256 over exact raw bytes. POST /webhooks/razorpay validates X-Razorpay-Signature. The account key does not replace HMAC. Resolve tenants through stored account/phone mapping, persist events and process asynchronously. Preserve bytes/headers at proxies.

## Target additions (not implemented by this specification)

- GET/POST /workspaces; POST /workspaces/:id/select; membership management.
- GET/DELETE /customers/:id and import preview/confirm/error-report operations.
- Category-level consent events/preferences, tags and saved segment CRUD/preview.
- Expanded template synchronization/submission and supported component mapping.
- Paginated GET /campaigns, campaign test operation, metrics and analytics endpoints.
- Explicitly privileged /admin/businesses, /admin/jobs, /admin/usage and /admin/audit-logs.

Target lists use stable cursors and page size at most 100. Target schedule mutations should support persisted idempotency keys and expected_version; key/content conflicts and concurrent edits return 409. SQL outbox publication follows transaction commit. Report rates with denominators and update times; absent read receipts are not delivery failures. Never accept client business_id, recipient count or calculated allowance as authoritative.


Current preview response: data:{eligible,excluded,templates:[{name,language,body}],allowance:{plan,period,limit,used,reserved,remaining}}. Schedule response: data:{id,status:"scheduled",recipients}. Each draft can be scheduled only once; another attempt returns 409. Status response: data:{run:null,counts:{}} before scheduling, otherwise run contains id,status,scheduled_at,template_name,language and counts groups current recipient/message statuses. Cancel returns data:{cancelled:true}. Preview counts the full matching audience in SQL. Scheduling must fit the full audience within remaining allowance; it never silently truncates recipients. CSV opted_in accepts true/false/empty; empty defaults false, tag defaults New. Files are bounded to 5 MB and duplicate phone rows within one file reject the import. Current permission evidence is operator-supplied source text and recorded timestamp, not independently verified proof.

## Campaign allowance accounting

Allowance uses UTC calendar months. Pending recipients reserve message slots in their scheduled month; overdue pending recipients count against the current month. Scheduling and ordinary replies share the tenant lock and cannot spend the same reserved slots. Processing atomically converts a pending reservation into booked usage. Cancellation, skipped consent and terminal recipient failure release pending slots. Already queued messages retain booked usage, including cancelled or uncertain sends; usage is accounted when booked, not when Meta eventually receives it. Future schedules recheck current plan access at dispatch and do not guarantee subscription renewal. Snapshot integrations.message_allowance exposes the current plan/period/limit/used/reserved/remaining values.

The import route allows a 32 MB JSON envelope for escaped CSV; decoded CSV remains limited to 5 MB and 10,000 rows. Other payloads retain their 1 MB limit. Imports have a dedicated request limiter. Campaign recipients/jobs are inserted in 250-row batches; delivery counts use SQL aggregation. Workers prioritize incoming webhooks and outgoing sends before campaign expansion.
