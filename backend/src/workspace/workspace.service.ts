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
import { parseContactsCsv } from './contact-import';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly providers: ProviderService,
  ) {}
  async snapshot(businessId: number) {
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
    result.conversations = await db("conversations")
      .join("customers", "customers.id", "conversations.customer_id")
      .where("conversations.business_id", businessId)
      .select(
        "conversations.*",
        "customers.name",
        "customers.phone",
        "customers.tag",
      )
      .orderBy("conversations.updated_at", "desc")
      .limit(100);
    result.messages = (
      await db("messages")
        .where({ business_id: businessId })
        .orderBy("id", "desc")
        .limit(500)
    ).reverse();
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

  async store(businessId: number, resource: string, body: unknown) {
    const data = validate(schemaFor(stores, resource), body) as Record<
      string,
      unknown
    >;
    try {
      const id = await this.database.db.transaction(async (trx) => {
        await trx("businesses").where({ id: businessId }).forUpdate().first();
        const count = await trx(resource)
          .where({ business_id: businessId })
          .count({ count: "*" })
          .first();
        if (Number(count?.count) >= 100)
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
    const data = validate(z.object({ csv: z.string().min(1).max(200_000), consent_source: z.string().trim().max(255).optional() }), body);
    const contacts = parseContactsCsv(data.csv);
    if (contacts.some(c => c.opted_in) && !data.consent_source)
      throw new UnprocessableEntityException('Record how and when these customers agreed to WhatsApp marketing.');
    return this.database.db.transaction(async trx => {
      await trx('businesses').where({ id: businessId }).forUpdate().first();
      const existing = await trx('customers').where({ business_id: businessId }).whereIn('phone', contacts.map(c => c.phone)).select('phone');
      const phones = new Set(existing.map(c => c.phone));
      const fresh = contacts.filter(c => !phones.has(c.phone));
      const count = await trx('customers').where({ business_id: businessId }).count({ count: '*' }).first();
      if (Number(count?.count) + fresh.length > 100)
        throw new UnprocessableEntityException('This workspace supports 100 contacts. No contacts were imported.');
      const now = new Date();
      for (const contact of fresh) {
        const [id] = await trx('customers').insert({ ...contact, business_id: businessId, created_at: now, updated_at: now });
        await trx('conversations').insert({ business_id: businessId, customer_id: id, created_at: now, updated_at: now });
        await trx('customer_consent_events').insert({ business_id: businessId, customer_id: id, opted_in: contact.opted_in, source: contact.opted_in ? data.consent_source : 'No marketing consent provided', created_at: now });
      }
      return { data: { imported: fresh.length, skipped: contacts.length - fresh.length } };
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
