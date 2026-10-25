import { emitEventStep } from "@medusajs/medusa/core-flows"
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { DOIT_SETTINGS_UPDATED_EVENT } from "../lib/credentials"
import {
  upsertDoitSettingsStep,
  UpsertDoitSettingsInput,
} from "./steps/upsert-doit-settings"

export const saveDoitSettingsWorkflow = createWorkflow(
  "save-doit-settings",
  function (input: UpsertDoitSettingsInput) {
    const saved = upsertDoitSettingsStep(input)

    // Other processes (e.g. the worker) drop their cached credentials on this event.
    const eventData = transform({ saved }, ({ saved }) => ({ id: saved.id }))
    emitEventStep({ eventName: DOIT_SETTINGS_UPDATED_EVENT, data: eventData })

    return new WorkflowResponse(saved)
  }
)
