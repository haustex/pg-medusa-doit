import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolveDoitCredentials } from "../../lib/credentials"
import { getDoitProviderOptions } from "../../lib/provider-options"
import { markEventSeen, wasEventSeen } from "../../providers/doit/event-dedupe"
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
 * delivery shows as failed in the portal. A valid event that was already
 * accepted is answered 200 without being queued again.
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

  const eventId = (req.body as { id?: unknown } | undefined)?.id
  if (typeof eventId === "string" && eventId) {
    if (wasEventSeen(eventId)) {
      logger.info(`[doit] Webhook ${eventId} already accepted; not queued again.`)
      res.status(200).json({ received: true, duplicate: true })
      return
    }
    // Only remember it once Medusa has actually queued it (core route answers 200).
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        markEventSeen(eventId)
      }
    })
  }

  return next()
}
