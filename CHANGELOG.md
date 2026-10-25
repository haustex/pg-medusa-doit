# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-25

First public beta (`npm install medusa-payment-doit@beta`). Requires Medusa 2.19.x.

### Added

- doit.id payment provider (`pp_doit_doit`): QRIS, Virtual Account (`bmri` `bnia` `brin` `cimb` `permata` `maybank`
  `danamon` `bsyi`), hosted page (`any`) and bank transfer (`transfer`, untested on the sandbox). IDR only, whole rupiah.
- Idempotent invoice creation (`Idempotency-Key` per session and request), retries on 429/5xx/timeouts honouring
  `Retry-After`, a 120 requests/minute limiter per API key, refunds through `POST /v1/payments/{id}/refunds`.
- Credentials managed in the Admin, encrypted with AES-256-GCM (`DOIT_ENCRYPTION_KEY`); fallback to provider options
  and env vars; clear status when the encryption key is missing, malformed or different.
- Webhook endpoint `/hooks/payment/doit_doit`: `PayBridge-Signature` verification on the raw body (±5 minutes),
  deduplication by event id in the database, processing in the worker with retries and a "webhook failed" item after
  the last attempt. Status is always re-read from doit.id before capture.
- Ledger module (payments, events, refunds, withdrawals, sync state) and "needs action" items for `bayar_ganda`,
  `bayar_telat` on canceled orders, superseded invoices, amount and refund mismatches, failed refunds and webhooks.
- Reconciliation job (`*/15 * * * *`, `DOIT_SYNC_CRON`) with a lock: scans recent payments, re-reads open ones and
  completes orders whose webhook was lost.
- Admin dashboard (English and Indonesian): settings with connection test and webhook URL, overview cards, gross /
  fee / net, estimated balance, daily chart, transactions with filters and CSV export, withdrawals (manual and
  settlement CSV import), needs-action list.
- Store endpoints `GET /store/doit/carts/:id/payment` (status and `next_action` for polling, `qr_expired`) and
  `GET /store/doit/methods` (active methods with fees for the cart, out-of-limit methods marked), with cart ownership
  checks and rate limits.
- `order.metadata.doit` with method, fee and fee payer for every order paid through doit.id, and the ledger row
  recorded as soon as the order is placed.
- Reuse of a still-open invoice when the shopper switches method and comes back.
- Example components for the Medusa Next.js Starter (`examples/nextjs-starter`).
- E2E suites against a mock doit.id and an opt-in sandbox suite; CI on every push and pull request.

[Unreleased]: https://github.com/haustex/pg-medusa-doit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/haustex/pg-medusa-doit/releases/tag/v0.1.0
