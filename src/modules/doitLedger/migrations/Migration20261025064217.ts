import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261025064217 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "doit_sync_state" drop constraint if exists "doit_sync_state_key_unique";`);
    this.addSql(`alter table if exists "doit_refund" drop constraint if exists "doit_refund_medusa_refund_id_unique";`);
    this.addSql(`alter table if exists "doit_refund" drop constraint if exists "doit_refund_doit_refund_id_unique";`);
    this.addSql(`alter table if exists "doit_payment" drop constraint if exists "doit_payment_doit_id_unique";`);
    this.addSql(`alter table if exists "doit_event" drop constraint if exists "doit_event_event_id_unique";`);
    this.addSql(`alter table if exists "doit_attention" drop constraint if exists "doit_attention_dedupe_key_unique";`);
    this.addSql(`create table if not exists "doit_attention" ("id" text not null, "code" text check ("code" in ('overpaid', 'late_payment_canceled', 'late_payment_flagged', 'paid_without_session', 'superseded_invoice_paid', 'amount_mismatch', 'refund_mismatch', 'refund_failed', 'webhook_failed')) not null, "dedupe_key" text not null, "status" text check ("status" in ('open', 'resolved', 'dismissed')) not null default 'open', "doit_payment_id" text null, "session_id" text null, "order_id" text null, "event_id" text null, "amount" integer null, "message" text not null, "details" jsonb null, "resolved_at" timestamptz null, "resolved_by" text null, "resolution_note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_attention_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_attention_dedupe_key_unique" ON "doit_attention" ("dedupe_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_attention_deleted_at" ON "doit_attention" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_attention_status" ON "doit_attention" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_attention_code" ON "doit_attention" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_attention_doit_payment_id" ON "doit_attention" ("doit_payment_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "doit_event" ("id" text not null, "event_id" text not null, "type" text not null, "doit_payment_id" text null, "status" text check ("status" in ('received', 'processed', 'ignored', 'failed')) not null default 'received', "attempts" integer not null default 0, "last_error" text null, "received_at" timestamptz not null, "processed_at" timestamptz null, "payload" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_event_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_event_event_id_unique" ON "doit_event" ("event_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_event_deleted_at" ON "doit_event" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_event_status" ON "doit_event" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_event_doit_payment_id" ON "doit_event" ("doit_payment_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "doit_payment" ("id" text not null, "doit_id" text not null, "reference" text not null, "session_id" text null, "order_id" text null, "status" text not null, "amount" integer not null, "fee_amount" integer not null default 0, "net_amount" integer not null, "total_amount" integer null, "fee_payer" text null, "rail" text null, "va_bank" text null, "environment" text null, "flags" jsonb null, "refunded_amount" integer not null default 0, "paid_at" timestamptz null, "expires_at" timestamptz null, "doit_created_at" timestamptz null, "reconciled_at" timestamptz null, "last_synced_at" timestamptz null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_payment_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_payment_doit_id_unique" ON "doit_payment" ("doit_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_deleted_at" ON "doit_payment" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_status" ON "doit_payment" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_reference" ON "doit_payment" ("reference") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_doit_created_at" ON "doit_payment" ("doit_created_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "doit_refund" ("id" text not null, "doit_refund_id" text null, "doit_payment_id" text not null, "medusa_refund_id" text null, "amount" integer not null, "status" text check ("status" in ('pending', 'succeeded', 'failed')) not null default 'pending', "reason" text null, "source" text check ("source" in ('api', 'webhook', 'sync')) not null, "webhook_event_id" text null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_refund_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_refund_doit_refund_id_unique" ON "doit_refund" ("doit_refund_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_refund_medusa_refund_id_unique" ON "doit_refund" ("medusa_refund_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_refund_deleted_at" ON "doit_refund" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_refund_doit_payment_id" ON "doit_refund" ("doit_payment_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "doit_sync_state" ("id" text not null, "key" text not null, "cursor" timestamptz null, "last_run_at" timestamptz null, "last_success_at" timestamptz null, "last_error" text null, "stats" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_sync_state_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_sync_state_key_unique" ON "doit_sync_state" ("key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_sync_state_deleted_at" ON "doit_sync_state" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "doit_attention" cascade;`);

    this.addSql(`drop table if exists "doit_event" cascade;`);

    this.addSql(`drop table if exists "doit_payment" cascade;`);

    this.addSql(`drop table if exists "doit_refund" cascade;`);

    this.addSql(`drop table if exists "doit_sync_state" cascade;`);
  }

}
