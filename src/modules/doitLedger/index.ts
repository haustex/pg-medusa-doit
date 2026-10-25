import { Module } from "@medusajs/framework/utils"
import DoitLedgerModuleService from "./service"

export const DOIT_LEDGER_MODULE = "doitLedger"

export default Module(DOIT_LEDGER_MODULE, {
  service: DoitLedgerModuleService,
})
