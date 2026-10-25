import { model } from "@medusajs/framework/utils"

/** High-water mark and last outcome of the sync job (one row per key). */
const DoitSyncState = model.define("doit_sync_state", {
  id: model.id({ prefix: "doitsync" }).primaryKey(),
  key: model.text().unique(),
  // newest doit.id created_at seen by the payment scan
  cursor: model.dateTime().nullable(),
  last_run_at: model.dateTime().nullable(),
  last_success_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  stats: model.json().nullable(),
})

export default DoitSyncState
