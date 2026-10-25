import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncDoitPayments } from "../lib/doit-sync"

export default async function syncDoitPaymentsJob(container: MedusaContainer) {
  try {
    await syncDoitPayments(container)
  } catch (e) {
    // Never throw from a job: the next run picks up where this one stopped.
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`[doit] Sync job failed: ${(e as Error).message}`)
  }
}

export const config = {
  name: "sync-doit-payments",
  // DOIT_SYNC_CRON overrides the 15-minute schedule (e.g. "* * * * *" in tests).
  schedule: process.env.DOIT_SYNC_CRON || "*/15 * * * *",
}
