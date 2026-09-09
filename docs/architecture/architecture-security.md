# Architecture — Security

> Diadopsi dari template `master-typescript` (2026-09-10), ditulis ulang
> berdasarkan audit langsung ke kode project ini — BUKAN copy generik dari
> template. Prinsip: defense in depth — tiap layer harus aman secara
> independen, seolah layer lain bisa gagal/dilewati.

## Ralat Terhadap `CLAUDE.md`

`CLAUDE.md` § Tech Stack menulis "Auth | WhatsApp OTP via GOWA ... — no
NextAuth", yang bisa terbaca seolah-olah TIDAK ada password sama sekali.
Verifikasi ke kode (`app/api/v1/auth/login/route.ts`,
`app/api/v1/auth/register/route.ts`, `app/api/v1/auth/reset-password/route.ts`)
menunjukkan login sebenarnya **email + password** (`bcryptjs`, kolom
`User.passwordHash`) — WhatsApp OTP dipakai untuk **verifikasi akun saat
registrasi** (`User.isActive` di-gate sampai OTP dikonfirmasi), bukan sebagai
mekanisme login berkelanjutan. Dua-duanya benar, cuma `CLAUDE.md` tidak
eksplisit sebut ada jalur password — perlu diupdate biar tidak menyesatkan
pembaca baru.

## 1. Secrets & Environment
- Semua secret (DB password, JWT secret, MinIO keys, GOWA API key) di
  `.env`/`.env.local`, **tidak pernah** di kode/commit — dikonfirmasi
  `.gitignore` sudah exclude `.env`/`.env.local`/`.env.*.local` sejak awal.
- `.env.example` sudah ada tanpa nilai asli.
- **Hook `.claude/hooks/secret-scan.sh` otomatis block commit** kalau
  terdeteksi pola secret (API key, private key, connection string) — lihat
  `.claude/hooks/README.md`.
- Belum ada secret manager (Doppler/Infisical/dsb) — `.env` manual di VPS
  Hostinger. Belum jadi masalah akut untuk skala saat ini, tapi kalau tim
  bertambah, rotasi manual makin rawan lupa.

## 2. Input Validation (API layer)
- Semua Route Handler di `app/api/v1/` WAJIB validasi lewat Zod schema
  (`lib/validators/`) sebelum menyentuh Prisma — `CLAUDE.md` § API
  Conventions sudah eksplisit soal ini, dan sebagian besar route yang
  diperiksa (`auth/login`, dsb) konsisten memakainya (`.safeParse()`).
- Sanitize input yang akan ditampilkan sebagai HTML (Tiptap rich text) —
  render lewat `generateHTML(json, extensions)` sisi server dari JSON yang
  tersimpan, bukan trust HTML mentah dari client (`CLAUDE.md` § Tiptap).

## 3. Database (Prisma)
- Prisma query builder = parameterized query otomatis → aman dari SQL
  injection selama tidak pakai `$queryRaw`/`$executeRaw` dengan string
  concatenation manual.
- Kalau terpaksa raw SQL, WAJIB pakai parameter binding Prisma
  (`prisma.$queryRaw\`... WHERE id = ${id}\``), **jangan pernah** manual
  string interpolation — dan tambahkan komentar kenapa ORM tidak cukup
  (`CLAUDE.md` § Prisma).
- Quota writes selalu di dalam `prisma.$transaction([...])` untuk cegah
  race condition (`CLAUDE.md` § Prisma, `lib/quota/`) — pola ini sudah ada
  dan wajib dipertahankan untuk modul quota baru.
- Backup: **belum ada sebelum retrofit ini** — lihat `docs/RETROFIT-GAPS.md`
  #1. Sekarang sudah ada `scripts/backup-db.sh`/`restore-db.sh` (diadaptasi
  dari template, generik lewat env var) — **masih perlu dijadwalkan manual**
  lewat crontab VPS, belum otomatis jalan.

## 4. Authentication & Authorization
- **Login**: email + password, hash `bcryptjs` (`app/api/v1/auth/login/route.ts`).
  Pesan error sama untuk "user tidak ada" dan "password salah" — sudah benar,
  mencegah email enumeration.
- **Verifikasi akun**: WhatsApp OTP via GOWA saat registrasi, `User.isActive`
  di-gate sampai OTP dikonfirmasi. Rate limit OTP: maks 3 request per nomor
  per 10 menit, dicek lewat counter Redis (`ioredis` sudah jadi dependency)
  di `lib/auth/otp.ts` (`CLAUDE.md` § WhatsApp Gateway).
- Session: JWT, disimpan `httpOnly; Secure; SameSite=Strict` cookie
  (`CLAUDE.md` § Security) — bukan localStorage.
- Role check: `middleware.ts` cek `ADMIN_ROLES`/`SUPERADMIN_ROLES` di level
  edge untuk redirect awal, **tapi** tiap Route Handler admin/superadmin
  WAJIB re-check role sendiri lewat `lib/auth/session.ts`
  (`requireAdmin()`/`requireSuperadmin()`) — middleware saja tidak cukup,
  ini aturan eksplisit yang sudah dipegang project ini.
- 5 role: `pilgrim`, `agent`, `admin`, `manager`, `superadmin`
  (`prisma/schema.prisma` `enum UserRole`).
- **Belum ada** implementasi UU PDP secara formal (consent record, privacy
  policy aktif, mekanisme hapus/ekspor data pribadi) — lihat
  `docs/RETROFIT-GAPS.md` #2, risiko Tinggi karena data yang diproses
  termasuk paspor/KTP/KK jamaah.

## 5. Frontend (Next.js)
- Default Server Components (`CLAUDE.md` § Component Conventions) — data
  sensitif idealnya di-fetch di server, bukan Client Component.
- Session JWT `httpOnly` cookie sudah mitigasi pencurian token lewat XSS
  (JS client tidak bisa baca cookie-nya).
- Jangan taruh secret apa pun di variable `NEXT_PUBLIC_*` — otomatis
  ter-bundle ke client-side JS dan bisa dibaca siapa saja.
- Belum ada Content-Security-Policy header eksplisit di `next.config.ts` —
  belum terverifikasi ada/tidaknya, cek manual kalau butuh proteksi XSS
  tambahan di luar React's default escaping.

## 6. Rate Limiting
Sudah ada untuk OTP (lihat § 4, Redis counter). **Belum diverifikasi** ada
rate limit serupa untuk endpoint `login`/`register`/`reset-password` —
kandidat cek lanjutan kalau ada laporan brute-force, karena keduanya juga
endpoint sensitif per `security-review` checklist.

## 7. File Upload (MinIO)
- Validasi MIME type + ukuran **server-side**: whitelist `image/jpeg`,
  `image/png`, `application/pdf`, maks 5 MB (`CLAUDE.md` § MinIO) — bukan
  cuma trust `Content-Type` header dari client.
- Object key digenerate server-side: `{entity}/{entity_id}/{doc_type}/{unix_ms}-{sanitized_filename}`
  — bukan nama file asli mentah dari client (mitigasi path traversal &
  collision).
- Bucket `saudinesia-docs` privat by default — akses lewat presigned URL
  saja (TTL 15 menit preview, 60 menit ZIP download), tidak pernah
  di-public-kan. Ini penting karena dokumen yang disimpan adalah data
  pribadi sensitif (paspor/KTP/KK).
- Semua panggilan SDK MinIO lewat `lib/storage/minio.ts` — tidak ada raw
  SDK usage di tempat lain (`CLAUDE.md` § MinIO).

## 8. Payment (Manual Bank Transfer)
Tidak pakai payment gateway pihak ketiga — model `Payment` (`buktiTransferPath`,
`confirmedById`, status `pending/confirmed/rejected`) + model `Refund`
terpisah, dikonfirmasi manual oleh admin/manager/superadmin.
- [ ] **Perlu diverifikasi manual**: endpoint konfirmasi pembayaran
      benar-benar cek role admin di server (bukan cuma disembunyikan di UI) —
      jalankan skill `security-review` saat menyentuh route ini.
- `totalAmount` booking sudah 100% server-computed (bukan trust dari client)
  per `docs/arsitektur-booking.md` Step 5 — pola yang benar, pertahankan
  untuk modul baru.

## 9. Dependency & Supply Chain
- `bun audit` belum jadi kebiasaan rutin/CI — **hook baru**
  `.claude/hooks/dependency-audit.sh` (diadopsi 2026-09-10) akan
  mengingatkan otomatis tiap `bun add`, tapi belum ada jadwal audit berkala
  untuk dependency yang sudah terpasang lama.
- Belum ada `.github/workflows/` sama sekali di project ini — tidak ada CI
  yang menjalankan build/typecheck/audit otomatis per push.

## 10. Logging & Monitoring
- **Belum ada** structured logging atau error tracking (Sentry/dst) — cuma
  `console.error` tersebar (165 titik per audit retrofit 2026-09-10), hilang
  begitu container restart. Lihat `docs/RETROFIT-GAPS.md` #3.
- `CLAUDE.md` § Security sudah eksplisit larang log PII jamaah (paspor,
  DOB, KTP) — aturan ini penting dipertahankan begitu observability
  tooling akhirnya ditambahkan (jangan sampai structured logger malah
  ikut nge-log field sensitif by default).

## Referensi Enforcement
- `.claude/hooks/secret-scan.sh` — block commit kalau ada secret ter-hardcode.
- `.claude/hooks/security-review-reminder.sh` — reminder otomatis (warning,
  bukan block) supaya skill `security-review` tidak kelupaan dipanggil kalau
  edit file security-sensitive (Route Handler/auth/upload/webhook/payment/
  middleware) terjadi di luar sesi yang sadar mengikuti checklist ini.
- `.claude/hooks/README.md` — daftar hook lain (lint, guard branch, dst).
- Checklist ringkas versi `CLAUDE.md` root ada di bagian "## Security".
