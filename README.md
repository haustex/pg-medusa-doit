# medusa-payment-doit

Medusa v2 payment provider for [doit.id](https://doit.id) (QRIS, Virtual Account, bank transfer).

> **Not an official doit.id product.** This is an independent, community-maintained open source plugin (MIT).
> **Bukan produk resmi doit.id.** Plugin ini dibuat dan dirawat komunitas secara independen (MIT).

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

## License

MIT
