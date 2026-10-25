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
