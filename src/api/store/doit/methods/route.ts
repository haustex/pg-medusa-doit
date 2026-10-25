import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { DoitApiError } from "../../../../providers/doit/client"
import {
  DEFAULT_DOIT_PROVIDER_ID,
  isDoitProvider,
  listStoreMethods,
  storeCredentials,
} from "../../../../lib/store-payment"
import { loadAccessibleCart } from "../helpers"
import type { GetStoreDoitMethodsType } from "../validators"

/**
 * Payment methods the storefront can offer (GET /v1/methods, cached 5 minutes),
 * with doit.id's fee for the cart total when `cart_id` is given, plus the
 * Admin's default rail. If doit.id cannot be reached the list is empty and
 * the storefront can still offer the default.
 */
export async function GET(req: MedusaStoreRequest<unknown, GetStoreDoitMethodsType>, res: MedusaResponse) {
  const { cart_id, provider_id = DEFAULT_DOIT_PROVIDER_ID } = req.validatedQuery as GetStoreDoitMethodsType
  if (!isDoitProvider(provider_id)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "provider_id bukan provider doit.id.")
  }
  let amount: number | undefined
  if (cart_id) {
    const { cart } = await loadAccessibleCart(req, cart_id)
    const total = Number(cart.total)
    amount = Number.isSafeInteger(total) && total > 0 ? total : undefined
  }

  const { creds, options } = await storeCredentials(req.scope, provider_id)
  const defaults = { rail: creds.rail, va_bank: creds.vaBank }
  if (!creds.apiKey) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "doit.id belum dikonfigurasi.")
  }

  res.set("Cache-Control", "no-store")
  try {
    const methods = await listStoreMethods(creds, options, amount)
    res.json({ provider_id, amount: amount ?? null, default: defaults, methods, source: "doit" })
  } catch (e) {
    req.scope
      .resolve(ContainerRegistrationKeys.LOGGER)
      .warn(`[doit] Store methods: ${e instanceof DoitApiError ? `${e.code} ${e.message}` : (e as Error).message}`)
    res.json({ provider_id, amount: amount ?? null, default: defaults, methods: [], source: "unavailable" })
  }
}
