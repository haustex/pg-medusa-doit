import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261027080733 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "doit_setting" add column if not exists "reference_prefix" text null, add column if not exists "ignore_before" timestamptz null, add column if not exists "credentials_saved_at" timestamptz null;`);
    // Installs that already hold an API key: the row was created when the key was first saved.
    this.addSql(`update "doit_setting" set "credentials_saved_at" = "created_at" where "credentials_saved_at" is null and "api_key_encrypted" is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "doit_setting" drop column if exists "reference_prefix", drop column if exists "ignore_before", drop column if exists "credentials_saved_at";`);
  }

}
