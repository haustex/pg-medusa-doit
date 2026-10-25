import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { InjectManager, MedusaContext, MedusaService } from "@medusajs/framework/utils"
import DoitAttention from "./models/doit-attention"
import DoitEvent from "./models/doit-event"
import DoitPayment from "./models/doit-payment"
import DoitRefund from "./models/doit-refund"
import DoitSyncState from "./models/doit-sync-state"
import DoitWithdrawal from "./models/doit-withdrawal"
import {
  dailySeries,
  dashboardStats,
  listPayments,
  type PaymentFilters,
  type ReportRange,
} from "./reports"

/** Knex of the manager the decorated method was given (transaction if any). */
function knexOf(sharedContext: Context): Knex {
  const manager = (sharedContext.transactionManager ?? sharedContext.manager) as { getKnex(): Knex }
  return manager.getKnex()
}

class DoitLedgerModuleService extends MedusaService({
  DoitPayment,
  DoitEvent,
  DoitRefund,
  DoitAttention,
  DoitSyncState,
  DoitWithdrawal,
}) {
  /** Aggregated in SQL; see reports.ts. */
  @InjectManager()
  async getDashboardStats(range: ReportRange, @MedusaContext() sharedContext: Context = {}) {
    return dashboardStats(knexOf(sharedContext), range)
  }

  @InjectManager()
  async getDailySeries(range: ReportRange, @MedusaContext() sharedContext: Context = {}) {
    return dailySeries(knexOf(sharedContext), range)
  }

  @InjectManager()
  async listPaymentsPage(
    filters: PaymentFilters,
    page: { limit: number; offset: number },
    @MedusaContext() sharedContext: Context = {}
  ) {
    return listPayments(knexOf(sharedContext), filters, page)
  }
}

export default DoitLedgerModuleService
