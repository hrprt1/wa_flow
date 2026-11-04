import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContactsCsv } from '../src/workspace/contact-import';
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
  assert.throws(() => parseContactsCsv('x'.repeat(200_001)), /200 KB/);
  assert.throws(() => parseContactsCsv('name,phone\n' + Array.from({ length: 101 }, (_, i) => `A,+91987654${String(i).padStart(4, '0')}`).join('\n')), /100/);
});

test('create and update require consent evidence for explicit opt-in', () => {
  const customer = { name: 'Priya', phone: '+919876543210', tag: 'New' };
  assert.equal(validate(stores.customers, customer).opted_in, false);
  assert.throws(() => validate(stores.customers, { ...customer, opted_in: true }));
  assert.throws(() => validate(updates.customers, { opted_in: true, consent_source: ' ' }));
  assert.equal(validate(updates.customers, { opted_in: false }).opted_in, false);
  assert.equal(validate(updates.customers, { opted_in: true, consent_source: 'Checkout form on 2026-11-04' }).opted_in, true);
});

test('import validation and missing consent fail before opening a transaction', async () => {
  const service = new WorkspaceService({ db: { transaction() { throw new Error('Unexpected database access'); } } } as any, {} as any);
  await assert.rejects(service.importCustomers(1, { csv: 'name,phone\nA,invalid' }), /Contact row/);
  await assert.rejects(service.importCustomers(1, { csv: 'name,phone,opted_in\nA,+919876543210,true' }), /agreed/);
});

test('import scopes all reads/writes, skips existing numbers and never changes their consent', async () => {
  const inserts: { table: string; value: any }[] = [];
  const trx: any = (table: string) => {
    const query: any = {
      where(filter: any) { assert.equal(filter.business_id ?? filter.id, 7); return query; },
      whereIn() { return query; }, forUpdate() { return query; },
      async first() { return table === 'businesses' ? { id: 7 } : { count: 1 }; },
      async select() { return [{ phone: '+919876543210' }]; },
      count() { return query; },
      async insert(value: any) { inserts.push({ table, value }); return [12]; },
    };
    return query;
  };
  const service = new WorkspaceService({ db: { transaction: (fn: any) => fn(trx) } } as any, {} as any);
  const result = await service.importCustomers(7, { csv: 'name,phone,opted_in\nExisting,+919876543210,true\nNew,+919876543211,false', consent_source: 'Checkout form' });
  assert.deepEqual(result.data, { imported: 1, skipped: 1 });
  assert.equal(inserts.filter(i => i.table === 'customers').length, 1);
  assert.equal(inserts[0].value.phone, '+919876543211');
  assert.equal(inserts[0].value.opted_in, false);
  assert.ok(inserts.every(i => i.value.business_id === 7));
  assert.equal(inserts.find(i => i.table === 'customer_consent_events')?.value.customer_id, 12);
});
