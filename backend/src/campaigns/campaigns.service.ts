import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../common/database.service';
import { QueueService } from '../common/queue.service';
import { ProviderService } from '../providers/provider.service';
import { month, requireThat, Row } from '../providers/helpers';
import { validate } from '../auth/validation';

export const scheduleSchema = z.object({
  template_name: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-zA-Z_]{2,20}$/),
  scheduled_at: z.iso.datetime({ offset: true }).optional(),
  consent_confirmed: z.literal(true),
});

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
  async preview(businessId: number, id: number) {
    const campaign = await this.campaign(businessId, id);
    const customers = await this.audience(businessId, campaign.audience).select('opted_in').limit(101);
    const eligible = customers.filter(c => !!Number(c.opted_in)).length;
    return { eligible, excluded: customers.length - eligible, templates: staticTemplates(await this.providers.templates(businessId)) };
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
      const customers = await query.orderBy('id').limit(101);
      requireThat(customers.length > 0 && customers.length <= 100, 'Choose an audience with 1 to 100 opted-in contacts.');
      const limits = await this.providers.limits(businessId, tx);
      const usage = await tx('usage_months').where({ business_id: businessId, month: month() }).first();
      requireThat(customers.length <= Number(limits.messages) - Number(usage?.messages || 0), 'Your remaining monthly message allowance is too small for this audience.');
      const now = new Date();
      const [runId] = await tx('campaign_runs').insert({ business_id: businessId, campaign_id: id, template_name: template.name, language: template.language, template_body: template.body, scheduled_at: scheduledAt, status: 'scheduled', created_at: now, updated_at: now });
      for (const [index, customer] of customers.entries()) {
        const [recipientId] = await tx('campaign_recipients').insert({ business_id: businessId, run_id: runId, customer_id: customer.id, status: 'pending', created_at: now, updated_at: now });
        await tx('node_jobs').insert({ kind: 'campaign-recipient', payload: JSON.stringify({ recipientId }), available_at: new Date(scheduledAt.getTime() + index * 1000), status: 'pending', attempts: 0, created_at: now });
      }
      return { id: Number(runId), status: 'scheduled', recipients: customers.length };
    });
  }
  async status(businessId: number, id: number) {
    await this.campaign(businessId, id);
    const run = await this.db('campaign_runs').where({ business_id: businessId, campaign_id: id }).select('id', 'status', 'scheduled_at', 'template_name', 'language').first();
    if (!run) return { run: null, counts: {} };
    const rows = await this.db('campaign_recipients as r').leftJoin('messages as m', function () { this.on('m.id', '=', 'r.message_id').andOn('m.business_id', '=', 'r.business_id'); }).where({ 'r.business_id': businessId, 'r.run_id': run.id }).select('r.status', 'm.status as message_status');
    const counts: Record<string, number> = {};
    for (const row of rows) { const status = row.message_status || row.status; counts[status] = (counts[status] || 0) + 1; }
    if (run.status !== 'cancelled' && !rows.some(r => ['pending', 'queued', 'sending'].includes(r.message_status || r.status))) run.status = 'complete';
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
      const messages = await tx('campaign_recipients').where({ business_id: businessId, run_id: run.id }).whereNotNull('message_id').select('message_id');
      if (messages.length) await tx('messages').where({ business_id: businessId, status: 'queued' }).whereIn('id', messages.map(m => m.message_id)).update({ status: 'cancelled', updated_at: new Date() });
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
      await this.providers.reserve(current.business_id, 'messages', 0, tx);
      const [messageId] = await tx('messages').insert({ business_id: current.business_id, conversation_id: conversation.id, body: template.body, template_payload: JSON.stringify({ name: template.name, language: { code: template.language } }), direction: 'outbound', status: 'queued', client_key: `campaign:${run.id}:${current.customer_id}`, created_at: new Date(), updated_at: new Date() });
      await tx('campaign_recipients').where({ id: recipientId }).update({ message_id: messageId, status: 'queued', updated_at: new Date() });
      await tx('campaign_runs').where({ id: run.id }).update({ status: 'processing', updated_at: new Date() });
      // Outbox insertion shares the message transaction, so a worker crash cannot lose dispatch.
      await tx('node_jobs').insert({ kind: 'send-whatsapp', payload: JSON.stringify({ messageId: Number(messageId) }), available_at: new Date(), status: 'pending', attempts: 0, created_at: new Date() });
    });
  }
}
