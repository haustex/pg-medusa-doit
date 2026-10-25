import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261025015332 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "doit_setting" ("id" text not null, "api_key_encrypted" text null, "api_key_hint" text null, "webhook_secret_encrypted" text null, "encryption_key_fingerprint" text null, "environment" text check ("environment" in ('sandbox', 'production')) null, "rail" text check ("rail" in ('any', 'qris', 'va', 'transfer')) not null default 'any', "va_bank" text null, "expires_in" integer not null default 86400, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "doit_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_doit_setting_deleted_at" ON "doit_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "doit_setting" cascade;`);
  }

}
