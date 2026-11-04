import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { consentFields, hasConsentEvidence } from './contact-import';

const text = (max: number) => z.string().trim().min(1).max(max);
export const stores: Record<string, z.ZodTypeAny> = {
  customers: z.object({ name: text(100), phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/), email: z.string().email().max(255).nullish().or(z.literal('')).transform(v => v || null), tag: text(30), ...consentFields }).refine(hasConsentEvidence, { message: 'Record how and when the customer agreed to WhatsApp marketing.', path: ['consent_source'] }),
  products: z.object({ name: text(120), sku: text(60), category: text(60), price_paise: z.number().int().min(0).max(100000000), stock: z.number().int().min(0).max(1000000) }),
  automations: z.object({ name: text(100), keyword: text(60), response: text(4000) }),
  knowledge: z.object({ title: text(150), content: text(10000) }),
  campaigns: z.object({ name: text(100), audience: z.enum(['All opted-in customers', 'VIP', 'New']), body: text(4000) }),
};
export const updates: Record<string, z.ZodTypeAny> = {
  conversations: z.object({ status: z.enum(['open', 'resolved']).optional(), mode: z.enum(['ai', 'human']).optional(), assignee: z.string().max(100).nullish(), unread: z.literal(0).optional() }),
  automations: z.object({ active: z.boolean() }),
  customers: z.object({ status: z.enum(['New lead', 'Customer', 'VIP']).optional(), tag: text(30).optional(), opted_in: z.boolean().optional(), consent_source: consentFields.consent_source }).refine(hasConsentEvidence, { message: 'Record how and when the customer agreed to WhatsApp marketing.', path: ['consent_source'] }),
  businesses: z.object({ name: text(100), industry: text(100), email: z.string().email().max(255).nullish().or(z.literal('')).transform(v => v || null) }),
};
export function schemaFor(schemas: Record<string, z.ZodTypeAny>, resource: string) {
  if (!Object.hasOwn(schemas, resource)) throw new NotFoundException();
  return schemas[resource];
}
