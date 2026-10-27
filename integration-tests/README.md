# E2E tests

Real Medusa processes (server on :9300, worker on :9301, Redis event bus) with the packed plugin, against a
mock doit.id on :9399. Each suite gets a freshly created and migrated database.

```bash
npm run build            # test:e2e builds too
DATABASE_URL=postgres://postgres:spike@127.0.0.1:55432/doit_e2e \
REDIS_URL=redis://127.0.0.1:56379 \
npm run test:e2e         # all suites; `-- 04` runs only suites matching "04"
```

The runner refuses to start unless:

- `DATABASE_URL` points at `127.0.0.1:55432` and the database name starts with `doit_e2e` (it is dropped and
  recreated);
- `REDIS_URL` points at `127.0.0.1:56379`;
- ports 9300, 9301 and 9399 are free.

Locally these are the `doit-spike-pg` / `doit-spike-redis` containers. CI (`.github/workflows/ci.yml`)
starts Postgres and Redis services on the same ports.

| Suite | Covers |
| --- | --- |
| `suites/01-provider-webhook.mjs` | session creation, IDR/amount/rail validation, signature middleware, capture via webhook, bayar_ganda, bayar_telat, refunds |
| `suites/02-ledger.mjs` | ledger rows, DB dedupe under concurrency, perlu-tindakan items, refund totals, retries giving up, sync job |
| `suites/03-admin.mjs` | Admin API: settings, test connection, stats (seeded ledger, timezones), payments table, CSV export, withdrawals, CSV import, attention |
| `suites/04-store.mjs` | store endpoints: access rules, throttled status refresh, cart completion after paid, methods with fees, rate limits, invoice reuse, order fee note |
| `suites/05-reconcile-scope.mjs` | store marker and reference prefix; payments of other apps (`AZPOR-…`) and stores, the other mode, before the cutoff and of old versions are ignored; old items dismissed; cutoff date setting |
| `suites/06-live-key.mjs` | live key: a test payment with the store marker is ignored, own live payments are reconciled |
| `sandbox/05-sandbox.mjs` | the real doit.id sandbox (`npm run test:sandbox`), skipped without `DOIT_TEST_API_KEY` |

The sandbox suite signs webhooks locally because doit.id cannot reach localhost. Payments in the sandbox
can only be marked paid with the "Simulasikan lunas" button in the doit.id portal. To include the paid and
refund checks, set `WAIT_PAID_MS` (for example `900000`) and click the button when the suite prints
`WAITING_FOR_PAID`.

Logs of every process are written to `integration-tests/.logs/<suite>/` (or `$E2E_LOG_DIR`).
