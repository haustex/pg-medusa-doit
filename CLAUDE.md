# PG Medusa Doit.id

**PG Medusa Doit.id** by Haus Kayu, paket npm `medusa-payment-doit`, repo https://github.com/haustex/pg-medusa-doit.
Plugin open source (MIT) Medusa v2 (2.19.x) untuk payment gateway **doit.id** (PayBridge API).
**Bukan produk resmi doit.id.** Sumber API: https://doit.id/docs/ (HTML, lebih lengkap) dan https://doit.id/docs/llms.txt
(keduanya dibaca 2026-10-25). Kalau keduanya berbeda, ikuti halaman HTML.

## Aturan kerja

- **Server ini juga menjalankan toko produksi hauskayu. DILARANG mengirim request atau membuka koneksi apa pun ke port
  9000, 8001, 80, 443, 5432 (Postgres produksi) dan 6379 (Redis produksi), atau domain *.hauskayu.com, dan DILARANG
  menjalankan pm2 restart/stop/delete untuk proses hk-*.**
- **Semua perintah `medusa` / `plugin:db:*` wajib memakai `DATABASE_URL` eksplisit ke DB spike
  (`postgres://postgres:spike@127.0.0.1:55432/<db>`) dan Redis spike `127.0.0.1:56379`. Kalau env itu tidak di-set,
  batalkan.** Di repo ini pakai `npm run db:generate` (dijaga `scripts/require-spike-db.mjs`, yang menolak env kosong,
  host/port lain, `DB_HOST`/`DB_PORT` penimpa, dan Redis 6379).
  Tes hanya di port 9300+ dan container `doit-spike-*`. Cek port bebas sebelum start, batal kalau terpakai.
- Kerjakan **per fase**. Setelah satu fase selesai (build + lint + tes hijau), berhenti dan tunggu "go" dari user.
- **Jangan pernah commit API key / signing secret / kunci enkripsi.** Kredensial hanya lewat Admin (terenkripsi) atau env.
  `.env*` di-gitignore; tes integrasi membaca `DOIT_TEST_API_KEY` (`pb_test_…`) dari env, tidak di-hardcode.
- Ikuti skill `medusa-dev:building-with-medusa` (Module → Workflow → API route; mutasi lewat workflow; hanya GET/POST/DELETE;
  Zod dari `@medusajs/framework/zod` (v4); nama modul camelCase) dan `building-admin-dashboard-customizations` untuk UI.
- Validasi: `npm run build` dan `npx medusa lint` setelah setiap perubahan berarti.
- **Migrasi plugin:** `medusa plugin:db:generate` selalu mengirim `host=localhost port=5432 password=""` eksplisit, dan
  itu **menimpa `DATABASE_URL`** (terjadi 2× di Fase 2–3: konek ke DB produksi, gagal auth). Jalankan hanya lewat
  `DATABASE_URL=postgres://postgres:spike@127.0.0.1:55432/medusa-doit-ledger npm run db:generate`; guard menurunkan
  `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD` dari URL lalu menjalankan perintahnya sendiri.
- Medusa menyimpan harga apa adanya (Rp150.000 = `150000`). Jangan dikali/dibagi 100.

## Branding & identitas

- Git identity repo ini (sudah di `git config` lokal): `Haus Kayu <dev@hauskayu.com>`. Branch utama `main`.
- Nama tampilan "PG Medusa Doit.id" by Haus Kayu; paket npm tetap `medusa-payment-doit`.
- Promo Haus Kayu **halus saja**: README (tagline, "Used in production", "About Haus Kayu", "Support") dan footer di halaman
  plugin sendiri di Admin (`src/admin/components/credit-footer.tsx`, link di `src/admin/lib/branding.ts`).
- Footer Admin: "PG Medusa Doit.id · by Haus Kayu" + link "Bantuan" (WhatsApp). Bisa dimatikan lewat option plugin
  `showCredit` (default `true`), diteruskan ke UI sebagai `show_credit` di `GET /admin/doit/settings`.
- **Tanpa tracking** (hanya link biasa dengan UTM, tanpa script/pixel/request ke hauskayu.com), **tanpa promo apa pun di
  storefront/checkout pembeli**, dan disclaimer "Community plugin, not an official doit.id product" selalu tampil
  (juga saat `showCredit: false`).

## Fakta API doit.id (ringkas)

- Base URL `https://pay.doit.id`, `Authorization: Bearer <key>`. Mode ditentukan **prefix key**: `pb_test_` / `pb_live_`.
- **Setiap POST wajib `Idempotency-Key`** (tanpa itu: 400 `missing_idempotency_key`); replay → HTTP 200 dengan hasil asli.
  Timeout / 500 / 503 → ulangi dengan key yang **sama** (aman).
- **Rate limit 120 request/menit per API key.** Lewat → 429 `rate_limited` + header `Retry-After` (detik); 503
  `service_unavailable` juga membawa `Retry-After` dan **bukan** kegagalan permanen. Hormati nilainya, ulangi request yang sama.
- Amount = integer rupiah. Error: `{ error: { code, message, doc_url } }`.
- `GET /v1/methods[?amount=]` → metode yang benar-benar aktif untuk key ini (+ `fee_amount`/`total_amount` bila ada amount).
  Kandidat endpoint untuk tombol **Test koneksi** dan validasi rail di Admin.
- `POST /v1/payments` — `amount`, `reference` (1–128), `rail` (`qris|va|transfer|any`), `va_bank`
  (va: `bmri bnia brin cimb permata maybank danamon bsyi`; transfer: `bca mandiri bni bsi`), `expires_in` (≥60, default 86400),
  `return_url`, `customer`, `metadata`. Response: `id pay_…`, `status pending|paid|expired|failed|refunded`, `qr_content`,
  `va_number`, `fee_amount`, `fee_payer`, `total_amount`, `hosted_url`, `expires_at`, `paid_at`, `environment`, …
- `GET /v1/payments/{id}`, `GET /v1/payments?status=&reference=&limit<=100&before=<ISO>` → `{ data: [...] }`.
- `POST /v1/payments/{id}/refunds` (Idempotency-Key), body `{ amount?, reason? }`: `amount` opsional (default penuh);
  refund parsial boleh berulang sampai total = nominal asal. Hanya status `paid`. Error: 409 `payment_not_refundable`,
  400 `invalid_refund_amount` (melebihi sisa), 502 `provider_refund_failed` (message = alasan penyedia).
  Event `refund.succeeded|refund.failed`.
- Siklus status (hanya 5): `pending → paid → refunded`, `pending → expired → paid` (bayar telat), `pending → failed`.
- Webhook: `{ id: evt_…, type, created_at, data: payment }`. Header `PayBridge-Signature: t=<unix>,v1=<hex>`,
  `v1 = HMAC_SHA256(secret, t + "." + rawBody)`. At-least-once → dedupe `id`; percaya `status`, bukan urutan.
  Event: `payment.paid` (bisa datang setelah `payment.expired` → flag `bayar_telat`), `payment.expired`, `invoice.created`,
  `payment.proof_uploaded`, `refund.*`, `webhook.test` (balas 2xx).
- Signature: tidak ada toleransi timestamp yang didokumentasikan; contoh resmi tidak mengecek `t`. Kita pakai ±300 detik.
- Array `flags` pada objek payment ("kasus tak lazim dari penyedia"; integrasi sederhana boleh mengabaikannya). Nilai saat ini:
  - `bayar_telat`: dibayar setelah `expired`; `payment.paid` bisa datang **setelah** `payment.expired`. Kalau order sudah
    dibatalkan, merchant memutuskan: penuhi atau refund.
  - `bayar_ganda`: tagihan yang **sama** dibayar lewat **dua instrumen berbeda** (mis. pelanggan ganti metode, keduanya
    terbayar). Dana tetap tercatat dan direkap. Jadi ini satu payment id dengan kelebihan bayar, bukan dua payment.
  - `lunas_manual`: rail transfer yang dikonfirmasi manual via `POST /v1/payments/{id}/confirm`.

## Keputusan Fase 0 (kredensial)

- **Sumber kebenaran: tabel `doit_setting` (modul `doitSettings`).** Provider membacanya langsung lewat
  `__pg_connection__` (knex bersama yang diteruskan Medusa ke container setiap modul, termasuk Payment Module) dan
  mendekripsi sendiri (`src/lib/credentials.ts`). Server dan worker selalu membaca DB yang sama.
- Cache in-memory per proses hanya pelengkap: TTL 60 detik (`credentials_cache_ttl_ms`), dibersihkan langsung di proses
  yang menyimpan, dan di proses lain lewat event `doit.settings.updated` (subscriber). Dengan event-bus-redis event diterima
  satu worker saja; worker lain (kalau ada >1) paling lambat basi 60 detik.
- Enkripsi: AES-256-GCM, kunci `DOIT_ENCRYPTION_KEY` (64 hex, `openssl rand -hex 32`), AAD = nama kolom, fingerprint
  kunci (HMAC) disimpan untuk mendeteksi kunci salah tanpa mencoba dekripsi.
- Kunci hilang/rusak/salah: tidak crash. `GET /admin/doit/settings` → `encryption.status` (`missing|malformed|mismatch`) +
  pesan "Kunci enkripsi tidak valid, masukkan ulang kredensial."; provider turun ke options → env; menyimpan secret
  ditolak 400; kunci berubah → API key dan webhook secret wajib dimasukkan ulang bersamaan.
- Urutan sumber: Admin → options provider → env (`DOIT_API_KEY`, `DOIT_WEBHOOK_SECRET`). Secret selalu diambil dari sumber
  yang sama dengan API key.
- API tidak pernah mengembalikan secret: hanya `{ is_set, masked }` (4 karakter terakhir) lewat `toPublicSettings`.
- Webhook Medusa: route core `/hooks/payment/doit_doit` menjawab 200 lalu memproses di subscriber (worker) setelah
  `webhook_delay`. Sejak Fase 1 ada middleware di depannya (lihat "Keputusan Fase 1").

## Keputusan Fase 1 (provider + webhook)

- Middleware `src/api/hooks/verify-doit-signature.ts`, matcher `/hooks/payment/:provider` + `bodyParser.preserveRawBody`,
  hanya bertindak untuk param `doit_<id>` (opsi provider dicari di `configModule.modules.payment.options.providers`).
  401 `invalid_signature` (mismatch / header hilang/rusak / body hilang / `t` lewat ±300 dtk) atau
  `webhook_secret_not_configured`. (Dedupe event id: lihat Fase 2.) Worker memverifikasi HMAC ulang **tanpa** cek `t`.
- Webhook tidak pernah dipercaya sendirian: aksi `captured` → Medusa memanggil `authorizePayment` → GET ke doit.id. Payload
  palsu-bertanda-tangan untuk payment yang masih pending tidak membuat order (teruji di sandbox).
- `reference` = payment session id (`payses_…`); event dengan reference lain diabaikan. Capture memakai `amount`
  (nominal tagihan), bukan `total_amount` (bisa termasuk fee yang dibayar pembeli).
- Keputusan webhook paid (`decideWebhookAction`): sudah captured → no-op; `bayar_ganda` → capture sekali + `overpaid`;
  payment Medusa canceled → tidak capture, `late_payment_canceled`; session hilang / invoice lama / nominal beda →
  item perlu tindakan. `late_payment_policy` (`accept` default | `flag`). Sejak Fase 2 dijalankan di subscriber plugin.
- Status: pending→pending, paid/refunded→captured, expired→canceled, failed→error. Cart complete saat pending gagal
  (order baru dibuat oleh webhook / authorize setelah paid).
- `updatePayment` dengan nominal sama tidak memanggil API; nominal berubah → tagihan baru, id lama di `superseded_ids`.
- Storefront boleh mengirim `data.rail` + `data.va_bank` (divalidasi) dan `data.return_url` (http(s) ≤512) saat membuat
  session; default dari setting Admin.
- Client: token bucket 120/menit per key per proses; retry 429/5xx/timeout dengan Idempotency-Key sama, hormati
  `Retry-After` (maks `max_retry_wait_ms` 15 dtk, `max_retries` 2); `provider_refund_failed` tidak di-retry.
- Refund: Idempotency-Key = id refund Medusa; provider menolak refund melebihi sisa sendiri (sandbox tidak menolaknya).

## Keputusan Fase 2 (ledger) — menggantikan sebagian Fase 1

- Modul `doitLedger`: `doit_payment` (unik `doit_id`), `doit_event` (unik `event_id`), `doit_refund` (unik
  `doit_refund_id` dan `medusa_refund_id`), `doit_attention` ("perlu tindakan", unik `dedupe_key` = `<code>:<kunci>`),
  `doit_sync_state` (unik `key`). Semua tulisan lewat `recordDoitLedgerWorkflow` (upsert idempoten + kompensasi);
  status dari webhook tidak pernah mundur (`mergeStatus`), tetapi hasil GET dari doit.id (sync, `authoritative`) selalu
  menang; flags digabung. Sync membaca ulang payment sebelum settle, jadi status `paid` palsu/kedaluwarsa dibetulkan.
- Dedupe webhook pindah ke DB: middleware menjalankan `claimDoitEventWorkflow` sebelum Medusa me-queue. Baris sudah ada →
  `classifyRedelivery`: processed/ignored/in-flight (<5 menit atau sedang di-retry) → 200 `duplicate`; `failed` atau
  klaim lama yang tak pernah diproses → di-queue ulang. Cache in-memory Fase 1 dihapus.
- **Pemrosesan webhook pindah ke subscriber plugin** `doit-webhook-received` (event `payment.webhook_received`, worker).
  `getWebhookActionAndData` provider selalu `not_supported`, jadi handler bawaan Medusa tidak menyentuh event doit.
  Subscriber: verifikasi HMAC (tanpa `t`) → ledger → untuk `paid`: `settlePaidPayment` (state lewat **Query**, bukan baca
  tabel mentah; `decideWebhookAction`; `processPaymentWorkflow` bila perlu capture) → event `processed`. Gagal →
  `attempts+1`, error dilempar ulang supaya event bus me-retry; pada percobaan ke-`webhook_retries` (default 3) → event
  `failed` + item `webhook_failed`, tidak dilempar lagi. Sukses berikutnya menutup item itu otomatis.
- Refund: subscriber `payment.refunded` menyalin respons POST /refunds (disimpan provider di `payment.data.refunds`) ke
  `doit_refund` (source `api`); webhook `refund.succeeded|failed` (bentuk payload belum pasti: objek refund `rf_…`,
  `refund` bersarang, atau payment) di-upsert ke baris yang sama via `doit_refund_id` / `medusa_refund_id`.
  `doit_payment.refunded_amount` = jumlah refund `succeeded`. Setelah tiap perubahan dibandingkan dengan total refund
  Medusa → `refund_mismatch` bila beda atau melebihi nominal; `refund.failed` → `refund_failed`.
- Job `sync-doit-payments` (`*/15`, override env `DOIT_SYNC_CRON`), per provider doit, lock Locking Module
  (`acquire` dengan owner, lewati bila terkunci): (1) scan `GET /v1/payments?limit=100&before=` terbaru dulu sampai
  `cursor − 15 menit` (run pertama 30 hari, maks 20 halaman); (2) baca ulang `pending` + `expired` ≤3 hari yang tidak
  tersentuh scan (maks 100); (3) `paid` dengan session tapi `reconciled_at` kosong → `settlePaidPayment` (maks 50);
  (4) event `received` dengan error >30 menit → `failed` + `webhook_failed`. `reconciled_at` diisi saat captured atau
  diserahkan ke item perlu tindakan.
- Rail `cc` (muncul di pesan error sandbox) tidak ditawarkan sampai ada di dokumentasi resmi; `resolveRailBank` menolaknya.
  Rail `transfer` tetap di kode, ditandai "belum bisa dites di sandbox" di README.

## Keputusan Fase 3 (Admin)

- Halaman: `/app/doit` (Ringkasan · Transaksi · Withdraw · Perlu tindakan) dan `/app/settings/doit`. Semua lewat
  `sdk.client.fetch` (session auth); route `/admin/doit/*` otomatis butuh admin login (401 tanpa sesi, teruji).
- Agregasi di SQL (`modules/doitLedger/reports.ts`, dipanggil lewat method service `@InjectManager` + `getKnex()`):
  kartu, seri harian (`to_char(paid_at at time zone tz)`), tabel (LIMIT/OFFSET + count), export (batch 1 000, maks 50 000).
  Index tambahan: `doit_payment(paid_at)`, `(environment,status)`, `(order_id)`, `doit_refund(status,created_at)`,
  `doit_withdrawal(date)`. Batas hari: `'YYYY-MM-DD'::timestamp at time zone tz`; preset dihitung di server
  (`lib/date-range.ts`). Zona waktu di `doit_setting.timezone` (default Asia/Jakarta, divalidasi IANA).
- Mode dashboard mengikuti prefix key yang aktif: `live` = env `live|production`, `test` = `test|sandbox`; data
  tidak pernah dicampur. Withdraw menyimpan `environment` saat dicatat.
- Kartu: Sukses (status paid/refunded menurut `paid_at`), Menunggu & Gagal/Kedaluwarsa (menurut `doit_created_at`),
  Refund (doit_refund succeeded menurut `created_at`), Gross/Fee/Net, Withdraw (amount + fee). **Saldo estimasi =
  net sukses − refund sukses − withdraw (amount + biaya payout), sepanjang waktu**, berlabel "Estimasi" + penjelasan.
- Withdraw: manual (tanggal lokal `YYYY-MM-DD`, nominal, biaya payout, catatan) dan import CSV settlement. Format CSV
  portal belum terdokumentasi → kolom dikenali dari nama header (ID/EN), `dry_run` dulu (pratinjau + kolom terdeteksi),
  baris status gagal/pending dilewati, `external_ref` unik (`csv:<id>` atau hash isi baris) mencegah import ganda.
- Export CSV: waktu lokal zona dashboard, BOM UTF-8, sel diawali `= + - @` diberi `'` (anti formula injection).
- Tes koneksi: `GET /v1/methods` dengan key tersimpan atau key yang diketik (belum disimpan); rail di luar dokumentasi
  (`cc`) disaring; peringatan bila prefix key ≠ environment dari doit.id.
- UI: komponen `@medusajs/ui`, grafik SVG buatan sendiri, aksen jati Haus Kayu (`#8B5E3C` / dark `#C9925E`) hanya di
  batang grafik dan kartu saldo, teks EN/ID (`src/admin/i18n/json`, kode bahasa Admin `id`), footer kredit di kedua
  halaman ("Bantuan"/"Help" mengikuti bahasa; disclaimer tetap Inggris).

## Arsitektur

```
src/
  providers/doit/            Payment Module Provider (identifier "doit", id "doit")
    service.ts               DoitPaymentProviderService extends AbstractPaymentProvider
    client.ts                HTTP client: auth, Idempotency-Key, error mapping, rate limiter (token bucket 120/menit)
    signature.ts             parse + verify PayBridge-Signature (crypto.timingSafeEqual, toleransi waktu t)
    status.ts                mapping status doit → PaymentSessionStatus / PaymentActions
    webhook.ts               decideWebhookAction (murni) + tipe SessionState
  lib/credentials.ts         resolver kredensial: baca doit_setting via __pg_connection__, dekripsi, cache TTL
  lib/crypto.ts, mask.ts     AES-256-GCM; masking 4 karakter terakhir
  lib/public-settings.ts     satu-satunya bentuk setting yang keluar ke API (tanpa secret)
  lib/ledger.ts              mapping ledger murni: payment, refund (respons/webhook), redelivery, refund_mismatch
  lib/session-state.ts       state session/cart/order/refund Medusa lewat Query
  lib/doit-processing.ts     handleDoitWebhook, settlePaidPayment, handleMedusaRefund, checkRefundTotals
  lib/doit-sync.ts           job sync (scan, recheck, settle, stale events)
  modules/doitSettings/      kredensial + konfigurasi (AES-256-GCM, kunci dari env DOIT_ENCRYPTION_KEY)
  modules/doitLedger/        payment, event, refund, attention, sync_state, withdrawal; reports.ts (SQL dashboard)
  workflows/                 save-doit-settings, record-doit-ledger, claim-doit-event, save-doit-sync-state,
                             doit-admin (create/delete withdrawal, import settlement, resolve attention)
  subscribers/               doit-settings-updated, doit-webhook-received, doit-payment-refunded
  jobs/sync-doit-payments.ts cron */15 * * * * (DOIT_SYNC_CRON)
  api/hooks/                 middleware verifikasi signature + claim event
  api/admin/doit/...         settings, test-connection, stats, payments(+export), withdrawals(+import, [id]), attention([id]/resolve)
  admin/routes/doit/         Dashboard; admin/routes/settings/doit/ Settings; admin/components/ tab + grafik SVG
  scripts/require-spike-db.mjs  guard DB/Redis spike untuk perintah medusa (lihat Aturan kerja)
```

Webhook: `POST /hooks/payment/doit_doit` → middleware plugin (signature, claim) → route core (queue) → subscriber plugin.

## Rencana fase

### Fase 0 — Spike kredensial dari Admin
Masalah: provider di-instansiasi dengan **container Payment Module** (hanya logger, dll.), tidak bisa `resolve` modul custom.
Kandidat yang diuji, berurutan:
1. Modul `doitSettings` + provider membaca DB langsung (pg connection/`__pg_connection__` di container modul) dan dekripsi sendiri.
2. Cache proses bersama: loader/subscriber `doitSettings` menulis kredensial terdekripsi ke singleton in-process
   yang dibaca provider (perlu invalidasi saat save; cek perilaku multi-instance / worker mode).
3. Fallback: `options` di `medusa-config.ts` / env (`DOIT_API_KEY`, `DOIT_WEBHOOK_SECRET`). Admin hanya menampilkan status (read-only).
Output: PoC kecil + laporan mana yang bekerja, keputusan final dicatat di sini. Urutan prioritas runtime: Admin → options → env.
**Hasil (2026-10-25): opsi 1 dipakai** (opsi 2 ditolak karena server/worker terpisah). Lolos 54/54 check di mode shared,
server+worker terpisah, dan kunci enkripsi hilang/rusak/salah. Lihat "Keputusan Fase 0".

### Fase 1 — Payment provider
- `initiatePayment`: tolak currency ≠ IDR; amount harus integer (`Number.isInteger`, tolak pecahan); rail dari setting
  (`qris|va|transfer|any`) + `va_bank`; `expires_in`; `reference` = payment session id; `Idempotency-Key` = session id + hash input.
  Data session menyimpan `id`, `hosted_url`, `qr_content`, `va_number`, `expires_at`.
- `authorizePayment`/`getPaymentStatus`/`retrievePayment`: GET status → mapping (`pending`→pending, `paid`→authorized/captured,
  `expired|failed`→error/canceled, `refunded`→captured+refund).
- `capturePayment` no-op (doit langsung lunas), `cancelPayment` lokal (tidak ada endpoint cancel), `refundPayment` POST refunds,
  `deletePayment`/`updatePayment` (buat payment baru bila amount berubah).
- Webhook: verifikasi signature (raw body, constant time, toleransi t ±5 menit), dedupe event id (fase 1: tabel kecil / cache;
  dipindah ke ledger di fase 2). `payment.paid` → `captured`. Kasus:
  - **bayar_telat** (paid setelah expired / flag): tetap capture bila session masih ada; bila cart/order sudah dibatalkan → catat +
    tandai perlu tindakan (fulfil atau refund) di ledger; opsi `late_payment_policy: "accept" | "flag"`.
  - **bayar_ganda** (satu payment dibayar lewat dua instrumen): capture sekali saja (dedupe per payment id, bukan per event),
    catat kelebihan bayar dan tandai "perlu refund kelebihan" di dashboard; jangan auto-refund.
  - `webhook.test` & event tak dikenal → `not_supported` (200).

### Fase 2 — Modul ledger
- Model `doit_payment` (doit_id unik, reference, session/order id, gross, fee, net, fee_payer, status, rail, va_bank,
  environment, flags[], paid_at, expires_at, raw json) dan `doit_event` (event_id unik, type, payment_id, received_at, payload).
- Webhook dan sync menulis via workflow `record-doit-event` (upsert idempoten).
- Job `*/15 * * * *`: paginasi `GET /v1/payments?limit=100&before=<created_at terakhir>` sampai melewati cursor tersimpan
  (high-water mark + overlap kecil); limiter 120 req/menit + backoff saat 429; lock agar tidak jalan paralel.

### Fase 3 — Admin
- Settings: API key (masked), webhook signing secret, mode (terdeteksi dari prefix, peringatan bila tak cocok), rail default,
  bank VA, expiry, tombol **Test koneksi** (GET /v1/payments?limit=1), URL webhook siap copy.
- Dashboard: filter hari/minggu/bulan/custom; kartu sukses/menunggu/gagal/refund; gross/fee/net; saldo estimasi
  (net paid − refund − withdraw − settlement terimport, fee payout Rp10.000/transfer); withdraw manual; import CSV settlement;
  grafik harian; export CSV. Zona waktu Asia/Jakarta.
- Setiap halaman plugin memakai `<CreditFooter showCredit={settings.show_credit} />` di bagian bawah.

### Fase 4 — Tes
- Unit (jest + @swc/jest): signature (valid, salah, t kedaluwarsa, header rusak, panjang beda), mapping status, validasi amount/currency.
- Integrasi (`@medusajs/test-utils`, skip otomatis tanpa `DOIT_TEST_API_KEY`): create → get → list sandbox, webhook end-to-end.

### Fase 5 — Rilis
- README EN + ID (instalasi, konfigurasi, webhook, disclaimer "Community plugin, not an official doit.id product",
  section branding yang sudah ada tetap dipertahankan), CHANGELOG (Keep a Changelog),
  GitHub Actions: CI (build/lint/test) + publish npm `--provenance` saat tag `v*` (permissions `id-token: write`).

## Pertanyaan terbuka

Terjawab oleh https://doit.id/docs/ (HTML): definisi `bayar_ganda`/`bayar_telat` dan bahwa keduanya ada di array `flags`;
rate limit 120/menit + `Retry-After`; Idempotency-Key wajib di semua POST; body refund `{ amount?, reason? }` + kode error.

Hasil sandbox `pb_test_` (2026-10-25, Fase 1):
- `environment` pada payment/methods bernilai `"test"` (bukan `sandbox`). Payment lama memuat `customer.email`.
- Respons refund: `{ id: rf_…, payment_id, amount, status: "succeeded", reason }` (langsung `succeeded`).
- Status tetap `paid` setelah refund parsial **dan** setelah refund melebihi nominal; tidak berubah ke `refunded`.
- **Sandbox menerima refund melebihi sisa** (201, bukan 400 `invalid_refund_amount` seperti di docs).
- Rail `transfer` ditolak sandbox: 400 `invalid_request` "rail wajib 'qris', 'va', 'cc', atau 'any'" (ada rail `cc`
  yang tidak didokumentasikan).
- Replay Idempotency-Key dengan body berbeda → 200 dengan payment asli.
- `GET /v1/payments` terbaru dulu; `before=<created_at>` eksklusif terhadap `created_at` (tanpa tumpang tindih).

Masih terbuka:
- `bayar_ganda`: field mana yang memuat jumlah kelebihan bayar / instrumen kedua? `amount` tetap nominal tagihan?
  Webhook mana yang dikirim untuk pembayaran kedua (`payment.paid` lagi dengan id event baru?).
- Refund untuk `bayar_ganda`: bisakah `amount` melebihi nominal tagihan untuk mengembalikan kelebihan bayar?
- Bentuk payload webhook `refund.succeeded|refund.failed` (objek refund atau payment?).
- Kapan status menjadi `refunded` di live (sandbox tidak pernah).
- Toleransi timestamp signature dan apakah `v1` bisa berisi lebih dari satu signature saat rotasi secret.
- Rail `transfer` butuh live key untuk mutasi; di sandbox mungkin terbatas.

## Status

- [x] Fase 0 · [x] Fase 1 · [x] Fase 2 · [x] Fase 3 · [ ] Fase 4 · [ ] Fase 5
