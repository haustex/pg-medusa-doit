import { MedusaService } from "@medusajs/framework/utils"
import DoitAttention from "./models/doit-attention"
import DoitEvent from "./models/doit-event"
import DoitPayment from "./models/doit-payment"
import DoitRefund from "./models/doit-refund"
import DoitSyncState from "./models/doit-sync-state"

class DoitLedgerModuleService extends MedusaService({
  DoitPayment,
  DoitEvent,
  DoitRefund,
  DoitAttention,
  DoitSyncState,
}) {}

export default DoitLedgerModuleService
