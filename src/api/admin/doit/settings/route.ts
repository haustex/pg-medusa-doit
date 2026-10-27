import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolveDoitCredentials } from "../../../../lib/credentials"
import { getDoitPluginOptions } from "../../../../lib/plugin-options"
import { toPublicSettings } from "../../../../lib/public-settings"
import { backendUrlOf, loadCredentials } from "../../../../lib/admin-context"
import { startOfDayIn } from "../../../../lib/date-range"
import { storeIdOf } from "../../../../lib/ownership"
import { saveDoitSettingsWorkflow } from "../../../../workflows/save-doit-settings"
import type { PostAdminDoitSettingsType } from "./validators"

async function describeSettings(req: AuthenticatedMedusaRequest) {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const creds = await resolveDoitCredentials(pg, {}, {
    fresh: true,
    logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER),
  })
  return toPublicSettings(
    creds,
    getDoitPluginOptions(req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE)),
    backendUrlOf(req),
    await storeIdOf(pg)
  )
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ settings: await describeSettings(req) })
}

export async function POST(
  req: AuthenticatedMedusaRequest<PostAdminDoitSettingsType>,
  res: MedusaResponse
) {
  const body = req.validatedBody
  // "ignore before" is a calendar date in the dashboard's time zone
  let ignoreBefore: Date | null | undefined = undefined
  if (body.ignore_before === null || body.ignore_before === "") {
    ignoreBefore = null
  } else if (body.ignore_before) {
    const tz = body.timezone ?? (await loadCredentials(req, { fresh: true })).timezone
    ignoreBefore = startOfDayIn(body.ignore_before, tz)
  }
  await saveDoitSettingsWorkflow(req.scope).run({
    input: {
      ...body,
      api_key: body.api_key === "" ? null : body.api_key,
      webhook_secret: body.webhook_secret === "" ? null : body.webhook_secret,
      ignore_before: ignoreBefore,
    },
  })
  res.json({ settings: await describeSettings(req) })
}
