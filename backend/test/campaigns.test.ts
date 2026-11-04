import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignsService, scheduleSchema, staticTemplates } from '../src/campaigns/campaigns.service';
import { ProviderService } from '../src/providers/provider.service';

const template = { name: 'sale', language: 'en_US', status: 'APPROVED', components: [{ type: 'HEADER', format: 'TEXT', text: 'News' }, { type: 'BODY', text: 'Our sale starts today.' }, { type: 'FOOTER', text: 'Reply STOP to opt out' }] };

function fixture() {
  const locks: string[] = [];
  const tables: Record<string, any[]> = {
    businesses: [{ id: 1 }], campaigns: [{ id: 5, business_id: 1, audience: 'VIP' }],
    customers: [{ id: 7, business_id: 1, opted_in: true, tag: 'VIP' }, { id: 8, business_id: 1, opted_in: false, tag: 'VIP' }, { id: 9, business_id: 2, opted_in: true, tag: 'VIP' }],
    campaign_runs: [], campaign_recipients: [], node_jobs: [], conversations: [], messages: [], usage_months: [], customer_consent_events: [],
  };
  const db: any = (table: string) => {
    let filters: Record<string, any> = {}; let max = Infinity;
    const rows = () => tables[table].filter(row => Object.entries(filters).every(([k,v]) => row[k] == v)).slice(0, max);
    const query: any = {
      where(condition: any, value?: any) { Object.assign(filters, typeof condition === 'string' ? { [condition]: value } : condition); return query; },
      forUpdate() { locks.push(table); return query; }, orderBy() { return query; }, limit(n: number) { max = n; return query; },
      async first() { return rows()[0]; }, async select() { return rows(); },
      async insert(data: any) { const id = tables[table].length + 1; tables[table].push({ id, ...data }); return [id]; },
      async update(data: any) { const matching = rows(); for (const row of matching) Object.assign(row, data); return matching.length; },
      then(resolve: any, reject: any) { return Promise.resolve(rows()).then(resolve, reject); },
    }; return query;
  };
  db.transaction = async (callback: any) => callback(db);
  const providers: any = { permanent: async () => {}, templates: async () => [template], limits: async () => ({ messages: 100 }), reserve: async () => 1, send: async () => {} };
  return { tables, db, providers, locks, service: new CampaignsService({ db } as any, providers, {} as any) };
}

test('campaign templates show all static text and exclude unapproved or dynamic messages', () => {
  assert.equal(staticTemplates([template])[0].body, 'News\n\nOur sale starts today.\n\nReply STOP to opt out');
  for (const change of [{ status: 'PENDING' }, { components: [{ type: 'BODY', text: 'Hi {{1}}' }] }, { components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }] }]) assert.equal(staticTemplates([{ ...template, ...change }]).length, 0);
  assert.equal(scheduleSchema.safeParse({ template_name: 'sale', language: 'en_US', consent_confirmed: false }).success, false);
});

test('schedule snapshots only opted-in tenant audience and atomically creates jobs; repeated schedule cannot duplicate recipients', async () => {
  const f = fixture();
  const result = await f.service.schedule(1, 5, { template_name: 'sale', language: 'en_US', consent_confirmed: true });
  assert.equal(result.recipients, 1);
  assert.equal(f.tables.campaign_recipients[0].customer_id, 7);
  assert.equal(f.tables.node_jobs.length, 1);
  assert.equal(f.tables.node_jobs[0].kind, 'campaign-recipient');
  await assert.rejects(() => f.service.schedule(1, 5, { template_name: 'sale', language: 'en_US', consent_confirmed: true }), /already been scheduled/);
  assert.equal(f.tables.node_jobs.length, 1);
  await assert.rejects(() => f.service.schedule(2, 5, { template_name: 'sale', language: 'en_US', consent_confirmed: true }), /not found/);
});

test('queued recipient is skipped if consent is revoked before execution', async () => {
  const f = fixture();
  await f.service.schedule(1, 5, { template_name: 'sale', language: 'en_US', consent_confirmed: true });
  f.tables.customers[0].opted_in = false;
  await f.service.process(1);
  assert.equal(f.tables.campaign_recipients[0].status, 'skipped');
  assert.equal(f.tables.messages.length, 0);
});

test('campaign processing creates one message and usage reservation across repeated job delivery', async () => {
  const f = fixture(); let reserved = 0; let sent = 0;
  f.providers.reserve = async () => ++reserved;
  f.providers.send = async () => { sent++; };
  await f.service.schedule(1, 5, { template_name: 'sale', language: 'en_US', consent_confirmed: true });
  await f.service.process(1); await f.service.process(1);
  assert.equal(f.tables.messages.length, 1); assert.equal(reserved, 1); assert.equal(sent, 0);
  assert.equal(f.tables.node_jobs.filter(j => j.kind === 'send-whatsapp').length, 1);
  assert.equal(f.tables.messages[0].client_key, 'campaign:1:7');
});

test('send refuses a campaign cancelled after message enqueue without contacting Meta', async () => {
  const f = fixture();
  f.tables.messages.push({ id: 99, business_id: 1, status: 'queued', client_key: 'campaign:1:7' });
  f.tables.campaign_runs.push({ id: 1, business_id: 1, status: 'cancelled' });
  f.tables.campaign_recipients.push({ id: 1, business_id: 1, run_id: 1, customer_id: 7, message_id: 99 });
  const p = new ProviderService({ db: f.db } as any, {} as any, {} as any);
  p.graph = async () => { throw new Error('Must not send'); };
  await p.send(99);
  assert.equal(f.tables.messages[0].status, 'cancelled');
  assert.deepEqual(f.locks, ['businesses', 'messages', 'campaign_recipients', 'campaign_runs', 'customers'], 'authorization and consent need current locking reads after the tenant lock, not an older MySQL snapshot');
});

test('inbound STOP revokes consent once, records evidence, and does not enqueue an automatic reply', async () => {
  const f = fixture(); f.tables.customers[0].phone = '+919876543210';
  f.tables.conversations.push({ id: 12, business_id: 1, customer_id: 7, mode: 'ai', unread: 0 });
  const p = new ProviderService({ db: f.db } as any, {} as any, { enqueue: async () => { throw new Error('Opt-out must not trigger reply'); } } as any);
  const value = { messages: [{ id: 'wamid.stop', from: '919876543210', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: ' stop ' } }] };
  await p.ingest(1, value); await p.ingest(1, value);
  assert.equal(f.tables.customers[0].opted_in, false);
  assert.equal(f.tables.customer_consent_events.length, 1);
  assert.equal(f.tables.customer_consent_events[0].source, 'WhatsApp inbound opt-out');
  assert.equal(f.tables.messages.length, 1);
  assert.equal(f.tables.messages[0].reply_state, null);
  assert.equal(f.tables.conversations[0].mode, 'human');
});
