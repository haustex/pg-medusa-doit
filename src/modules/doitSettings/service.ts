import { MedusaService } from "@medusajs/framework/utils"
import DoitSetting from "./models/doit-setting"

class DoitSettingsModuleService extends MedusaService({
  DoitSetting,
}) {}

export default DoitSettingsModuleService
