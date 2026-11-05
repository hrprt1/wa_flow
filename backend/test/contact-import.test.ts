import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CONTACT_IMPORT_BYTES, MAX_CONTACT_IMPORT_ROWS, parseContactsCsv } from '../src/workspace/contact-import';
import { stores, updates } from '../src/workspace/schemas';
import { validate } from '../src/auth/validation';
import { WorkspaceService } from '../src/workspace/workspace.service';

test('CSV supports BOM, quoted commas, escaped quotes, CRLF, and explicit consent', () => {
  const result = parseContactsCsv('\uFEFFname,phone,email,tag,opted_in\r\n"Priya, ""Store""",+919876543210,,VIP,true\r\n');
  assert.deepEqual(result, [{ name: 'Priya, "Store"', phone: '+919876543210', email: null, tag: 'VIP', opted_in: true }]);
  assert.equal(parseContactsCsv('name,phone\nA,+919876543210')[0].opted_in, false);
});

test('CSV rejects malformed records, unknown headers and duplicate phones', () => {
  for (const csv of [
    'name,phone\nA,9876543210',
    'name,phone,opted_in\nA,+919876543210,yes',
    'name,phone\nA,+919876543210\nB,+919876543210',
    'name,name,phone\nA,B,+919876543210',
    'name,phone,role\nA,+919876543210,admin',
    'name,phone\n"A,+919876543210',
    'name,phone\n"A"oops,+919876543210',
    'name,phone\nA,+919876543210,extra',
  ]) assert.throws(() => parseContactsCsv(csv));
});

test('CSV bounds bytes and row count before database access', () => {
  assert.throws(() => parseContactsCsv('x'.repeat(MAX_CONTACT_IMPORT_BYTES + 1)), /5 MB/);
  assert.throws(() => parseContactsCsv('name,phone\n' + Array.from({ length: MAX_CONTACT_IMPORT_ROWS + 1 }, (_, i) => `A,+91987654${String(i).padStart(4, '0')}`).join('\n')), /10,000/);
});

test('create and update require consent evidence for explicit opt-in', () => {
  const customer = { name: 'Priya', phone: '+919876543210', tag: 'New' };
  assert.equal((validate(stores.customers, customer) as { opted_in: boolean }).opted_in, false);
  assert.throws(() => validate(stores.customers, { ...customer, opted_in: true }));
  assert.throws(() => validate(updates.customers, { opted_in: true, consent_source: ' ' }));
  assert.equal((validate(updates.customers, { opted_in: false }) as { opted_in: boolean }).opted_in, false);
  assert.equal((validate(updates.customers, { opted_in: true, consent_source: 'Checkout form on 2026-11-04' }) as { opted_in: boolean }).opted_in, true);
});

test('import validation and missing consent fail before opening a transaction', async () => {
  const service = new WorkspaceService({ db: { transaction() { throw new Error('Unexpected database access'); } } } as any, {} as any);
  await assert.rejects(service.importCustomers(1, { csv: 'name,phone\nA,invalid' }), /Contact row/);
  await assert.rejects(service.importCustomers(1, { csv: 'name,phone,opted_in\nA,+919876543210,true' }), /agreed/);
});

function contactFixture() {
  const tables: Record<string, any[]> = {
    businesses: [{ id: 7 }], customers: [{ id: 1, business_id: 7, name: 'Existing', phone: '+919876543210', opted_in: false }],
    conversations: [], customer_consent_events: [],
  };
  const writes: { table: string; values: any[] }[] = [];
  const reads: { table: string; filter: any; phones?: string[] }[] = [];
  let nextId = 20;
  const db: any = (table: string) => {
    const filter: Record<string, any> = {};
    let phones: string[] | undefined;
    let upperId = Infinity, limit = Infinity, descending = false;
    const extra: ((row: any) => boolean)[] = [];
    const rows = () => tables[table].filter(row => Object.entries(filter).every(([key, value]) => row[key] === value) && (!phones || phones.includes(row.phone)) && row.id < upperId && extra.every(fn => fn(row)))
      .sort((a,b) => descending ? b.id - a.id : a.id - b.id).slice(0, limit);
    const query: any = {
      where(condition: any, operator?: any, value?: any) {
        if (typeof condition === 'string') { assert.equal(condition, 'id'); assert.equal(operator, '<'); upperId = value; }
        else Object.assign(filter, condition);
        return query;
      },
      andWhere(callback: any) {
        const terms: any[] = [];
        const search: any = { whereRaw(_sql: string, bindings: any[]) { terms.push(bindings); return search; }, orWhereRaw(_sql: string, bindings: any[]) { terms.push(bindings); return search; } };
        callback.call(search);
        extra.push(row => terms.some(([value, key]) => String(row[key] || '').toLowerCase().includes(value.toLowerCase())));
        return query;
      },
      clone() {
        const clone = db(table); clone.where(filter);
        if (phones) clone.whereIn('phone', phones);
        for (const fn of extra) clone.addFilter(fn);
        return clone;
      },
      addFilter(fn: (row: any) => boolean) { extra.push(fn); return query; },
      whereIn(key: string, values: string[]) { assert.equal(key, 'phone'); assert.ok(values.length <= 500); phones = values; return query; },
      forUpdate() { return query; },
      orderBy(key: string, direction: string) { assert.equal(key, 'id'); descending = direction === 'desc'; return query; },
      limit(value: number) { limit = value; return query; },
      count() { return { first: async () => ({ count: rows().length }) }; },
      async first() { return rows()[0]; },
      select() { reads.push({ table, filter, phones }); return query; },
      async insert(value: any) {
        const values = Array.isArray(value) ? value : [value];
        writes.push({ table, values });
        const ids = values.map(row => { nextId += 7; tables[table].push({ id: nextId, ...row }); return nextId; });
        return ids;
      },
      then(resolve: any, reject: any) { return Promise.resolve(rows()).then(resolve, reject); },
    };
    return query;
  };
  db.transaction = async (callback: any) => callback(db);
  return { tables, writes, reads, service: new WorkspaceService({ db } as any, {} as any) };
}

test('import scopes all reads/writes, skips existing numbers and never changes their consent', async () => {
  const fixture = contactFixture();
  const result = await fixture.service.importCustomers(7, { csv: 'name,phone,opted_in\nExisting,+919876543210,true\nNew,+919876543211,false', consent_source: 'Checkout form' });
  assert.deepEqual(result.data, { imported: 1, skipped: 1 });
  assert.equal(fixture.tables.customers.length, 2);
  assert.equal(fixture.tables.customers[0].opted_in, false);
  assert.equal(fixture.tables.customers[1].phone, '+919876543211');
  assert.ok(fixture.writes.every(write => write.values.every(value => value.business_id === 7)));
  assert.ok(fixture.reads.every(read => read.filter.business_id === 7));
  assert.equal(fixture.tables.customer_consent_events[0].customer_id, fixture.tables.customers[1].id);
});

test('CSV and bulk import accept more than 100 contacts and resolve non-consecutive database IDs', async () => {
  const fixture = contactFixture();
  const csv = 'name,phone,opted_in\n' + Array.from({ length: 1201 }, (_, i) => `Contact ${i},+9188${String(i).padStart(8, '0')},false`).join('\n');
  assert.equal(parseContactsCsv(csv).length, 1201);
  const result = await fixture.service.importCustomers(7, { csv });
  assert.deepEqual(result.data, { imported: 1201, skipped: 0 });
  assert.equal(fixture.tables.customers.length, 1202);
  assert.equal(fixture.tables.conversations.length, 1201);
  assert.equal(fixture.tables.customer_consent_events.length, 1201);
  assert.equal(fixture.writes.filter(write => write.table === 'customers').length, 3);
  assert.ok(fixture.writes.every(write => write.values.length <= 500));
  const customerIds = new Set(fixture.tables.customers.slice(1).map(row => row.id));
  assert.ok(fixture.tables.conversations.every(row => customerIds.has(row.customer_id)));
  assert.ok(fixture.tables.customer_consent_events.every(row => customerIds.has(row.customer_id)));
});

test('manual customer creation has no total-contact cap', async () => {
  const fixture = contactFixture();
  fixture.tables.customers.push(...Array.from({ length: 200 }, (_, i) => ({ id: i + 2, business_id: 7 })));
  await fixture.service.store(7, 'customers', { name: 'Beyond 100', phone: '+919876543211', tag: 'New' });
  assert.equal(fixture.tables.customers.length, 202);
});

test('customer pagination scopes tenants, searches literally and returns complete counts beyond the first page', async () => {
  const fixture = contactFixture();
  fixture.tables.customers.push(...Array.from({ length: 130 }, (_, i) => ({ id: i + 2, business_id: 7, name: `Contact ${i}`, phone: '+919876543211', tag: i === 10 ? '100%_VIP' : 'New' })));
  fixture.tables.customers.push({ id: 999, business_id: 8, name: 'Other business' });
  const first = (await fixture.service.customers(7, { limit: '100' })).data;
  assert.equal(first.total, 131); assert.equal(first.items.length, 100); assert.equal(first.items[0].id, 131); assert.equal(first.next_cursor, 32);
  const second = (await fixture.service.customers(7, { limit: '100', cursor: String(first.next_cursor) })).data;
  assert.equal(second.total, 131); assert.equal(second.items.length, 31); assert.equal(second.items[0].id, 31); assert.equal(second.next_cursor, null);
  const search = (await fixture.service.customers(7, { q: '%_' })).data;
  assert.equal(search.total, 1); assert.equal(search.items[0].tag, '100%_VIP');
  assert.ok([...first.items, ...second.items].every(row => row.business_id === 7));
});

test('pagination rejects invalid input before database access', async () => {
  const service = new WorkspaceService({ db() { throw new Error('Unexpected database access'); } } as any, {} as any);
  for (const query of [{ cursor: '-1' }, { cursor: 'not-an-id' }, { limit: '101' }, { limit: '0' }, { q: 'x'.repeat(101) }])
    await assert.rejects(service.customers(7, query), /invalid/);
  await assert.rejects(service.snapshot(7, '-1'), /invalid/);
});

test('contact conversation lookup scopes both customer and conversation to the tenant', async () => {
  let filter: unknown;
  const query: any = { join() { return query; }, where(value: any) { filter = value; return query; }, select() { return query; }, orderBy() { return query; }, async first() { return undefined; } };
  const service = new WorkspaceService({ db: () => query } as any, {} as any);
  await assert.rejects(service.customerConversation(7, 99), /Not Found/);
  assert.deepEqual(filter, { 'conversations.business_id': 7, 'customers.business_id': 7, 'customers.id': 99 });
});

function snapshotFixture() {
  const now = new Date().toISOString();
  const tables: Record<string, any[]> = {
    businesses: [{ id: 7 }], customers: [{ id: 1, business_id: 7, name: 'Own customer' }, { id: 2, business_id: 8, name: 'Foreign customer' }],
    conversations: [...Array.from({ length: 102 }, (_, index) => ({ id: index + 1, business_id: 7, customer_id: 1, updated_at: index + 1 })), { id: 999, business_id: 8, customer_id: 2, updated_at: 999 }],
    messages: [...Array.from({ length: 700 }, (_, index) => ({ id: index + 1, business_id: 7, conversation_id: index < 120 ? 1 : 102, created_at: now, direction: 'inbound' })), { id: 999, business_id: 8, conversation_id: 999, created_at: now }],
    products: [], automations: [], knowledge: [], campaigns: [],
  };
  const db: any = (table: string) => {
    const filters: ((row: any) => boolean)[] = [];
    let sortKey = 'id', descending = false, limit = Infinity, counting = false;
    const get = (row: any, key: string) => key.startsWith('customers.') && table === 'conversations'
      ? tables.customers.find(customer => customer.id === row.customer_id)?.[key.split('.')[1]]
      : row[key.split('.').at(-1)!];
    const rows = () => tables[table].filter(row => filters.every(predicate => predicate(row)))
      .sort((a,b) => (get(a, sortKey) < get(b, sortKey) ? -1 : get(a, sortKey) > get(b, sortKey) ? 1 : 0) * (descending ? -1 : 1)).slice(0, limit);
    const query: any = {
      where(condition: any, operator?: any, value?: any) {
        if (typeof condition === 'object') filters.push(row => Object.entries(condition).every(([key, expected]) => get(row, key) === expected));
        else if (arguments.length === 2) filters.push(row => get(row, condition) === operator);
        else filters.push(row => operator === '>=' ? get(row, condition) >= value.toISOString() : get(row, condition) === value);
        return query;
      },
      whereNot(key: string, value: unknown) { filters.push(row => get(row, key) !== value); return query; },
      join() { return query; }, select() { return query; }, groupByRaw() { return query; },
      orderBy(key: string, direction: string) { sortKey = key; descending = direction === 'desc'; return query; },
      limit(value: number) { limit = value; return query; }, count() { counting = true; return query; },
      clone() {
        const clone = db(table); clone.copyFilters(filters); clone.orderBy(sortKey, descending ? 'desc' : 'asc'); return clone;
      },
      copyFilters(values: ((row: any) => boolean)[]) { filters.push(...values); return query; },
      async first() { return counting ? { count: rows().length } : rows()[0]; },
      then(resolve: any, reject: any) { return Promise.resolve(counting ? [] : rows()).then(resolve, reject); },
    };
    return query;
  };
  db.raw = () => 'day';
  return new WorkspaceService({ db } as any, { snapshot: async () => ({}) } as any);
}

test('workspace can include an older selected conversation and its bounded message history without duplicates', async () => {
  const service = snapshotFixture();
  const selected = await service.snapshot(7, '1');
  assert.equal(selected.conversations.length, 101);
  assert.equal(selected.conversations[0].id, 1);
  assert.equal(selected.messages.length, 600);
  assert.equal(selected.messages[0].id, 21);
  assert.equal(selected.messages.at(-1).id, 700);
  assert.ok(selected.messages.every((message: any) => message.business_id === 7));
  const recent = await service.snapshot(7, '102');
  assert.equal(recent.conversations.length, 100);
  assert.equal(recent.messages.length, 500);
  await assert.rejects(service.snapshot(7, '999'), /Not Found/);
});
