import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261025070631 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "doit_setting" add column if not exists "timezone" text not null default 'Asia/Jakarta';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "doit_setting" drop column if exists "timezone";`);
  }

}
