# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3] - 2026-10-27

### Added

- One-time ledger cleanup on the first sync after upgrading: ledger rows of payments that are not this store's
  (another app or store on the doit.id key, the other test/live mode, or a 0.1.0/0.1.1 payment whose Medusa session
  is gone) are marked excluded (`excluded_at`, `excluded_reason`). Nothing is deleted, and rows linked to an order
  are always kept. The result is stored in the sync state `ledger-cleanup:v1`.
- Transactions: "Show excluded" filter with an "Excluded" badge and the reason; `excluded=hide|include|only` on
  `GET /admin/doit/payments` and the CSV export (new `dikecualikan` column).

### Changed

- Excluded rows are left out of every dashboard figure (cards, estimated balance, refunds, daily chart) and of
  reconciliation; refund webhooks for them are ignored. Paid rows the sync job cannot settle because they are not
  this store's are now excluded instead of only marked reconciled.
- Published under the `latest` dist-tag (`npm install medusa-payment-doit`); 0.1.0–0.1.2 were `beta`.
- Upgrading needs `npx medusa db:migrate` (new `doit_payment` columns).

## [0.1.2] - 2026-10-27

### Fixed

- Release workflow: publishing through npm trusted publishing (OIDC) failed (`E404`, then `ENEEDAUTH`). The publish
  job now uses npm 11.21+ (needed for dist-tags over OIDC) without setup-node's `registry-url` token, and first runs
  npm's OIDC token exchange itself, failing with npm's reason and the token claims. It can be run manually
  (`workflow_dispatch`) to check the npm configuration without publishing.

### Changed

- GitHub Actions upgraded to `actions/checkout@v7`, `actions/setup-node@v7` and `actions/upload-artifact@v7` (Node 24).
- Reconciliation only touches this store's payments. Payments of other apps or stores on the same doit.id key (e.g.
  `AZPOR-…` references, portal links), of the other mode (a test payment while a live key is in use, and vice versa)
  and from before the cutoff date are ignored by webhooks, the sync job and refund handling: no ledger row, no
  "Perlu tindakan" item. Open items earlier versions raised for such payments are dismissed by the next sync run.
  Payments of 0.1.0/0.1.1 (no marker yet) are still reconciled while their Medusa session exists.
- Upgrading needs `npx medusa db:migrate` (new `doit_setting` columns); until then the plugin keeps working with the
  previous settings.

### Added

- Every payment the plugin creates carries `metadata.medusa_store_id` (the Medusa store id) and a `reference` with an
  optional prefix (Settings → doit.id → Reconciliation → Reference prefix, e.g. `HK-`).
- Setting "Ignore payments before" (a date in the dashboard time zone). Default: when the API key was first saved in
  the Admin (set for existing installs by the migration).
- E2E suites for the reconciliation scope (test key) and a live key.
- README: one doit.id app per store, and a separate app for testing.

## [0.1.1] - 2026-10-25

### Changed

- Peer dependencies widened to `^2.19.0` for the `@medusajs/*` packages (and `^4.2.1` for `@medusajs/ui`, which has
  its own versioning), so the plugin installs on newer Medusa 2.x releases without overrides. Development still uses
  the 2.19.0 lock.
- The npm package now includes `examples/nextjs-starter` (components, `starter.patch` and its README), so the
  storefront example is available in `node_modules/medusa-payment-doit/examples/nextjs-starter` without cloning
  the repository.
- npm keywords for the Medusa integrations directory: `medusa-plugin-integration`, `medusa-plugin-payment`.

### Added

- CI matrix running the unit and E2E suites on Medusa 2.19.0 and 2.22.0, with the package built on the locked
  2.19.0 toolchain. `scripts/use-medusa-version.mjs` switches a checkout to another Medusa release for this.

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

[Unreleased]: https://github.com/haustex/pg-medusa-doit/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/haustex/pg-medusa-doit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/haustex/pg-medusa-doit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/haustex/pg-medusa-doit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/haustex/pg-medusa-doit/releases/tag/v0.1.0
