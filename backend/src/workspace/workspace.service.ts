import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../common/database.service";
import { ProviderService } from "../providers/provider.service";
import { validate } from "../auth/validation";
import { schemaFor, stores, updates } from "./schemas";
import { MAX_CONTACT_IMPORT_BYTES, parseContactsCsv } from './contact-import';

const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const contactPageSchema = z.object({ cursor: positiveId.optional(), limit: positiveId.max(100).default(50), q: z.string().trim().max(100).default('') });
const CONTACT_BATCH_SIZE = 500;

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly providers: ProviderService,
  ) {}
  async snapshot(businessId: number, conversationId?: unknown) {
    const requestedConversation = validate(positiveId.optional(), conversationId);
    const db = this.database.db;
    const result: any = {
      business: await db("businesses").where({ id: businessId }).first(),
      integrations: await this.providers.snapshot(businessId),
    };
    for (const table of [
      "customers",
      "products",
      "automations",
      "knowledge",
      "campaigns",
    ])
      result[table] = await db(table)
        .where({ business_id: businessId })
        .orderBy("id", "desc")
        .limit(100);
    const conversations = db("conversations")
      .join("customers", "customers.id", "conversations.customer_id")
      .where("conversations.business_id", businessId)
      .where("customers.business_id", businessId)
      .select(
        "conversations.*",
        "customers.name",
        "customers.phone",
        "customers.tag",
      )
      .orderBy("conversations.updated_at", "desc");
    result.conversations = await conversations.clone().limit(100);
    if (requestedConversation) {
      const conversation = await conversations.clone().where('conversations.id', requestedConversation).first();
      if (!conversation) throw new NotFoundException();
      if (!result.conversations.some((item: { id: number }) => Number(item.id) === requestedConversation)) result.conversations.unshift(conversation);
    }
    result.messages = (
      await db("messages")
        .where({ business_id: businessId })
        .orderBy("id", "desc")
        .limit(500)
    ).reverse();
    if (requestedConversation) {
      const selectedMessages = await db('messages').where({ business_id: businessId, conversation_id: requestedConversation }).orderBy('id', 'desc').limit(100);
      result.messages = [...new Map([...result.messages, ...selectedMessages].map((message: { id: number }) => [Number(message.id), message])).values()]
        .sort((left, right) => Number(left.id) - Number(right.id));
    }
    const count = async (
      table: string,
      filter: Record<string, any> = {},
      messages = false,
    ) => {
      const query = db(table).where({ business_id: businessId, ...filter });
      if (messages) query.whereNot("direction", "note");
      const row = await query.count({ count: "*" }).first();
      return Number(row?.count ?? 0);
    };
    result.metrics = {
      customers: await count("customers"),
      messages: await count("messages", {}, true),
      open: await count("conversations", { status: "open" }),
      resolved: await count("conversations", { status: "resolved" }),
      automations: await count("automations", { active: true }),
    };
    const start = new Date();
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);
    result.activity = await db("messages")
      .where({ business_id: businessId })
      .whereNot("direction", "note")
      .where("created_at", ">=", start)
      .select(db.raw("DATE(created_at) as day"))
      .count({ count: "*" })
      .groupByRaw("DATE(created_at)")
      .orderBy("day");
    return result;
  }

  async customers(businessId: number, query: unknown) {
    const data = validate(contactPageSchema, query);
    const matching = this.database.db('customers').where({ business_id: businessId });
    if (data.q) matching.andWhere(function () {
      // LOCATE treats %, _ and backslashes as literal search text, not LIKE operators.
      this.whereRaw('LOCATE(?, ??) > 0', [data.q, 'name'])
        .orWhereRaw('LOCATE(?, ??) > 0', [data.q, 'phone'])
        .orWhereRaw('LOCATE(?, ??) > 0', [data.q, 'tag']);
    });
    const page = matching.clone();
    if (data.cursor) page.where('id', '<', data.cursor);
    const [count, rows] = await Promise.all([
      matching.clone().count({ count: '*' }).first(),
      page.select('id', 'name', 'phone', 'email', 'tag', 'status', 'opted_in').orderBy('id', 'desc').limit(data.limit + 1),
    ]);
    const items = rows.slice(0, data.limit);
    return { data: { items, next_cursor: rows.length > data.limit ? Number(items[items.length - 1].id) : null, total: Number(count?.count || 0) } };
  }

  async customerConversation(businessId: number, customerId: number) {
    const conversation = await this.database.db('conversations')
      .join('customers', 'customers.id', 'conversations.customer_id')
      .where({ 'conversations.business_id': businessId, 'customers.business_id': businessId, 'customers.id': customerId })
      .select('conversations.id').orderBy('conversations.id', 'desc').first();
    if (!conversation) throw new NotFoundException();
    return { data: { id: Number(conversation.id) } };
  }

  async store(businessId: number, resource: string, body: unknown) {
    const data = validate(schemaFor(stores, resource), body) as Record<
      string,
      unknown
    >;
    try {
      const id = await this.database.db.transaction(async (trx) => {
        await trx("businesses").where({ id: businessId }).forUpdate().first();
        const count = resource === 'customers' ? null : await trx(resource)
          .where({ business_id: businessId }).count({ count: "*" }).first();
        if (count && Number(count.count) >= 100)
          throw new UnprocessableEntityException(
            "The local workspace supports 100 records per section.",
          );
        const now = new Date();
        const { consent_source, ...record } = data;
        const [id] = await trx(resource).insert({
          ...record,
          business_id: businessId,
          created_at: now,
          updated_at: now,
        });
        if (resource === "customers") {
          await trx("conversations").insert({
            business_id: businessId,
            customer_id: id,
            created_at: now,
            updated_at: now,
          });
          await trx('customer_consent_events').insert({ business_id: businessId, customer_id: id, opted_in: !!data.opted_in, source: consent_source || 'No marketing consent provided', created_at: now });
        }
        return id;
      });
      return { data: { id } };
    } catch (error: any) {
      if (error.code === "ER_DUP_ENTRY")
        throw new UnprocessableEntityException(
          "A record with that phone or SKU already exists.",
        );
      throw error;
    }
  }

  async update(
    businessId: number,
    resource: string,
    id: number,
    body: unknown,
  ) {
    const data = validate(schemaFor(updates, resource), body) as Record<
      string,
      unknown
    >;
    if (resource === 'customers') {
      await this.database.db.transaction(async trx => {
        await trx('businesses').where({ id: businessId }).forUpdate().first();
        const customer = await trx('customers').where({ id, business_id: businessId }).forUpdate().first();
        if (!customer) throw new NotFoundException();
        const { consent_source, ...record } = data;
        const now = new Date();
        await trx('customers').where({ id, business_id: businessId }).update({ ...record, updated_at: now });
        if (typeof data.opted_in === 'boolean')
          await trx('customer_consent_events').insert({ business_id: businessId, customer_id: id, opted_in: data.opted_in, source: consent_source || 'Opted out by workspace operator', created_at: now });
      });
      return { data: { saved: true } };
    }
    const query = this.database
      .db(resource)
      .where({
        id,
        ...(resource === "businesses" ? {} : { business_id: businessId }),
      });
    if (resource === "businesses") query.where({ id: businessId });
    if (!(await query.clone().first())) throw new NotFoundException();
    await query.update({ ...data, updated_at: new Date() });
    return { data: { saved: true } };
  }

  async importCustomers(businessId: number, body: unknown) {
    const data = validate(z.object({ csv: z.string().min(1).max(MAX_CONTACT_IMPORT_BYTES), consent_source: z.string().trim().max(255).optional() }), body);
    const contacts = parseContactsCsv(data.csv);
    if (contacts.some(c => c.opted_in) && !data.consent_source)
      throw new UnprocessableEntityException('Record how and when these customers agreed to WhatsApp marketing.');
    return this.database.db.transaction(async trx => {
      await trx('businesses').where({ id: businessId }).forUpdate().first();
      const now = new Date();
      let imported = 0;
      for (let offset = 0; offset < contacts.length; offset += CONTACT_BATCH_SIZE) {
        const batch = contacts.slice(offset, offset + CONTACT_BATCH_SIZE);
        const existing = await trx('customers').where({ business_id: businessId }).whereIn('phone', batch.map(contact => contact.phone)).select('phone');
        const existingPhones = new Set(existing.map(contact => contact.phone));
        const fresh = batch.filter(contact => !existingPhones.has(contact.phone));
        if (!fresh.length) continue;
        await trx('customers').insert(fresh.map(contact => ({ ...contact, business_id: businessId, created_at: now, updated_at: now })));
        // Bulk MySQL insert IDs are not necessarily consecutive; resolve actual IDs by tenant + phone.
        const inserted = await trx('customers').where({ business_id: businessId }).whereIn('phone', fresh.map(contact => contact.phone)).select('id', 'phone');
        const ids = new Map(inserted.map(contact => [contact.phone, contact.id]));
        if (fresh.some(contact => !ids.has(contact.phone))) throw new Error('Imported contact IDs could not be resolved.');
        await trx('conversations').insert(fresh.map(contact => ({ business_id: businessId, customer_id: ids.get(contact.phone), created_at: now, updated_at: now })));
        await trx('customer_consent_events').insert(fresh.map(contact => ({ business_id: businessId, customer_id: ids.get(contact.phone), opted_in: contact.opted_in, source: contact.opted_in ? data.consent_source : 'No marketing consent provided', created_at: now })));
        imported += fresh.length;
      }
      return { data: { imported, skipped: contacts.length - imported } };
    });
  }

  async message(businessId: number, conversationId: number, body: unknown) {
    const data = validate(
      z.object({
        body: z.string().trim().min(1).max(4000),
        direction: z.enum(["outbound", "note"]),
        client_key: z.string().max(64).nullish(),
      }),
      body,
    );
    if (
      !(await this.database
        .db("conversations")
        .where({ business_id: businessId, id: conversationId })
        .first())
    )
      throw new NotFoundException();
    const business = await this.database
      .db("businesses")
      .where({ id: businessId })
      .first();
    if (data.direction === "outbound" && !business.demo) {
      if (!data.client_key)
        throw new UnprocessableEntityException(
          "A unique client_key is required for live replies.",
        );
      const id = await this.database.db.transaction(async (trx) => {
        await trx("businesses").where({ id: businessId }).forUpdate().first();
        const messageId = await this.providers.enqueueMessage(
          businessId,
          conversationId,
          data.body,
          data.client_key!,
          trx,
        );
        await trx("conversations")
          .where({ id: conversationId })
          .update({ mode: "human" });
        return messageId;
      });
      return { data: { id, status: "queued" } };
    }
    await this.database.db.transaction(async (trx) => {
      const now = new Date();
      await trx("messages").insert({
        ...data,
        business_id: businessId,
        conversation_id: conversationId,
        status: "demo",
        created_at: now,
        updated_at: now,
      });
      await trx("conversations")
        .where({ id: conversationId })
        .update({ updated_at: now });
    });
    return { data: { saved: true } };
  }

  async simulate(businessId: number, conversationId: number, body: unknown) {
    const data = validate(
      z.object({ body: z.string().trim().min(1).max(4000) }),
      body,
    );
    if (
      !(await this.database.db("businesses").where({ id: businessId }).first())
        ?.demo
    )
      throw new ForbiddenException();
    await this.database.db.transaction(async (trx) => {
      const conversation = await trx("conversations")
        .where({ business_id: businessId, id: conversationId })
        .forUpdate()
        .first();
      if (!conversation) throw new NotFoundException();
      const now = new Date();
      const base = {
        business_id: businessId,
        conversation_id: conversationId,
        status: "demo",
        created_at: now,
        updated_at: now,
      };
      await trx("messages").insert({
        ...base,
        body: data.body,
        direction: "inbound",
      });
      await trx("conversations")
        .where({ id: conversationId })
        .update({
          status: "open",
          unread: Number(conversation.unread) + 1,
          updated_at: now,
        });
      if (conversation.mode !== "ai") return;
      const rules = await trx("automations")
        .where({ business_id: businessId, active: true })
        .orderBy("id");
      const rule = rules.find((rule) =>
        data.body.toLowerCase().includes(String(rule.keyword).toLowerCase()),
      );
      if (rule) {
        await trx("messages").insert({
          ...base,
          body: rule.response,
          direction: "outbound",
        });
        await trx("automations").where({ id: rule.id }).increment("runs", 1);
      } else {
        await trx("conversations")
          .where({ id: conversationId })
          .update({ mode: "human" });
        await trx("messages").insert({
          ...base,
          body: "No approved rule matched. Handed over to your team.",
          direction: "note",
        });
      }
    });
    return { data: { saved: true } };
  }
}
