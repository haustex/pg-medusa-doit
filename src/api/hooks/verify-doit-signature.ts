import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolveDoitCredentials } from "../../lib/credentials"
import { getDoitProviderOptions } from "../../lib/provider-options"
import { claimDoitEventWorkflow } from "../../workflows/claim-doit-event"
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  SIGNATURE_HEADER,
  verifySignature,
} from "../../providers/doit/signature"

export const DOIT_WEBHOOK_MATCHER = "/hooks/payment/:provider"

function reject(res: MedusaResponse, code: string, message: string) {
  res.status(401).json({ error: { code, message } })
}

/**
 * Runs in front of Medusa's `POST /hooks/payment/:provider` for doit
 * providers only (`doit_<id>`); every other provider passes straight through.
 *
 * Answers 401 when the PayBridge-Signature is missing, malformed, wrong, or
 * its timestamp is more than 5 minutes off, so doit.id retries and the
 * delivery shows as failed in the portal. A valid event is claimed in
 * doit_event first; one already received is answered 200 without being
 * queued again (see classifyRedelivery for when a delivery is re-queued).
 */
export async function verifyDoitSignature(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const provider = req.params?.provider ?? ""
  const options = getDoitProviderOptions(
    req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE),
    provider
  )
  if (!options) {
    return next()
  }

  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const creds = await resolveDoitCredentials(
    req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION),
    options,
    { logger }
  )
  if (!creds.webhookSecret) {
    logger.warn(`[doit] Webhook ${provider} rejected: no signing secret configured.`)
    return reject(res, "webhook_secret_not_configured", "Webhook signing secret is not configured")
  }

  const result = verifySignature({
    rawBody: req.rawBody,
    header: req.headers[SIGNATURE_HEADER],
    secret: creds.webhookSecret,
    toleranceSeconds: DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  })
  if (!result.valid) {
    logger.warn(`[doit] Webhook ${provider} rejected: ${result.reason}.`)
    return reject(res, "invalid_signature", `Signature verification failed: ${result.reason}`)
  }

  const body = (req.body ?? {}) as { id?: unknown; type?: unknown; data?: Record<string, unknown> }
  if (typeof body.id === "string" && body.id) {
    const data = body.data ?? {}
    const paymentId =
      (typeof data.id === "string" && data.id.startsWith("pay_") && data.id) ||
      (typeof data.payment_id === "string" && data.payment_id) ||
      null
    // doit_event.event_id is unique, so this holds across server instances.
    const { result } = await claimDoitEventWorkflow(req.scope).run({
      input: {
        event_id: body.id,
        type: typeof body.type === "string" ? body.type : "unknown",
        doit_payment_id: paymentId,
        payload: body as Record<string, unknown>,
      },
    })
    if (result.duplicate) {
      logger.info(`[doit] Webhook ${body.id} already received; not queued again.`)
      res.status(200).json({ received: true, duplicate: true })
      return
    }
  }

  return next()
}
