import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolveDoitCredentials } from "../../../../lib/credentials"
import { toPublicSettings } from "../../../../lib/public-settings"
import { saveDoitSettingsWorkflow } from "../../../../workflows/save-doit-settings"
import type { PostAdminDoitSettingsType } from "./validators"

async function describeSettings(req: AuthenticatedMedusaRequest) {
  const creds = await resolveDoitCredentials(
    req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION),
    {},
    { fresh: true, logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER) }
  )
  return toPublicSettings(creds)
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ settings: await describeSettings(req) })
}

export async function POST(
  req: AuthenticatedMedusaRequest<PostAdminDoitSettingsType>,
  res: MedusaResponse
) {
  const body = req.validatedBody
  await saveDoitSettingsWorkflow(req.scope).run({
    input: {
      ...body,
      api_key: body.api_key === "" ? null : body.api_key,
      webhook_secret: body.webhook_secret === "" ? null : body.webhook_secret,
    },
  })
  res.json({ settings: await describeSettings(req) })
}
