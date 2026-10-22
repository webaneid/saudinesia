# Saudinesia — Alur Auth (ringkasan operasional)

> **Sumber kebenaran as-built: `docs/arsitektur-auth.md`** (+ `docs/arsitektur-whatsapp-verifikasi.md`, ADR-0001, ADR-0002). Dokumen ini hanya ringkasan alur
> untuk dibaca cepat. Ditulis ulang 2026-10-22 (Fase 4): versi sebelumnya (OTP WhatsApp, `verify-phone`, `resetToken`, `OtpInput`) sudah tidak berlaku
> dan seluruh kodenya dihapus.

## Prinsip

| Concern | Mekanisme |
|---------|-----------|
| Identitas | **Email** (disimpan huruf kecil). Tidak dapat diubah dari profil (SEC-17) |
| Masuk jamaah | Email + password, **atau** Google (OAuth + PKCE buatan sendiri) |
| Masuk staf (admin/manager/superadmin) | **Hanya** email + password di `/admin/login`. Google ditolak untuk staf |
| Verifikasi akun baru | Tautan email (pemilik email memilih password SETELAH mengklik — akun belum ada sebelum itu) |
| Reset password | Tautan email (30 menit, sekali pakai) |
| Kontak | Telepon + WhatsApp wajib (dua kolom, E.164) lewat "Lengkapi Data" / form daftar |
| WhatsApp | **Kanal notifikasi saja**, hanya ke nomor **terverifikasi** (pesan masuk ke nomor bisnis, webhook GOWA). Email selalu terkirim untuk semua kejadian |
| Sesi | JWT 7 hari, cookie `httpOnly; Secure; SameSite=Lax` (Lax — Strict merusak login Google dan tautan dari email; keputusan 2026-10-22) |
| Pencabutan sesi | Token membawa `ver` = `User.sessionVersion`; tiap `getSession()` memeriksa DB (akun ada, aktif, terverifikasi, versi cocok) dan membaca `role` dari DB. Versi naik saat reset password, Google disambung ke akun lama, peran/status diubah admin (termasuk reaktivasi) — `arsitektur-auth.md` §11 |

GOWA/WhatsApp bukan dependensi auth: login, daftar, dan reset tetap jalan walau GOWA mati.

## Aturan password
Minimal 8 karakter, ada huruf, angka, dan karakter spesial; maksimal **72 byte** (batas bcrypt; karakter non-ASCII dihitung per byte).

## Peran & cara akun dibuat

| Peran | Dibuat oleh | Masuk |
|-------|-------------|-------|
| `pilgrim` | Daftar mandiri (manual atau Google) | Email+password atau Google |
| `admin` / `manager` | Superadmin (Sistem → Pengguna) | Email+password |
| `superadmin` | `scripts/create-superadmin.ts` (seed hanya dev) | Email+password |

## Alur

**Daftar manual** (`/register`): nama, email, telepon, WhatsApp → respons seragam "Cek Email Anda" → email berisi tautan → `/register/complete?token=…`
(halaman menampilkan isian, **tidak** mengonsumsi token) → centang persetujuan privasi + notifikasi WhatsApp, pilih password → akun dibuat (email terverifikasi) → dashboard.
Email yang sudah terdaftar mendapat email "Anda sudah punya akun" (tanpa tautan sakti); responsnya sama persis.

**Login** (`POST /auth/login`): password salah dan akun tak ada sama-sama 401; status akun (nonaktif / email belum terverifikasi) baru diungkap setelah password benar.

**Lupa password** (`/forgot-password` → email → `/reset-password?token=…`): respons seragam; token sekali pakai; berhasil → langsung masuk.

**Google** (`GET /auth/google/start` → Google → `/auth/google/callback`): state + nonce + PKCE, ID token diverifikasi penuh.
`sub` dikenal → masuk; email cocok akun **jamaah** aktif → tersambung otomatis; staf → ditolak; pengguna baru → `/register/google` (setujui privasi) → akun dibuat → "Lengkapi Data".

**Lengkapi Data** (`/lengkapi-data`): jamaah dengan telepon/WhatsApp kosong dialihkan dari semua halaman jamaah (layout); `POST /bookings` juga menolak (422).

**Verifikasi WhatsApp** (Profil / banner dashboard): kode `VERIF XXXXXXXX` dikirim pengguna **dari nomornya ke nomor bisnis**; webhook GOWA bertanda tangan HMAC mencocokkan pengirim dengan nomor akun.
Tidak menghalangi pemesanan. Satu nomor = satu akun terverifikasi. Mengganti nomor mencabut verifikasi.

**Logout** (`POST /auth/logout`): hapus cookie.

## Rute

```
POST /api/v1/auth/register                    daftar (tanpa password; kirim tautan)
POST /api/v1/auth/registration/preview        lihat isian dari token (tidak mengonsumsi)
POST /api/v1/auth/registration/complete       token + password + persetujuan → buat akun + sesi
POST /api/v1/auth/login                       email + password → sesi
POST /api/v1/auth/logout                      hapus cookie
POST /api/v1/auth/forgot-password             kirim tautan reset (respons seragam)
POST /api/v1/auth/reset-password              token + password baru → sesi
GET/PUT /api/v1/auth/profile                  nama/alamat (TANPA email)
PUT  /api/v1/auth/contact                     telepon + WhatsApp (+ persetujuan sekali)
GET  /api/v1/auth/google/start                awal OAuth
GET  /api/v1/auth/google/callback             callback OAuth
POST /api/v1/auth/google/complete             pengguna Google baru: setujui privasi → akun
POST /api/v1/auth/whatsapp/verification       terbitkan kode verifikasi (sesi)
GET  /api/v1/auth/whatsapp/status             status verifikasi (polling)
POST /api/v1/webhooks/whatsapp                webhook GOWA (publik; HMAC; mati tanpa secret kuat)
```

## Halaman

```
/[locale]/(auth)/login · register · register/complete · register/google · forgot-password · reset-password · lengkapi-data
/[locale]/admin/login          staf: email + password
```

Evaluasi lokal tanpa layanan luar: `docs/evaluasi-lokal.md` (`bun run dev:eval`).
