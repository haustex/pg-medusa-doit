import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261025070632 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "doit_withdrawal" drop constraint if exists "doit_withdrawal_external_ref_unique";`);
    this.addSql(`create table if not exists "doit_withdrawal" ("id" text not null, "date" text not null, "amount" integer not null, "fee_amount" integer not null default 0, "note" text null, "source" text check ("source" in ('manual', 'csv')) not null default 'manual', "external_ref" text null, "environment" text not null, "created_by" text null, "raw" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_withdrawal_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_doit_withdrawal_external_ref_unique" ON "doit_withdrawal" ("external_ref") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_withdrawal_deleted_at" ON "doit_withdrawal" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_withdrawal_date" ON "doit_withdrawal" ("date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_withdrawal_environment" ON "doit_withdrawal" ("environment") WHERE deleted_at IS NULL;`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_paid_at" ON "doit_payment" ("paid_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_environment_status" ON "doit_payment" ("environment", "status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_order_id" ON "doit_payment" ("order_id") WHERE deleted_at IS NULL;`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_refund_status_created_at" ON "doit_refund" ("status", "created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "doit_withdrawal" cascade;`);

    this.addSql(`drop index if exists "IDX_doit_payment_paid_at";`);
    this.addSql(`drop index if exists "IDX_doit_payment_environment_status";`);
    this.addSql(`drop index if exists "IDX_doit_payment_order_id";`);

    this.addSql(`drop index if exists "IDX_doit_refund_status_created_at";`);
  }

}
