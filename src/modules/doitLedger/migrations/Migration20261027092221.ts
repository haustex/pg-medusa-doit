import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261027092221 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "doit_payment" add column if not exists "excluded_at" timestamptz null, add column if not exists "excluded_reason" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_payment_excluded_at" ON "doit_payment" ("excluded_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_doit_payment_excluded_at";`);
    this.addSql(`alter table if exists "doit_payment" drop column if exists "excluded_at", drop column if exists "excluded_reason";`);
  }

}
