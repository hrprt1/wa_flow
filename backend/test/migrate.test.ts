import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/migrate';
import type { DatabaseService } from '../src/common/database.service';

function database(options: { missing?: string; failure?: string } = {}) {
  const runtime = new Set<string>();
  const created: string[] = [];
  const db = { schema: {
    async hasTable(name: string) {
      return ['node_sessions', 'node_jobs', 'customer_consent_events', 'campaign_runs', 'campaign_recipients'].includes(name) ? runtime.has(name) : name !== options.missing;
    },
    async createTable(name: string) {
      if (options.failure) throw Object.assign(new Error('DDL failed'), { code: options.failure });
      runtime.add(name); created.push(name);
    },
  } };
  return { service: { db } as unknown as DatabaseService, created };
}

test('repeated startup migration creates only missing runtime tables', async () => {
  const fixture = database();
  await migrate(fixture.service);
  await migrate(fixture.service);
  assert.deepEqual(fixture.created, ['node_sessions', 'node_jobs', 'customer_consent_events', 'campaign_runs', 'campaign_recipients']);
});

test('missing application schema blocks migration before creating tables', async () => {
  const fixture = database({ missing: 'users' });
  await assert.rejects(migrate(fixture.service), /Missing existing application table: users/);
  assert.deepEqual(fixture.created, []);
});

test('concurrent table creation is tolerated but other DDL errors stop migration', async () => {
  await assert.doesNotReject(migrate(database({ failure: 'ER_TABLE_EXISTS_ERROR' }).service));
  await assert.rejects(migrate(database({ failure: 'ER_TABLEACCESS_DENIED_ERROR' }).service), /DDL failed/);
});
