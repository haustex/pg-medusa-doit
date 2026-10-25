import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  DOIT_SETTINGS_UPDATED_EVENT,
  invalidateDoitCredentialsCache,
} from "../lib/credentials"

export default async function doitSettingsUpdatedHandler({
  container,
}: SubscriberArgs<{ id: string }>) {
  invalidateDoitCredentialsCache()
  container.resolve(ContainerRegistrationKeys.LOGGER).debug(`[doit] credentials cache cleared (pid ${process.pid})`)
}

export const config: SubscriberConfig = {
  event: DOIT_SETTINGS_UPDATED_EVENT,
}
