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
    const [name, alias] = table.split(' as ');
    let filters: ((row: any) => boolean)[] = [], max = Infinity, order = '', grouped = '', counting = false, selected = '';
    let joined = '', increments: [string, number][] = [];
    const get = (row: any, key: string) => key === 'status' && alias === 'r' ? row['m.status'] || row['r.status'] : row[key];
    const rows = () => {
      let result = tables[name].map(row => alias ? { ...row, ...Object.fromEntries(Object.entries(row).map(([k,v]) => [`${alias}.${k}`,v])) } : row);
      if (joined) result = result.map(row => {
        const [other, otherAlias] = joined.split(' as ');
        const match = tables[other].find(value => otherAlias === 'c' ? value.id === row.run_id && value.business_id === row.business_id : value.id === row.message_id && value.business_id === row.business_id);
        return { ...row, ...Object.fromEntries(Object.entries(match || {}).map(([k,v]) => [`${otherAlias}.${k}`,v])) };
      });
      result = result.filter(row => filters.every(filter => filter(row)));
      if (order) result.sort((a,b) => Number(get(a,order)) - Number(get(b,order)));
      return result.slice(0,max);
    };
    const values = () => {
      const matching = rows();
      if (counting && grouped) {
        const groups = new Map<any,number>();
        for (const row of matching) groups.set(get(row,grouped), (groups.get(get(row,grouped)) || 0) + 1);
        return [...groups].map(([key,count]) => ({ [grouped]: key, count }));
      }
      if (counting) return [{ count: matching.length }];
      if (increments.length) { for (const row of matching) for (const [key,amount] of increments) row[key] = Number(row[key] || 0) + amount; increments = []; return matching.length; }
      return matching;
    };
    const query: any = {
      where(condition: any, operator?: any, value?: any) {
        if (typeof condition !== 'string') filters.push(row => Object.entries(condition).every(([k,v]) => get(row,k) == v));
        else if (value === undefined) filters.push(row => get(row,condition) == operator);
        else filters.push(row => { const left=get(row,condition); return operator === '>' ? left > value : operator === '>=' ? left >= value : operator === '<' ? left < value : left == value; });
        return query;
      },
      whereNot(key: string, value: any) { filters.push(row => get(row,key) != value); return query; },
      whereNotNull(key: string) { filters.push(row => get(row,key) != null); return query; },
      whereIn(key: string, list: any) { filters.push(row => (Array.isArray(list) ? list : list._values()).includes(get(row,key))); return query; },
      forUpdate() { locks.push(table); return query; }, orderBy(key: string) { order=key; return query; }, limit(n: number) { max = n; return query; },
      join(other: string) { joined=other; return query; }, leftJoin(other: string) { joined=other; return query; },
      clone() { const next=db(table); return next._copy(filters,max,order,joined); },
      _copy(f: any, m: number, o: string, j: string) { filters=[...f];max=m;order=o;joined=j;return query; },
      _values() { return rows().map(row => get(row,selected)); },
      count() { counting=true;return query; }, groupBy(key: string) { grouped=key;return query; }, groupByRaw() { grouped='status';return query; },
      async first() { return (values() as any[])[0]; }, select(key: any) { selected=key; return query; },
      insert(data: any) {
        const perform=async()=>{ const ids=[];for(const value of Array.isArray(data)?data:[data]){const id=Math.max(0,...tables[name].map(r=>r.id))+1;tables[name].push({id,...(name==='usage_months'?{messages:0,ai_requests:0,input_tokens:0,output_tokens:0,reserved_tokens:0}:{}),...value});ids.push(id);}return ids; };
        return { then(resolve:any,reject:any) { return perform().then(resolve,reject); }, onConflict() { return {ignore:async()=>{if(!tables[name].some(r=>r.business_id===data.business_id&&r.month===data.month))await perform();}}; } };
      },
      async update(data: any) { const matching = rows(); for (const row of matching) Object.assign(row, data); return matching.length; },
      increment(key: string, amount: number) { increments.push([key,amount]);return query; },
      then(resolve: any, reject: any) { return Promise.resolve(values()).then(resolve, reject); },
    }; return query;
  };
  db.raw = (sql: string) => sql;
  db.transaction = async (callback: any) => callback(db);
  const providers: any = { permanent: async () => {}, templates: async () => [template], limits: async () => ({ messages: 100 }), reserve: async () => 1, send: async () => {} };
  const realProvider = new ProviderService({ db } as any, {} as any, {} as any);
  realProvider.limits = async () => ({ plan:'starter', messages:1000, ai_requests:100, tokens:500000 });
  providers.messageAllowance = realProvider.messageAllowance.bind(realProvider);
  return { tables, db, providers, realProvider, locks, service: new CampaignsService({ db } as any, providers, {} as any) };
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

const scheduleInput = { template_name: 'sale', language: 'en_US', consent_confirmed: true };
function customers(count: number) {
  return Array.from({length:count},(_,index)=>({ id:index+1, business_id:1, opted_in:true, tag:'VIP' }));
}

test('bulk preview counts the complete audience instead of the first hundred contacts', async () => {
  const f=fixture(); f.tables.customers=customers(1250);
  f.tables.customers.push({id:2000,business_id:1,opted_in:false,tag:'VIP'}, {id:2001,business_id:2,opted_in:true,tag:'VIP'});
  const preview=await f.service.preview(1,5);
  assert.equal(preview.eligible,1250);assert.equal(preview.excluded,1);
  assert.equal(preview.allowance.limit,1000);assert.equal(preview.allowance.remaining,1000);
});

test('starter campaigns above 100 recipients use remaining allowance and batch all recipient jobs', async () => {
  const f=fixture(); f.tables.customers=customers(751);
  f.tables.usage_months.push({id:1,business_id:1,month:new Date().toISOString().slice(0,7),messages:200});
  const result=await f.service.schedule(1,5,scheduleInput);
  assert.equal(result.recipients,751);assert.equal(f.tables.campaign_recipients.length,751);
  assert.equal(f.tables.node_jobs.length,751);
  assert.equal(new Set(f.tables.node_jobs.map(j=>JSON.parse(j.payload).recipientId)).size,751);
  assert.equal((await f.realProvider.messageAllowance(1)).remaining,49);
});

test('business plan can schedule its entire 5000-message allowance', async () => {
  const f=fixture(); f.tables.customers=customers(5000);
  f.realProvider.limits=async()=>({plan:'business',messages:5000});
  const result=await f.service.schedule(1,5,scheduleInput);
  assert.equal(result.recipients,5000);assert.equal(f.tables.node_jobs.length,5000);
  assert.equal((await f.realProvider.messageAllowance(1)).remaining,0);
});

test('an audience exceeding the plan is rejected without creating a partial campaign', async () => {
  const f=fixture(); f.tables.customers=customers(1001);
  await assert.rejects(f.service.schedule(1,5,scheduleInput),/1001 recipients.*1000 messages/);
  assert.equal(f.tables.campaign_runs.length,0);assert.equal(f.tables.campaign_recipients.length,0);assert.equal(f.tables.node_jobs.length,0);
});

test('pending campaigns prevent overbooking and cancellation releases their unused allowance', async () => {
  const f=fixture(); f.tables.customers=customers(600);f.tables.campaigns.push({id:6,business_id:1,audience:'VIP'});
  await f.service.schedule(1,5,scheduleInput);
  await assert.rejects(f.service.schedule(1,6,scheduleInput),/400 messages/);
  assert.equal(f.tables.campaign_runs.length,1);
  await f.service.cancel(1,5);
  assert.equal((await f.realProvider.messageAllowance(1)).reserved,0);
  assert.equal((await f.service.schedule(1,6,scheduleInput)).recipients,600);
});

test('inbox messages cannot spend campaign holds; processing converts exactly one hold into usage', async () => {
  const f=fixture();f.tables.customers=customers(1000);await f.service.schedule(1,5,scheduleInput);
  await assert.rejects(f.realProvider.reserve(1,'messages'),/reserved by scheduled campaigns/);
  f.providers.reserve=f.realProvider.reserve.bind(f.realProvider);
  await f.service.process(1);await f.service.process(1);
  const allowance=await f.realProvider.messageAllowance(1);
  assert.equal(allowance.used,1);assert.equal(allowance.reserved,999);assert.equal(allowance.remaining,0);
  assert.equal(f.tables.messages.length,1);
  await assert.rejects(f.realProvider.reserve(1,'messages'),/reserved by scheduled campaigns/);
});

test('withdrawn consent releases a pending hold without consuming message usage', async () => {
  const f=fixture();f.tables.customers=customers(1000);await f.service.schedule(1,5,scheduleInput);
  f.tables.customers[0].opted_in=false;await f.service.process(1);
  const allowance=await f.realProvider.messageAllowance(1);
  assert.equal(allowance.reserved,999);assert.equal(allowance.used,0);assert.equal(allowance.remaining,1);
  await f.realProvider.reserve(1,'messages');
  assert.equal((await f.realProvider.messageAllowance(1)).remaining,0);
});

test('month-scoped holds include overdue work without charging a future month early', async () => {
  const f=fixture(),now=new Date();
  const last=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));
  const current=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  const next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
  f.tables.campaign_runs.push({id:1,business_id:1,status:'scheduled',scheduled_at:last},{id:2,business_id:1,status:'scheduled',scheduled_at:current},{id:3,business_id:1,status:'scheduled',scheduled_at:next},{id:4,business_id:1,status:'cancelled',scheduled_at:current},{id:5,business_id:2,status:'scheduled',scheduled_at:current});
  f.tables.campaign_recipients.push(...f.tables.campaign_runs.map((r,index)=>({id:index+1,business_id:r.business_id,run_id:r.id,status:'pending'})));
  f.tables.usage_months.push({id:1,business_id:1,month:current.toISOString().slice(0,7),messages:10},{id:2,business_id:1,month:next.toISOString().slice(0,7),messages:2});
  const thisMonth=await f.realProvider.messageAllowance(1),nextMonth=await f.realProvider.messageAllowance(1,f.db,next);
  assert.equal(thisMonth.reserved,2);assert.equal(thisMonth.used,10);assert.equal(thisMonth.remaining,988);
  assert.equal(nextMonth.reserved,1);assert.equal(nextMonth.used,2);assert.equal(nextMonth.remaining,997);
});

test('dispatch rechecks the current plan after a downgrade or expiry', async () => {
  const f=fixture();await f.service.schedule(1,5,scheduleInput);
  f.providers.reserve=f.realProvider.reserve.bind(f.realProvider);
  f.realProvider.limits=async()=>({plan:'inactive',messages:0,ai_requests:0,tokens:0});
  await assert.rejects(f.service.process(1),/subscription or monthly usage limit/);
  assert.equal(f.tables.messages.length,0);assert.equal(f.tables.campaign_recipients[0].status,'pending');
});
