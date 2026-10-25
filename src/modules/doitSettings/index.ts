import { Module } from "@medusajs/framework/utils"
import DoitSettingsModuleService from "./service"

export const DOIT_SETTINGS_MODULE = "doitSettings"

export default Module(DOIT_SETTINGS_MODULE, {
  service: DoitSettingsModuleService,
})
