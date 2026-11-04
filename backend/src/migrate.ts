import './environment';
import 'reflect-metadata';
import { DatabaseService } from './common/database.service';
import type { Knex } from 'knex';

async function ensureTable(db:Knex,name:string,define:(table:Knex.CreateTableBuilder)=>void){
  if(await db.schema.hasTable(name))return;
  try { await db.schema.createTable(name,define); }
  catch(error:any){
    // Another deployment process may have created the table after our check.
    if(error?.code!=='ER_TABLE_EXISTS_ERROR')throw error;
  }
}

export async function migrate(database:DatabaseService){
  const db=database.db;
  for(const table of ['users','businesses','business_users','customers','conversations','messages','products','automations','knowledge','campaigns','whatsapp_accounts','whatsapp_signup_attempts','subscriptions','usage_months','webhook_events','billing_payments','password_reset_tokens']){
    if(!await db.schema.hasTable(table))throw new Error(`Missing existing application table: ${table}. Restore the complete existing MySQL schema before migration.`);
  }
  await ensureTable(db,'node_sessions',t=>{t.string('id',128).primary();t.bigInteger('user_id').unsigned().nullable().index();t.json('payload').notNullable();t.dateTime('expires_at').notNullable().index();});
  await ensureTable(db,'node_jobs',t=>{t.bigIncrements('id');t.string('kind',80).notNullable();t.json('payload').notNullable();t.string('status',24).notNullable().defaultTo('pending');t.integer('attempts').unsigned().defaultTo(0);t.dateTime('available_at').notNullable();t.dateTime('locked_at').nullable();t.string('lock_owner',64).nullable();t.string('last_error',120).nullable();t.dateTime('created_at').notNullable();t.dateTime('completed_at').nullable();t.index(['status','available_at']);});
  await ensureTable(db,'customer_consent_events',t=>{t.bigIncrements('id');t.bigInteger('business_id').unsigned().notNullable();t.bigInteger('customer_id').unsigned().notNullable();t.boolean('opted_in').notNullable();t.string('source',255).notNullable();t.dateTime('created_at').notNullable();t.index(['business_id','customer_id']);});
  await ensureTable(db,'campaign_runs',t=>{t.bigIncrements('id');t.bigInteger('business_id').unsigned().notNullable();t.bigInteger('campaign_id').unsigned().notNullable();t.string('template_name',512).notNullable();t.string('language',20).notNullable();t.text('template_body').notNullable();t.string('status',24).notNullable();t.dateTime('scheduled_at').notNullable();t.dateTime('created_at').notNullable();t.dateTime('updated_at').notNullable();t.unique(['business_id','campaign_id']);});
  await ensureTable(db,'campaign_recipients',t=>{t.bigIncrements('id');t.bigInteger('business_id').unsigned().notNullable();t.bigInteger('run_id').unsigned().notNullable();t.bigInteger('customer_id').unsigned().notNullable();t.bigInteger('message_id').unsigned().nullable().unique();t.string('status',24).notNullable();t.dateTime('created_at').notNullable();t.dateTime('updated_at').notNullable();t.unique(['run_id','customer_id']);t.index(['business_id','run_id','status']);});
  console.log('Node session and job tables ready; existing application tables were preserved.');
}
if(require.main===module){const database=new DatabaseService();void migrate(database).catch(error=>{console.error(error?.message?.startsWith('Missing existing application table')?error.message:'Migration failed. Check MySQL connectivity and privileges.');process.exitCode=1;}).finally(()=>database.onModuleDestroy());}
