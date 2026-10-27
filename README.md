# PG Medusa Doit.id

**Terima QRIS, VA, dan transfer di Medusa lewat doit.id. Dibuat dan dipakai sendiri oleh Haus Kayu.**
<br>Accept QRIS, Virtual Account and bank transfer in Medusa v2 through doit.id. Built and used in production by Haus Kayu.

[![npm](https://img.shields.io/npm/v/medusa-payment-doit/beta?label=npm%40beta)](https://www.npmjs.com/package/medusa-payment-doit)
[![CI](https://github.com/haustex/pg-medusa-doit/actions/workflows/ci.yml/badge.svg)](https://github.com/haustex/pg-medusa-doit/actions/workflows/ci.yml)
[![Medusa](https://img.shields.io/badge/Medusa-2.19%20%E2%80%93%202.22-7c3aed)](https://medusajs.com)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```bash
npm install medusa-payment-doit@beta
```

> **Community plugin, not an official doit.id product.** Independent open source (MIT), not affiliated with or endorsed by doit.id.
> **Plugin komunitas, bukan produk resmi doit.id.** Open source independen (MIT), tidak berafiliasi dengan doit.id.

[English](#english) · [Bahasa Indonesia](#bahasa-indonesia)

| Admin dashboard | Storefront (Next.js Starter) |
| --- | --- |
| ![Admin overview](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/admin-overview.jpg) | ![Method picker with fees](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/storefront-method-picker.jpg) |
| ![Transactions](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/admin-transactions.jpg) | ![QRIS](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/storefront-qris.jpg) ![VA](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/storefront-va.jpg) |

More: [settings](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/admin-settings.jpg) · [withdrawals](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/admin-withdrawals.jpg) ·
[needs action](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/admin-attention.jpg) · [Bahasa Indonesia UI](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/admin-ringkasan-id.jpg) ·
[VA on mobile](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/storefront-va-mobile.jpg) · [order confirmed](https://raw.githubusercontent.com/haustex/pg-medusa-doit/main/docs/screenshots/storefront-order-confirmed.jpg)

---

## English

### Features

- **Payment provider** for Medusa 2.19+: QRIS, Virtual Account (8 banks), the doit.id hosted page (`any`), and bank
  transfer (`transfer`, see [Limitations](#limitations)). Amounts are whole rupiah, exactly as Medusa stores them.
- **Credentials in the Admin**, encrypted with AES-256-GCM. Falls back to provider options or env vars.
- **Webhooks**: signature checked on the raw body (HMAC-SHA256, ±5 min), deduplicated by event id in the database,
  processed by the worker with retries. A webhook is never trusted alone: Medusa re-reads the payment from doit.id
  before capturing.
- **Reconciliation job** every 15 minutes: completes orders whose webhook was lost and corrects the ledger.
- **Ledger and "needs action" list** for double payments (`bayar_ganda`), payments after cancellation (`bayar_telat`),
  refund mismatches and failed webhooks. Nothing is refunded automatically.
- **Admin dashboard**: totals, fees, net, an estimated balance, a daily chart, transactions with CSV export,
  withdrawals (manual or settlement CSV import). English and Indonesian.
- **Storefront API** for a "waiting for payment" screen, plus a drop-in example for the Medusa Next.js Starter: method
  picker with fees, QRIS code, VA number with a copy button, countdown, polling and the hosted-page option.
- **Fees on the order**: `order.metadata.doit` records the method, the fee and who paid it.
- **Invoice reuse**: if a shopper switches method and comes back, the invoice that is still open is used again.

### Requirements

- Medusa **2.19 or newer 2.x** (tested in CI on 2.19.0 and 2.22.0), Node 20.19+ or 22.12+
- Redis for the event bus, workflow engine and locking (strongly recommended; webhooks are processed in the worker)
- A doit.id account: `pb_test_…` key for the sandbox, `pb_live_…` for production

### Installation

```bash
npm install medusa-payment-doit@beta
```

`medusa-config.ts`:

```ts
module.exports = defineConfig({
  // …
  plugins: [{ resolve: "medusa-payment-doit", options: {} }],
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "medusa-payment-doit/providers/doit",
            id: "doit",
            options: {
              // all optional; the Admin settings take precedence
              // rail: "qris", va_bank: "bmri", expires_in: 86400, late_payment_policy: "accept",
            },
          },
        ],
      },
    },
  ],
})
```

Then run the migrations and set the encryption key:

```bash
npx medusa db:migrate
echo "DOIT_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env   # same value on server and worker
```

Finally enable **doit.id** (`pp_doit_doit`) as a payment provider in your **IDR** region.

### Configuration

Open **Settings → doit.id** in the Admin:

1. Paste the API key (`pb_test_…` or `pb_live_…`) and the webhook signing secret. Both are stored encrypted and shown
   masked. The mode (test/live) follows the key prefix.
2. Pick the default method (QRIS, a VA bank, `any`), how long invoices stay valid, and the dashboard time zone.
3. Click **Test connection**: it lists the methods active on your doit.id account.

Lookup order for credentials: Admin → provider `options` (`api_key`, `webhook_secret`) → env (`DOIT_API_KEY`,
`DOIT_WEBHOOK_SECRET`). The secret always comes from the same source as the key.

| Env var | Purpose |
| --- | --- |
| `DOIT_ENCRYPTION_KEY` | 64 hex chars (`openssl rand -hex 32`). Required to store credentials in the Admin. Same value on server and worker; back it up with the database. |
| `DOIT_API_KEY`, `DOIT_WEBHOOK_SECRET` | Fallback credentials when nothing is saved in the Admin. |
| `DOIT_SYNC_CRON` | Schedule of the reconciliation job (default `*/15 * * * *`). |

If the encryption key is missing, malformed or different from the one used to save the credentials, the plugin keeps
running: the Admin shows **"Kunci enkripsi tidak valid, masukkan ulang kredensial."** and payments fall back to options
or env. After changing the key, re-enter the API key and the secret.

### One doit.id app per store

doit.id's payment list and webhooks cover **everything on an API key**. Use **one doit.id app (key) per store**, and a
**separate app with a `pb_test_` key for testing and staging**. Don't share a key between two shops, or between
production and a staging copy.

The plugin still guards against sharing. Every payment it creates carries `metadata.medusa_store_id` (this Medusa's
store id) and a reference like `HK-payses_…`. Reconciliation (webhooks, the 15-minute job, refunds) only touches
payments with this store's marker. These are ignored: no ledger row, never listed under "Needs action":

- payments of other apps or stores on the same key (e.g. references like `AZPOR-…`, portal payment links);
- payments of the other mode (a test payment while a live key is in use, and the other way round);
- payments created before **Settings → doit.id → Reconciliation → "Ignore payments before"**. The default is when the
  API key was first saved in the Admin.

Payments made by plugin 0.1.0/0.1.1 (no marker yet) are still reconciled while their Medusa session exists. Items that
earlier versions raised for payments that are not this store's are dismissed automatically by the next job run.
The optional reference prefix (same page) only makes your payments easy to recognise in the doit.id portal.

### Webhook setup

1. In the doit.id portal, set the webhook URL to `https://<your-medusa-backend>/hooks/payment/doit_doit`
   (the Admin settings page shows it with a copy button).
2. Copy the signing secret from the portal into **Settings → doit.id**.
3. Send a test event from the portal; it is answered `200`.

Requests with a missing or wrong `PayBridge-Signature`, or a timestamp more than 5 minutes off, get `401`.
Redeliveries are answered `200` and not processed twice. If a webhook is lost, the 15-minute job completes the order.

### Fees: who pays them

doit.id sets the fee payer **per method in the doit.id portal** (Payment Methods). The API has no parameter for it, so
the plugin cannot change it. QRIS fees are always paid by the merchant (Bank Indonesia rule).

- `fee_payer: "merchant"`: the shopper pays the order total; the fee is deducted from your settlement.
- `fee_payer: "customer"`: the shopper pays the order total **plus** the fee (`total_amount`). Medusa still captures
  the order total (`amount`).

To keep this transparent, the plugin:

- shows each method's fee and the total to pay **before** the shopper picks it (`GET /store/doit/methods`, used by the
  example method picker), and shows methods outside their amount limits as disabled;
- writes `order.metadata.doit` when the order is placed: `payment_id`, `rail`, `va_bank`, `amount`, `fee_amount`,
  `fee_payer`, `total_amount`, `customer_fee`, `merchant_fee`, `paid_at`, `environment`;
- stores `fee_amount`, `fee_payer`, `total_amount` and `net_amount` in the ledger; the dashboard reports gross, fee and net.

### Storefront integration

The provider works with any storefront: create a payment session for `pp_doit_doit` and optionally pass
`data: { rail, va_bank, return_url }`. The session data contains `qr_content`, `va_number`, `hosted_url`,
`expires_at`, `fee_amount` and `total_amount`. The order is created when the payment is paid, so the storefront waits
for it with two endpoints (publishable key required):

| Endpoint | Returns |
| --- | --- |
| `GET /store/doit/methods?cart_id=` | Active methods with fee and total for this cart, the Admin default. Cached 5 min. |
| `GET /store/doit/carts/:id/payment` | Payment status and `next_action`: `wait` (poll again after `poll_after_ms`), `complete_cart` (paid: complete the cart), `view_order`, `retry`. `qr_expired: true` when the QR image ran out before the invoice: send the shopper to `hosted_url`. |

Access rules: the cart must belong to the publishable key's sales channel, and a registered customer's cart answers only
to that customer (otherwise `404`). Only display fields are returned. Rate limits: 40/min per cart and 120/min per IP
for the status, 20/min per cart and 30/min per IP for methods (in memory, per server process). doit.id is read at most
once per 10 seconds per payment.

**Medusa Next.js Starter:** copy-in components and a patch in
[`examples/nextjs-starter`](examples/nextjs-starter/README.md), also shipped in the npm package
(`node_modules/medusa-payment-doit/examples/nextjs-starter`).

Switching method creates a new invoice. Switching back to a method whose invoice is still open (same cart, same amount,
VA with ≥5 minutes left, QRIS whose QR is still issued) reuses that invoice.

### FAQ

**Sandbox payments stay pending.** In the sandbox, payments are marked paid with the "Simulasikan lunas" button in the
doit.id portal. There is no API for it.

**Webhooks don't arrive on localhost.** doit.id cannot reach your machine. The storefront polling endpoint and the
15-minute job complete orders anyway; use a tunnel if you want to test webhooks.

**The shopper paid but the order is missing.** Check **doit.id → Needs action** in the Admin. A payment whose cart or
session no longer exists, or arrived after the order was canceled, is listed there for you to fulfil or refund.

**The dashboard balance differs from doit.id.** It is an estimate (net of successful payments − refunds − withdrawals).
doit.id has no balance API; check the portal before withdrawing.

**I see payments of another app or a staging store in doit.id, but not in the dashboard.** That is intended: only
payments carrying this store's marker are reconciled. Use one doit.id app per store (see above).

**Can I use another currency?** No. doit.id charges in IDR only, and sessions in other currencies are rejected.

### Limitations

- **IDR only**, whole rupiah.
- **No balance or settlement API** at doit.id: the balance is estimated; settlements are entered manually or imported from CSV.
- **`transfer` rail not yet tested**: the sandbox rejects it (it needs a live key and a Mutasi Rekening subscription).
  The code follows the documentation but is unverified.
- **Old invoices cannot be cancelled**: doit.id has no cancel endpoint. An invoice the shopper abandoned stays payable
  until it expires; if it is paid anyway, it shows up under "Needs action".
- **`bayar_ganda`** (paid twice) is captured once and flagged; the excess has to be refunded by hand.
- The sandbox accepts refunds above the remaining amount; the plugin checks this itself.
- Storefront rate limits are kept per process.

### Security

- Credentials are encrypted at rest (AES-256-GCM, column-bound) and never returned by the API (only the last 4 characters).
- Webhook signatures are verified on the raw body in constant time; payment status is always re-read from doit.id
  before an order is captured.
- Admin endpoints require an admin session; store endpoints check cart ownership and are rate limited.
- No tracking: the Admin credit is a plain link; nothing is added to your storefront.

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

---

## Bahasa Indonesia

### Fitur

- **Payment provider** untuk Medusa 2.19+: QRIS, Virtual Account (8 bank), halaman bayar hosted doit.id (`any`), dan
  transfer bank (`transfer`, lihat [Batasan](#batasan)). Nominal rupiah utuh, persis seperti disimpan Medusa.
- **Kredensial di Admin**, terenkripsi AES-256-GCM, dengan cadangan dari options provider atau env.
- **Webhook**: signature dicek pada raw body (HMAC-SHA256, ±5 menit), dedupe per event id di database, diproses worker
  dengan retry. Webhook tidak pernah dipercaya sendirian: Medusa membaca ulang status dari doit.id sebelum capture.
- **Job rekonsiliasi** tiap 15 menit: menyelesaikan order yang webhook-nya hilang dan membetulkan ledger.
- **Ledger dan daftar "perlu tindakan"** untuk bayar ganda (`bayar_ganda`), bayar setelah dibatalkan (`bayar_telat`),
  refund yang tidak cocok, dan webhook gagal. Tidak ada refund otomatis.
- **Dashboard Admin**: total, fee, net, saldo estimasi, grafik harian, transaksi dengan export CSV, withdraw (manual
  atau import CSV settlement). Bahasa Inggris dan Indonesia.
- **Store API** untuk layar "menunggu pembayaran", plus contoh siap pakai untuk Medusa Next.js Starter: pilih metode
  beserta biayanya, kode QRIS, nomor VA dengan tombol salin, hitung mundur, polling, dan opsi halaman hosted.
- **Fee tercatat di order**: `order.metadata.doit` berisi metode, biaya, dan siapa yang menanggung.
- **Pakai ulang invoice**: kalau pembeli ganti metode lalu kembali, invoice yang masih aktif dipakai lagi.

### Kebutuhan

- Medusa **2.19 atau 2.x yang lebih baru** (dites di CI pada 2.19.0 dan 2.22.0), Node 20.19+ atau 22.12+
- Redis untuk event bus, workflow engine, dan locking (sangat disarankan; webhook diproses di worker)
- Akun doit.id: key `pb_test_…` untuk sandbox, `pb_live_…` untuk produksi

### Instalasi

```bash
npm install medusa-payment-doit@beta
```

Tambahkan plugin dan provider di `medusa-config.ts` (contoh lengkap di bagian English di atas): `plugins` berisi
`{ resolve: "medusa-payment-doit" }` dan provider Payment Module `{ resolve: "medusa-payment-doit/providers/doit", id: "doit" }`.

```bash
npx medusa db:migrate
echo "DOIT_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env   # nilai sama di server dan worker
```

Lalu aktifkan **doit.id** (`pp_doit_doit`) sebagai payment provider di region **IDR**.

### Konfigurasi

Buka **Pengaturan → doit.id** di Admin:

1. Tempel API key (`pb_test_…` atau `pb_live_…`) dan webhook signing secret. Keduanya disimpan terenkripsi dan tampil
   tersamar. Mode test/live mengikuti prefix key.
2. Pilih metode default (QRIS, bank VA, `any`), masa berlaku tagihan, dan zona waktu dashboard.
3. Klik **Tes koneksi**: muncul daftar metode yang aktif di akun doit.id kamu.

Urutan sumber kredensial: Admin → `options` provider (`api_key`, `webhook_secret`) → env (`DOIT_API_KEY`,
`DOIT_WEBHOOK_SECRET`). Secret selalu diambil dari sumber yang sama dengan key.

| Env | Fungsi |
| --- | --- |
| `DOIT_ENCRYPTION_KEY` | 64 karakter hex (`openssl rand -hex 32`). Wajib untuk menyimpan kredensial di Admin. Sama di server dan worker; backup bersama database. |
| `DOIT_API_KEY`, `DOIT_WEBHOOK_SECRET` | Kredensial cadangan bila belum ada yang disimpan di Admin. |
| `DOIT_SYNC_CRON` | Jadwal job rekonsiliasi (default `*/15 * * * *`). |

Kalau kunci enkripsi hilang, rusak, atau berbeda dari kunci saat kredensial disimpan, plugin tetap jalan: Admin
menampilkan **"Kunci enkripsi tidak valid, masukkan ulang kredensial."** dan pembayaran memakai options atau env. Setelah
mengganti kunci, isi ulang API key dan secret.

### Satu aplikasi doit.id per toko

Daftar pembayaran dan webhook doit.id mencakup **semua transaksi pada satu API key**. Pakai **satu aplikasi doit.id (key)
per toko**, dan **aplikasi terpisah dengan key `pb_test_` untuk testing dan staging**. Jangan berbagi key antara dua
toko, atau antara produksi dan salinan staging.

Plugin tetap menjaga kalau key terlanjur dipakai bersama. Setiap pembayaran yang dibuatnya membawa
`metadata.medusa_store_id` (id store Medusa ini) dan referensi seperti `HK-payses_…`. Rekonsiliasi (webhook, job 15
menit, refund) hanya menyentuh pembayaran dengan penanda toko ini. Yang berikut diabaikan: tidak masuk ledger, tidak
pernah masuk "Perlu tindakan":

- pembayaran aplikasi atau toko lain pada key yang sama (mis. referensi `AZPOR-…`, link bayar dari portal);
- pembayaran mode lain (pembayaran test saat key live dipakai, dan sebaliknya);
- pembayaran yang dibuat sebelum **Pengaturan → doit.id → Rekonsiliasi → "Abaikan pembayaran sebelum"**. Defaultnya
  saat API key pertama kali disimpan di Admin.

Pembayaran dari plugin 0.1.0/0.1.1 (belum ada penanda) tetap direkonsiliasi selama session Medusa-nya masih ada. Item
yang dulu dibuat versi lama untuk pembayaran yang bukan milik toko ini ditutup otomatis pada job berikutnya. Prefix
referensi (opsional, halaman yang sama) hanya supaya pembayaranmu mudah dikenali di portal doit.id.

### Setup webhook

1. Di portal doit.id, isi webhook URL `https://<backend-medusa-kamu>/hooks/payment/doit_doit` (halaman pengaturan Admin
   menampilkannya dengan tombol salin).
2. Salin signing secret dari portal ke **Pengaturan → doit.id**.
3. Kirim event tes dari portal; dijawab `200`.

Request tanpa `PayBridge-Signature` yang benar, atau dengan timestamp lebih dari 5 menit, dijawab `401`. Kiriman ulang
dijawab `200` tanpa diproses dua kali. Kalau webhook hilang, job 15 menit menyelesaikan order-nya.

### Fee: siapa yang menanggung

doit.id mengatur penanggung biaya **per metode di portal doit.id** (Metode Pembayaran). API tidak punya parameter untuk
itu, jadi plugin tidak bisa mengubahnya. Biaya QRIS selalu ditanggung merchant (ketentuan Bank Indonesia).

- `fee_payer: "merchant"`: pembeli membayar total order; biaya dipotong dari settlement kamu.
- `fee_payer: "customer"`: pembeli membayar total order **ditambah** biaya (`total_amount`). Medusa tetap meng-capture
  total order (`amount`).

Supaya transparan, plugin:

- menampilkan biaya dan total yang dibayar per metode **sebelum** pembeli memilih (`GET /store/doit/methods`, dipakai
  komponen contoh), dan menampilkan metode di luar batas nominal dalam keadaan nonaktif;
- menulis `order.metadata.doit` saat order dibuat: `payment_id`, `rail`, `va_bank`, `amount`, `fee_amount`,
  `fee_payer`, `total_amount`, `customer_fee`, `merchant_fee`, `paid_at`, `environment`;
- menyimpan `fee_amount`, `fee_payer`, `total_amount`, dan `net_amount` di ledger; dashboard menampilkan gross, fee, dan net.

### Integrasi storefront

Provider bisa dipakai storefront apa pun: buat payment session `pp_doit_doit` dan (opsional) kirim
`data: { rail, va_bank, return_url }`. Data session berisi `qr_content`, `va_number`, `hosted_url`, `expires_at`,
`fee_amount`, dan `total_amount`. Order baru dibuat setelah lunas, jadi storefront menunggu lewat dua endpoint
(wajib publishable key):

| Endpoint | Isi |
| --- | --- |
| `GET /store/doit/methods?cart_id=` | Metode aktif beserta biaya dan total untuk cart ini, plus default Admin. Cache 5 menit. |
| `GET /store/doit/carts/:id/payment` | Status dan `next_action`: `wait` (poll lagi setelah `poll_after_ms`), `complete_cart` (lunas: selesaikan cart), `view_order`, `retry`. `qr_expired: true` bila gambar QR habis sebelum tagihan: arahkan pembeli ke `hosted_url`. |

Aturan akses: cart harus milik sales channel publishable key, dan cart customer terdaftar hanya untuk customer itu
(selain itu `404`). Hanya field tampilan yang dikembalikan. Rate limit: status 40/menit per cart dan 120/menit per IP,
methods 20/menit per cart dan 30/menit per IP (di memori, per proses server). doit.id dibaca paling sering sekali per
10 detik per pembayaran.

**Medusa Next.js Starter:** komponen dan patch di [`examples/nextjs-starter`](examples/nextjs-starter/README.md),
ikut di paket npm (`node_modules/medusa-payment-doit/examples/nextjs-starter`).

Ganti metode membuat invoice baru. Kembali ke metode yang invoice-nya masih aktif (cart dan nominal sama, VA sisa ≥5
menit, QRIS yang QR-nya masih terbit) memakai ulang invoice itu.

### FAQ

**Pembayaran sandbox tetap pending.** Di sandbox, pembayaran dilunasi lewat tombol "Simulasikan lunas" di portal
doit.id. Tidak ada API untuk itu.

**Webhook tidak sampai ke localhost.** doit.id tidak bisa menjangkau komputermu. Endpoint polling storefront dan job 15
menit tetap menyelesaikan order; pakai tunnel kalau mau mengetes webhook.

**Pembeli sudah bayar tapi order tidak ada.** Cek **doit.id → Perlu tindakan** di Admin. Pembayaran yang cart/session-nya
sudah tidak ada, atau datang setelah order dibatalkan, tercatat di sana untuk dipenuhi atau direfund.

**Saldo dashboard beda dengan doit.id.** Itu estimasi (net pembayaran sukses − refund − withdraw). doit.id tidak punya
API saldo; cek portal sebelum menarik dana.

**Di doit.id ada pembayaran aplikasi lain atau toko staging, tapi tidak muncul di dashboard.** Memang begitu: hanya
pembayaran dengan penanda toko ini yang direkonsiliasi. Pakai satu aplikasi doit.id per toko (lihat di atas).

**Bisa pakai mata uang lain?** Tidak. doit.id hanya menerima IDR; session dengan mata uang lain ditolak.

### Batasan

- **Hanya IDR**, rupiah utuh.
- **Tidak ada API saldo atau settlement** di doit.id: saldo berupa estimasi; settlement dicatat manual atau import CSV.
- **Rail `transfer` belum teruji**: sandbox menolaknya (butuh live key dan langganan Mutasi Rekening). Kode mengikuti
  dokumentasi tetapi belum terverifikasi.
- **Invoice lama tidak bisa dibatalkan**: doit.id tidak punya endpoint cancel. Invoice yang ditinggalkan pembeli tetap
  bisa dibayar sampai kedaluwarsa; kalau tetap dibayar, muncul di "Perlu tindakan".
- **`bayar_ganda`** di-capture sekali dan ditandai; kelebihan bayar direfund manual.
- Sandbox menerima refund melebihi sisa; plugin memeriksanya sendiri.
- Rate limit storefront disimpan per proses.

### Keamanan

- Kredensial terenkripsi (AES-256-GCM, terikat ke kolom) dan tidak pernah dikembalikan API (hanya 4 karakter terakhir).
- Signature webhook diverifikasi pada raw body secara constant time; status selalu dibaca ulang dari doit.id sebelum capture.
- Endpoint Admin butuh sesi admin; endpoint store memeriksa kepemilikan cart dan diberi rate limit.
- Tanpa tracking: kredit di Admin hanya link biasa; tidak ada apa pun yang ditambahkan ke storefront.

Laporkan celah keamanan secara privat: lihat [SECURITY.md](SECURITY.md).

---

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm run test:unit && npm run build
# E2E (Postgres + Redis on the spike ports, see integration-tests/README.md)
DATABASE_URL=postgres://postgres:spike@127.0.0.1:55432/doit_e2e REDIS_URL=redis://127.0.0.1:56379 npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## Used in production

- [hauskayu.com](https://hauskayu.com/?utm_source=github&utm_medium=readme&utm_campaign=pg-medusa-doit), Haus Kayu's own store.

Using this plugin in your store? Open a pull request to add it here.
<br>Pakai plugin ini di tokomu? Kirim pull request untuk menambahkannya di sini.

## About Haus Kayu

[Haus Kayu](https://hauskayu.com/?utm_source=github&utm_medium=readme&utm_campaign=pg-medusa-doit) makes handcrafted
teak kitchenware and furniture in Jepara, Indonesia. We built this plugin for our own Medusa store and share it so other
Indonesian merchants don't have to start from scratch.

Haus Kayu membuat perkakas dapur dan furnitur jati buatan tangan dari Jepara. Plugin ini kami buat untuk toko Medusa kami
sendiri dan kami bagikan supaya merchant Indonesia lain tidak perlu mulai dari nol.

## Support

- Bugs & feature requests: [GitHub Issues](https://github.com/haustex/pg-medusa-doit/issues)
- Email: [dev@hauskayu.com](mailto:dev@hauskayu.com)
- WhatsApp: [chat with Haus Kayu](https://wa.me/6285111663330?text=Halo%20Haus%20Kayu%2C%20saya%20mau%20tanya%20soal%20PG%20Medusa%20Doit.id)

For questions about your doit.id account, fees or settlement, contact doit.id directly at care@doit.id.
<br>Untuk pertanyaan soal akun doit.id, biaya, atau pencairan dana, hubungi doit.id langsung di care@doit.id.

### Admin credit / Kredit di Admin

The plugin's own Admin pages show a small "PG Medusa Doit.id · by Haus Kayu" footer with a help link. It is plain
links only: no tracking, no scripts, and nothing is shown on your storefront or checkout. Turn it off with:

```ts
// medusa-config.ts
plugins: [{ resolve: "medusa-payment-doit", options: { showCredit: false } }]
```

The disclaimer stays visible. / Disclaimer tetap tampil.

## Disclaimer

PG Medusa Doit.id is a community plugin, **not an official doit.id product**, and is not affiliated with or endorsed by
doit.id. "doit.id" is used only to describe compatibility. Test with a sandbox key before going live.
<br>PG Medusa Doit.id adalah plugin komunitas, **bukan produk resmi doit.id**, dan tidak berafiliasi dengan doit.id.
Tes dengan key sandbox sebelum dipakai live.

## License

[MIT](LICENSE) © Haus Kayu
