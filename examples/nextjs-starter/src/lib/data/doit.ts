"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { getAuthHeaders, getCacheTag } from "./cookies"

/** What the shopper picked: QRIS, or a VA / transfer bank. */
export type DoitChoice = {
  rail: "qris" | "va" | "transfer" | "any"
  va_bank?: string | null
}

export type DoitMethod = {
  code: string
  label: string
  rail: "qris" | "va" | "transfer"
  bank: string | null
  fee_payer: string | null
  fee_amount: number | null
  total_amount: number | null
}

export type DoitMethods = {
  provider_id: string
  amount: number | null
  default: { rail: DoitChoice["rail"]; va_bank: string | null }
  methods: DoitMethod[]
  source: "doit" | "unavailable"
}

export type DoitPaymentStatus = {
  cart_id: string
  payment_session_id: string
  order_id: string | null
  /** wait: keep polling · complete_cart: paid, place the order · view_order: done · retry: expired / failed */
  next_action: "wait" | "complete_cart" | "view_order" | "retry"
  poll_after_ms: number | null
  payment: {
    id: string | null
    status: "pending" | "paid" | "expired" | "failed" | "refunded" | null
    rail: string | null
    va_bank: string | null
    va_number: string | null
    qr_content: string | null
    hosted_url: string | null
    expires_at: string | null
    paid_at: string | null
    amount: number | null
    fee_amount: number | null
    fee_payer: "merchant" | "customer" | null
    total_amount: number | null
    environment: string | null
  }
}

export type DoitResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

function toError(e: any): { ok: false; status: number; message: string } {
  return { ok: false, status: e?.status ?? 0, message: e?.message ?? "Gagal menghubungi server." }
}

/** Methods doit.id has active for this store, with the fee for the cart total. Cached by the backend for 5 minutes. */
export async function listDoitMethods(cartId: string): Promise<DoitResult<DoitMethods>> {
  try {
    const data = await sdk.client.fetch<DoitMethods>("/store/doit/methods", {
      method: "GET",
      query: { cart_id: cartId },
      headers: { ...(await getAuthHeaders()) },
      cache: "no-store",
    })
    return { ok: true, data }
  } catch (e) {
    return toError(e)
  }
}

/** Status for the "waiting for payment" panel. Safe to poll: the backend throttles reads of doit.id. */
export async function getDoitPaymentStatus(cartId: string): Promise<DoitResult<DoitPaymentStatus>> {
  try {
    const data = await sdk.client.fetch<DoitPaymentStatus>(`/store/doit/carts/${cartId}/payment`, {
      method: "GET",
      headers: { ...(await getAuthHeaders()) },
      cache: "no-store",
    })
    return { ok: true, data }
  } catch (e) {
    return toError(e)
  }
}

/**
 * Creates (or replaces) the cart's doit payment session for the chosen
 * method. A session with the same rail / bank that is still pending is kept,
 * so going back and forth in the checkout does not create new invoices.
 */
export async function selectDoitMethod(
  cart: HttpTypes.StoreCart,
  providerId: string,
  choice: DoitChoice,
  returnUrl?: string,
  { force = false }: { force?: boolean } = {}
): Promise<DoitResult<null>> {
  const current = cart.payment_collection?.payment_sessions?.find(
    (s) => s.provider_id === providerId && s.status === "pending"
  )
  const same =
    current &&
    current.data?.status === "pending" &&
    (current.data?.requested_rail ?? current.data?.rail) === choice.rail &&
    (choice.rail === "qris" || choice.rail === "any" || current.data?.va_bank === choice.va_bank)
  if (same && !force) {
    return { ok: true, data: null }
  }

  try {
    await sdk.store.payment.initiatePaymentSession(
      cart,
      {
        provider_id: providerId,
        data: {
          rail: choice.rail,
          ...(choice.va_bank ? { va_bank: choice.va_bank } : {}),
          ...(returnUrl ? { return_url: returnUrl } : {}),
        },
      },
      {},
      { ...(await getAuthHeaders()) }
    )
    revalidateTag(await getCacheTag("carts"))
    return { ok: true, data: null }
  } catch (e) {
    return toError(e)
  }
}
