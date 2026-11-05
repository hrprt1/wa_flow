import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../common/database.service';
import { QueueService } from '../common/queue.service';
import { ProviderService } from '../providers/provider.service';
import { requireThat, Row } from '../providers/helpers';
import { validate } from '../auth/validation';

export const scheduleSchema = z.object({
  template_name: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-zA-Z_]{2,20}$/),
  scheduled_at: z.iso.datetime({ offset: true }).optional(),
  consent_confirmed: z.literal(true),
});
export const previewSchema = z.object({ scheduled_at: z.iso.datetime({ offset: true }).optional() });
const RECIPIENT_BATCH_SIZE = 250;

export function staticTemplates(templates: Row[]) {
  return templates.filter(t => t.status === 'APPROVED' && Array.isArray(t.components)
    && t.components.some((c: Row) => c.type === 'BODY' && typeof c.text === 'string' && c.text.length > 0)
    && t.components.every((c: Row) => ['BODY', 'HEADER', 'FOOTER'].includes(c.type)
      && (c.type !== 'HEADER' || c.format === 'TEXT') && !String(c.text || '').includes('{{')))
    .map(t => ({ name: t.name as string, language: t.language as string, body: ['HEADER', 'BODY', 'FOOTER'].map(type => t.components.find((c: Row) => c.type === type)?.text).filter(Boolean).join('\n\n') }));
}

@Injectable()
export class CampaignsService implements OnModuleInit {
  constructor(private readonly database: DatabaseService, private readonly providers: ProviderService, private readonly queue: QueueService) {}
  get db() { return this.database.db; }
  onModuleInit() {
    this.queue.setHandler('campaign-recipient', p => this.process(Number(p.recipientId)), async p => {
      await this.db('campaign_recipients').where({ id: Number(p.recipientId), status: 'pending' }).update({ status: 'failed', updated_at: new Date() });
    });
  }
  async campaign(businessId: number, id: number) {
    const campaign = await this.db('campaigns').where({ business_id: businessId, id }).first();
    requireThat(campaign, 'Campaign not found.', 404);
    return campaign;
  }
  audience(businessId: number, audience: string) {
    const query = this.db('customers').where({ business_id: businessId });
    if (audience !== 'All opted-in customers') query.where('tag', audience);
    return query;
  }
  async preview(businessId: number, id: number, body: unknown = {}) {
    const data = validate(previewSchema, body);
    const campaign = await this.campaign(businessId, id);
    const rows: Row[] = await this.audience(businessId, campaign.audience).select('opted_in').count({ count: '*' }).groupBy('opted_in');
    const eligible = rows.filter(c => !!Number(c.opted_in)).reduce((sum, c) => sum + Number(c.count), 0);
    const total = rows.reduce((sum, c) => sum + Number(c.count), 0);
    return { eligible, excluded: total - eligible, templates: staticTemplates(await this.providers.templates(businessId)), allowance: await this.providers.messageAllowance(businessId, this.db, data.scheduled_at ? new Date(data.scheduled_at) : new Date()) };
  }
  async schedule(businessId: number, id: number, body: unknown) {
    const data = validate(scheduleSchema, body);
    const scheduledAt = data.scheduled_at ? new Date(data.scheduled_at) : new Date();
    requireThat(scheduledAt.getTime() >= Date.now() - 60000 && scheduledAt.getTime() <= Date.now() + 90 * 86400000, 'Choose a time within the next 90 days.');
    await this.providers.permanent(businessId);
    const template = staticTemplates(await this.providers.templates(businessId)).find(t => t.name === data.template_name && t.language === data.language);
    requireThat(template, 'Choose an approved template without variables, media or buttons.');
    return this.db.transaction(async tx => {
      await tx('businesses').where({ id: businessId }).forUpdate().first();
      const campaign = await tx('campaigns').where({ business_id: businessId, id }).first();
      requireThat(campaign, 'Campaign not found.', 404);
      requireThat(!await tx('campaign_runs').where({ business_id: businessId, campaign_id: id }).first(), 'This draft has already been scheduled. Create a new draft for another campaign.', 409);
      const query = tx('customers').where({ business_id: businessId, opted_in: true });
      if (campaign.audience !== 'All opted-in customers') query.where('tag', campaign.audience);
      const count = await query.clone().count({ count: '*' }).first();
      const recipients = Number(count?.count || 0);
      requireThat(recipients > 0, 'Choose an audience with opted-in contacts.');
      const allowance = await this.providers.messageAllowance(businessId, tx, scheduledAt);
      requireThat(recipients <= allowance.remaining, `This audience has ${recipients} recipients, but your ${allowance.plan} plan has ${allowance.remaining} messages available for ${allowance.period}. Reduce the audience or upgrade your plan.`);
      const now = new Date();
      const [runId] = await tx('campaign_runs').insert({ business_id: businessId, campaign_id: id, template_name: template.name, language: template.language, template_body: template.body, scheduled_at: scheduledAt, status: 'scheduled', created_at: now, updated_at: now });
      let after = 0, offset = 0;
      while (true) {
        const customers = await query.clone().where('id', '>', after).orderBy('id').limit(RECIPIENT_BATCH_SIZE).select('id');
        if (!customers.length) break;
        await tx('campaign_recipients').insert(customers.map(customer => ({ business_id: businessId, run_id: runId, customer_id: customer.id, status: 'pending', created_at: now, updated_at: now })));
        const batch = await tx('campaign_recipients').where({ business_id: businessId, run_id: runId }).whereIn('customer_id', customers.map(c => c.id)).orderBy('customer_id').select('id');
        await tx('node_jobs').insert(batch.map((recipient, index) => ({ kind: 'campaign-recipient', payload: JSON.stringify({ recipientId: Number(recipient.id) }), available_at: new Date(scheduledAt.getTime() + (offset + index) * 1000), status: 'pending', attempts: 0, created_at: now })));
        offset += customers.length;
        after = Number(customers[customers.length - 1].id);
      }
      return { id: Number(runId), status: 'scheduled', recipients };
    });
  }
  async status(businessId: number, id: number) {
    await this.campaign(businessId, id);
    const run = await this.db('campaign_runs').where({ business_id: businessId, campaign_id: id }).select('id', 'status', 'scheduled_at', 'template_name', 'language').first();
    if (!run) return { run: null, counts: {} };
    const rows: Row[] = await this.db('campaign_recipients as r').leftJoin('messages as m', function () { this.on('m.id', '=', 'r.message_id').andOn('m.business_id', '=', 'r.business_id'); }).where({ 'r.business_id': businessId, 'r.run_id': run.id }).select(this.db.raw('COALESCE(m.status, r.status) as status')).count({ count: '*' }).groupByRaw('COALESCE(m.status, r.status)');
    const counts: Record<string, number> = {};
    for (const row of rows) counts[String(row.status)] = Number(row.count);
    if (run.status !== 'cancelled' && !['pending', 'queued', 'sending'].some(status => counts[status] > 0)) run.status = 'complete';
    return { run, counts };
  }
  async cancel(businessId: number, id: number) {
    await this.campaign(businessId, id);
    await this.db.transaction(async tx => {
      await tx('businesses').where({ id: businessId }).forUpdate().first();
      const run = await tx('campaign_runs').where({ business_id: businessId, campaign_id: id }).forUpdate().first();
      requireThat(run, 'No scheduled campaign found.', 404);
      await tx('campaign_runs').where({ id: run.id }).update({ status: 'cancelled', updated_at: new Date() });
      await tx('campaign_recipients').where({ business_id: businessId, run_id: run.id, status: 'pending' }).update({ status: 'cancelled', updated_at: new Date() });
      const messages = tx('campaign_recipients').where({ business_id: businessId, run_id: run.id }).whereNotNull('message_id').select('message_id');
      await tx('messages').where({ business_id: businessId, status: 'queued' }).whereIn('id', messages).update({ status: 'cancelled', updated_at: new Date() });
    });
    return { cancelled: true };
  }
  async process(recipientId: number) {
    const recipient = await this.db('campaign_recipients').where({ id: recipientId }).first();
    if (!recipient || recipient.status !== 'pending') return;
    const run = await this.db('campaign_runs').where({ id: recipient.run_id, business_id: recipient.business_id }).first();
    if (!run || run.status === 'cancelled') return;
    // Refresh approval at execution, rather than trusting a possibly old schedule.
    const template = staticTemplates(await this.providers.templates(recipient.business_id)).find(t => t.name === run.template_name && t.language === run.language && t.body === run.template_body);
    await this.db.transaction(async tx => {
      await tx('businesses').where({ id: recipient.business_id }).forUpdate().first();
      const current = await tx('campaign_recipients').where({ id: recipientId }).forUpdate().first();
      const currentRun = await tx('campaign_runs').where({ id: run.id }).first();
      if (current.status !== 'pending' || currentRun.status === 'cancelled') return null;
      const customer = await tx('customers').where({ id: current.customer_id, business_id: current.business_id }).first();
      if (!template || !customer || !Number(customer.opted_in)) {
        await tx('campaign_recipients').where({ id: recipientId }).update({ status: 'skipped', updated_at: new Date() });
        return null;
      }
      let conversation = await tx('conversations').where({ business_id: current.business_id, customer_id: current.customer_id }).first();
      if (!conversation) {
        const [id] = await tx('conversations').insert({ business_id: current.business_id, customer_id: current.customer_id, mode: 'human', created_at: new Date(), updated_at: new Date() });
        conversation = { id };
      }
      await this.providers.reserve(current.business_id, 'messages', 0, tx, recipientId);
      const [messageId] = await tx('messages').insert({ business_id: current.business_id, conversation_id: conversation.id, body: template.body, template_payload: JSON.stringify({ name: template.name, language: { code: template.language } }), direction: 'outbound', status: 'queued', client_key: `campaign:${run.id}:${current.customer_id}`, created_at: new Date(), updated_at: new Date() });
      await tx('campaign_recipients').where({ id: recipientId }).update({ message_id: messageId, status: 'queued', updated_at: new Date() });
      await tx('campaign_runs').where({ id: run.id }).update({ status: 'processing', updated_at: new Date() });
      // Outbox insertion shares the message transaction, so a worker crash cannot lose dispatch.
      await tx('node_jobs').insert({ kind: 'send-whatsapp', payload: JSON.stringify({ messageId: Number(messageId) }), available_at: new Date(), status: 'pending', attempts: 0, created_at: new Date() });
    });
  }
}
