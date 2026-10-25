"use client"

import { placeOrder } from "@lib/data/cart"
import { DoitPaymentStatus, getDoitPaymentStatus, selectDoitMethod } from "@lib/data/doit"
import { HttpTypes } from "@medusajs/types"
import { Button, Heading, Text, clx } from "@medusajs/ui"
import { useRouter } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { useCallback, useEffect, useRef, useState } from "react"
import { remaining, rupiah } from "./format"
import { bankNames, doitLabels as t } from "./labels"

type Props = {
  cart: HttpTypes.StoreCart
  providerId: string
  /** Send the shopper straight to doit.id's hosted payment page instead of showing QR / VA here. */
  redirectToHosted?: boolean
}

const ERROR_RETRY_MS = 10_000

/**
 * "Waiting for payment" panel: QRIS code or VA number, countdown to
 * expires_at, a link to the hosted page, and polling of
 * GET /store/doit/carts/:id/payment. Once doit.id reports the payment as paid
 * it places the order (the starter's placeOrder redirects to the confirmation
 * page; if the webhook completed the cart first, Medusa returns that order).
 */
export default function DoitPaymentPanel({ cart, providerId, redirectToHosted = false }: Props) {
  const router = useRouter()
  const [state, setState] = useState<DoitPaymentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const placing = useRef(false)
  const redirected = useRef(false)

  const finish = useCallback(async () => {
    if (placing.current) return
    placing.current = true
    try {
      await placeOrder(cart.id) // redirects to /[countryCode]/order/[id]/confirmed
    } catch (e: any) {
      placing.current = false
      setError(e?.message ?? t.errorGeneric)
    }
  }, [cart.id])

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    const res = await getDoitPaymentStatus(cart.id)
    let next: number | null = ERROR_RETRY_MS
    if (res.ok) {
      setState(res.data)
      setError(null)
      next = res.data.poll_after_ms
      if (res.data.next_action === "complete_cart" || res.data.next_action === "view_order") {
        next = null
        void finish()
      }
    } else {
      setError(t.errorGeneric)
      // 429: the backend asks to slow down
      next = res.status === 429 ? ERROR_RETRY_MS * 3 : ERROR_RETRY_MS
    }
    if (next !== null && document.visibilityState === "visible") {
      timer.current = setTimeout(poll, next)
    }
  }, [cart.id, finish])

  useEffect(() => {
    void poll()
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [poll])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const p = state?.payment
  useEffect(() => {
    if (redirectToHosted && p?.hosted_url && state?.next_action === "wait" && !redirected.current) {
      redirected.current = true
      window.location.assign(p.hosted_url)
    }
  }, [redirectToHosted, p?.hosted_url, state?.next_action])

  const newInvoice = async () => {
    if (!p?.rail) return
    setBusy(true)
    const res = await selectDoitMethod(
      cart,
      providerId,
      { rail: p.rail as "qris" | "va" | "transfer", va_bank: p.va_bank },
      window.location.href,
      { force: true }
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    router.refresh()
    void poll()
  }

  if (!state) {
    return (
      <Text className="txt-medium text-ui-fg-subtle" data-testid="doit-panel-loading">
        {error ?? t.loading}
      </Text>
    )
  }

  const expiresAt = p?.expires_at ? new Date(p.expires_at).getTime() : null
  const isExpired = expiresAt !== null && expiresAt <= now
  const total = p?.total_amount ?? p?.amount
  const customerFee = p?.fee_payer === "customer" && p.fee_amount ? p.fee_amount : 0
  const done = state.next_action === "complete_cart" || state.next_action === "view_order"
  const retry = state.next_action === "retry"

  return (
    <div className="flex flex-col gap-y-6 rounded-rounded border border-ui-border-base p-6" data-testid="doit-payment-panel">
      <div className="flex flex-col gap-y-1">
        <Heading level="h3" className="txt-xlarge">{t.payTitle}</Heading>
        {p?.environment === "test" && <Text className="txt-small text-ui-fg-muted">{t.testMode}</Text>}
      </div>

      <div className="flex flex-col gap-y-1">
        <Text className="txt-small text-ui-fg-subtle">{t.totalToPay}</Text>
        <Text className="text-2xl font-semibold text-ui-fg-base" data-testid="doit-total">{rupiah(total)}</Text>
        {customerFee > 0 && <Text className="txt-small text-ui-fg-subtle">{t.includesFee(rupiah(customerFee))}</Text>}
      </div>

      {!done && !retry && state.qr_expired && p?.hosted_url && (
        <div className="flex flex-col items-start gap-y-3" data-testid="doit-qr-expired">
          <Text className="txt-medium text-ui-fg-base max-w-sm">{t.qrExpired}</Text>
          <Button asChild variant="primary">
            <a href={p.hosted_url}>{t.continueHosted}</a>
          </Button>
        </div>
      )}

      {!done && !retry && p?.qr_content && (
        <div className="flex flex-col items-start gap-y-3">
          <div className="rounded-rounded border border-ui-border-base bg-white p-3" data-testid="doit-qris">
            <QRCodeSVG value={p.qr_content} size={220} level="M" marginSize={2} title="QRIS" />
          </div>
          <Text className="txt-small text-ui-fg-subtle max-w-sm">{t.scanQris}</Text>
        </div>
      )}

      {!done && !retry && p?.va_number && (
        <div className="flex flex-col gap-y-2" data-testid="doit-va">
          <Text className="txt-small text-ui-fg-subtle">{t.vaNumber(bankNames[p.va_bank ?? ""] ?? (p.va_bank ?? "").toUpperCase())}</Text>
          <div className="flex items-center gap-x-3">
            <span className="font-mono text-2xl tracking-wider text-ui-fg-base" data-testid="doit-va-number">{p.va_number}</span>
            <CopyButton value={p.va_number} />
          </div>
          <Text className="txt-small text-ui-fg-subtle max-w-sm">{t.vaHint}</Text>
        </div>
      )}

      {!done && !retry && expiresAt !== null && (
        <div className="flex items-baseline gap-x-2" data-testid="doit-countdown">
          <Text className="txt-small text-ui-fg-subtle">{isExpired ? t.expired : t.expiresIn}</Text>
          {!isExpired && (
            <Text className="font-mono txt-medium-plus text-ui-fg-base" suppressHydrationWarning>
              {remaining(expiresAt, now)}
            </Text>
          )}
        </div>
      )}

      <div className={clx("flex items-center gap-x-2 txt-small", retry ? "text-ui-fg-error" : "text-ui-fg-subtle")} data-testid="doit-status">
        {!done && !retry && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-ui-fg-interactive" />}
        <span>{done ? t.paid : retry ? t.failed : t.waiting}</span>
      </div>

      {error && <Text className="txt-small text-ui-fg-error">{error}</Text>}

      <div className="flex flex-wrap items-center gap-3">
        {retry && (
          <Button onClick={newInvoice} isLoading={busy} data-testid="doit-new-invoice">{t.newInvoice}</Button>
        )}
        {!done && !retry && p?.hosted_url && (
          <a href={p.hosted_url} target="_blank" rel="noopener noreferrer" className="txt-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover underline" data-testid="doit-hosted-link">
            {t.openHosted}
          </a>
        )}
      </div>
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Older browsers / non-secure origins: fall back to a hidden textarea.
      const el = document.createElement("textarea")
      el.value = value
      document.body.appendChild(el)
      el.select()
      document.execCommand("copy")
      el.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button variant="secondary" size="small" onClick={copy} data-testid="doit-copy-va">
      {copied ? t.copied : t.copy}
    </Button>
  )
}
