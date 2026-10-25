# PG Medusa Doit.id

**Terima QRIS, VA, dan transfer di Medusa lewat doit.id. Dibuat dan dipakai sendiri oleh Haus Kayu.**
<br>Accept QRIS, Virtual Account and bank transfer in Medusa v2 through doit.id. Built and used in production by Haus Kayu.

[![npm](https://img.shields.io/npm/v/medusa-payment-doit)](https://www.npmjs.com/package/medusa-payment-doit)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```bash
npm install medusa-payment-doit
```

> **Community plugin, not an official doit.id product.** Independent open source (MIT), not affiliated with or endorsed by doit.id.
> **Plugin komunitas, bukan produk resmi doit.id.** Open source independen (MIT), tidak berafiliasi dengan doit.id.

> 🚧 Work in progress. Full documentation comes with the first release.

[English](#english) · [Bahasa Indonesia](#bahasa-indonesia)

---

## English

### Encryption key (`DOIT_ENCRYPTION_KEY`)

The API key and webhook signing secret you enter in the Medusa Admin are stored encrypted (AES-256-GCM).
The plugin needs a 32-byte key, written as 64 hexadecimal characters. Generate one with:

```bash
openssl rand -hex 32
```

Put it in your environment (for example `.env`, never in git), and use **the same value for the server and the worker**:

```bash
DOIT_ENCRYPTION_KEY=<output of openssl rand -hex 32>
```

- If the key is missing, malformed, or different from the one used to save the credentials, the plugin keeps running.
  The Admin shows **"Kunci enkripsi tidak valid, masukkan ulang kredensial."** (the encryption key is invalid, re-enter
  the credentials), and payments fall back to provider options or the `DOIT_API_KEY` / `DOIT_WEBHOOK_SECRET` env vars when set.
- Changing the key makes stored credentials unreadable. After changing it, re-enter the API key and webhook secret in the Admin.
- Back up the key together with your database: without it the stored credentials cannot be recovered.

### Payment methods (`rail`)

| Rail | What the customer gets | Status |
|---|---|---|
| `qris` | QR code (`qr_content`) and the hosted page | Tested on the doit.id sandbox |
| `va` + `va_bank` | Virtual Account number. Banks: `bmri` `bnia` `brin` `cimb` `permata` `maybank` `danamon` `bsyi` | Tested on the doit.id sandbox |
| `any` | The customer picks the method on the doit.id hosted page | Supported |
| `transfer` + `va_bank` (`bca` `mandiri` `bni` `bsi`) | Bank transfer to your own account, confirmed from account mutations | ⚠️ **Not yet testable on the sandbox.** The sandbox rejects this rail; it needs a live key and a Mutasi Rekening subscription. The code follows the documentation but is unverified. |

The default rail is set in the Admin. The storefront may pass `rail` / `va_bank` (validated) and `return_url` in the
payment session `data`. Only rails in the official doit.id documentation are offered.

### Webhook and reconciliation

- Webhook URL in the doit.id portal: `https://<your-medusa-backend>/hooks/payment/doit_doit`. Requests with a missing or
  wrong `PayBridge-Signature`, or a timestamp more than 5 minutes off, are answered `401`.
- Every delivery is recorded by event id (unique in the database), so redeliveries are answered `200` without being
  processed twice, across any number of server and worker processes.
- A job every 15 minutes re-reads payments from doit.id and completes orders whose payment is `paid` at doit.id but still
  pending in Medusa (for example when a webhook was lost).
- Cases that need a person (double payment, payment after an order was canceled, refund totals that do not match,
  webhooks that failed after 3 attempts) are recorded as "perlu tindakan" items; nothing is refunded automatically.

---

## Bahasa Indonesia

### Kunci enkripsi (`DOIT_ENCRYPTION_KEY`)

API key dan webhook signing secret yang kamu isi di Medusa Admin disimpan dalam bentuk terenkripsi (AES-256-GCM).
Plugin butuh kunci 32 byte, ditulis sebagai 64 karakter heksadesimal. Buat dengan:

```bash
openssl rand -hex 32
```

Simpan di environment (misalnya `.env`, jangan pernah di git), dan pakai **nilai yang sama untuk server dan worker**:

```bash
DOIT_ENCRYPTION_KEY=<hasil openssl rand -hex 32>
```

- Kalau kunci tidak ada, formatnya salah, atau berbeda dari kunci saat kredensial disimpan, plugin tetap berjalan.
  Admin menampilkan **"Kunci enkripsi tidak valid, masukkan ulang kredensial."**, dan pembayaran memakai options provider atau
  env `DOIT_API_KEY` / `DOIT_WEBHOOK_SECRET` bila diisi.
- Mengganti kunci membuat kredensial lama tidak bisa dibaca. Setelah mengganti, isi ulang API key dan webhook secret di Admin.
- Backup kunci bersama database: tanpa kunci itu, kredensial yang tersimpan tidak bisa dipulihkan.

### Metode pembayaran (`rail`)

| Rail | Yang diterima pembeli | Status |
|---|---|---|
| `qris` | Kode QR (`qr_content`) dan halaman bayar hosted | Sudah dites di sandbox doit.id |
| `va` + `va_bank` | Nomor Virtual Account. Bank: `bmri` `bnia` `brin` `cimb` `permata` `maybank` `danamon` `bsyi` | Sudah dites di sandbox doit.id |
| `any` | Pembeli memilih metode di halaman bayar hosted doit.id | Didukung |
| `transfer` + `va_bank` (`bca` `mandiri` `bni` `bsi`) | Transfer ke rekening sendiri, dikonfirmasi dari mutasi rekening | ⚠️ **Belum bisa dites di sandbox.** Sandbox menolak rail ini; butuh live key dan langganan Mutasi Rekening. Kode mengikuti dokumentasi tetapi belum terverifikasi. |

Rail default diatur di Admin. Storefront boleh mengirim `rail` / `va_bank` (divalidasi) dan `return_url` di `data`
payment session. Hanya rail yang ada di dokumentasi resmi doit.id yang ditawarkan.

### Webhook dan rekonsiliasi

- Webhook URL di portal doit.id: `https://<backend-medusa-kamu>/hooks/payment/doit_doit`. Request tanpa
  `PayBridge-Signature` yang benar, atau dengan timestamp lebih dari 5 menit, dijawab `401`.
- Setiap kiriman dicatat per event id (unik di database), jadi kiriman ulang dijawab `200` tanpa diproses dua kali,
  berapa pun jumlah proses server dan worker.
- Job tiap 15 menit membaca ulang pembayaran dari doit.id dan menyelesaikan order yang sudah `paid` di doit.id tetapi
  masih pending di Medusa (misalnya karena webhook hilang).
- Kasus yang perlu keputusan orang (bayar ganda, bayar setelah order dibatalkan, total refund tidak cocok, webhook yang
  gagal setelah 3 kali) dicatat sebagai item "perlu tindakan"; tidak ada refund otomatis.

---

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

## License

[MIT](LICENSE) © Haus Kayu
