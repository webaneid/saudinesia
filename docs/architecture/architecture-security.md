# Architecture — Security

> Diadopsi dari template `master-typescript` (2026-09-10), ditulis ulang
> berdasarkan audit langsung ke kode project ini — BUKAN copy generik dari
> template. Prinsip: defense in depth — tiap layer harus aman secara
> independen, seolah layer lain bisa gagal/dilewati.

## Ralat Terhadap `CLAUDE.md`

> **Diperbarui 2026-10-21 (ADR-0001):** catatan ralat lama di sini (OTP WhatsApp untuk verifikasi) sudah tidak berlaku —
> OTP WhatsApp dihapus total dari auth. `CLAUDE.md` § Tech Stack kini menjelaskan auth berbasis email. Detail: `docs/arsitektur-auth.md`.

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
- **Verifikasi akun & pemulihan**: tautan email (Resend) — `lib/auth/tokens.ts`: token 256-bit, hanya hash SHA-256 di DB,
  sekali pakai (klaim atomik), kedaluwarsa singkat (daftar 24 jam, reset 30 menit). Pendaftaran manual **tidak membuat
  akun** sampai pemilik email mengklik tautan dan memilih passwordnya sendiri (menutup pre-hijacking). Halaman tautan
  tidak mengonsumsi token (pemindai email melakukan GET); konsumsi lewat POST. Respons daftar/lupa password seragam
  (anti-enumerasi); login mengungkap status akun hanya setelah password benar. Login mensyaratkan `isActive` DAN `emailVerifiedAt`.
  Pengiriman dibatasi `lib/auth/rateLimit.ts` (§ 6). (Riwayat: sampai 2026-10-21 verifikasi memakai OTP WhatsApp.)
- **Sambung otomatis Google berdasarkan email** (docs/arsitektur-auth.md §3.3): risiko sisa yang diterima — pemilik domain Google Workspace atau alamat email yang didaur ulang bisa memperoleh `email_verified=true` untuk alamat yang dulu dipakai orang lain. Sama kelasnya dengan reset password lewat email; staf dikecualikan sepenuhnya. Alias Gmail (titik/`+tag`) tidak digabung → akun ganda, bukan pengambilalihan.
- **Email = identitas**: `PUT /auth/profile` tidak menerima `email` (SEC-17); mengganti email butuh fitur terpisah dengan verifikasi email baru.
- Session: JWT, disimpan `httpOnly; Secure; SameSite=Strict` cookie
  (`CLAUDE.md` § Security) — bukan localStorage.
- Role check: `middleware.ts` cek `ADMIN_ROLES`/`SUPERADMIN_ROLES` di level
  edge untuk redirect awal, **tapi** tiap Route Handler admin/superadmin
  WAJIB re-check role sendiri lewat `lib/auth/session.ts`
  (`requireAdmin()`/`requireSuperadmin()`) — middleware saja tidak cukup,
  ini aturan eksplisit yang sudah dipegang project ini.
- **Perilaku dev fail-closed**: tautan email auth dicetak ke log server (tak pernah ke respons), `APP_URL` default, dan bypass
  rate limit hanya aktif bila `NODE_ENV === 'development'` persis (SEC-02). Pola `!== 'production'` membuat `NODE_ENV` yang
  salah/kosong di lingkungan terdeploy membocorkan tautan pengambilalihan akun. (Endpoint `GET /api/v1/dev/otp` sudah dihapus.)
- **Mass assignment**: body request tidak boleh langsung ke `prisma.*.create/update` — parse dengan Zod `.strict()`
  (`lib/validators/adminUpdates.ts` contoh), supaya field `passwordHash`/`role`/`bookedQuota`, dst. tidak bisa diubah (SEC-03).
- **Pembuatan superadmin pertama** hanya lewat `scripts/create-superadmin.ts` (tanpa kredensial default; `db:seed` tidak
  boleh dipakai di production — menghapus data dan membuat `admin@saudinesia.local` / `Admin@1234`).
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
- Header keamanan dipasang di **Caddy** (`Caddyfile`): HSTS, `nosniff`, `Referrer-Policy`, dan anti-clickjacking
  (`frame-ancestors 'self'` + `X-Frame-Options SAMEORIGIN`) untuk domain aplikasi. **`Content-Security-Policy` penuh
  (`script-src`, dst.) belum ada** — Next.js/Tiptap butuh nonce (smart-ai memasangnya di `proxy.ts`); SEC-06. Tidak ada
  `dangerouslySetInnerHTML`/`innerHTML` di kode (diverifikasi 2026-10-21), jadi XSS bergantung pada escaping React.

## 6. Rate Limiting
**Aktif sejak SEC-04 (2026-10-21)** — `lib/auth/rateLimit.ts`, semua angka di `LIMITS` (satu tempat).

| Endpoint | Batas |
|---|---|
| `auth/login` | semua percobaan per IP: 20 / 15 mnt · **gagal** per akun+IP: 5 / 15 mnt · **gagal** per akun (dari mana pun): 30 / jam. Hanya yang gagal dihitung; sukses mereset |
| `auth/register`, `auth/forgot-password` | email auth per IP: 10 / jam · per alamat: 3 / 10 mnt — dihitung **sebelum** mencari akun dan sama untuk email ada/tidak (429 tidak membocorkan keberadaan) |
| `auth/registration/preview`, `auth/registration/complete` | per IP: 30 / 10 mnt (token 256-bit tak bisa ditebak; ini pembatas kasar) |
| `auth/reset-password` | per IP: 10 / jam |
| `admin/system/integrations/test-email` | per admin: 5 / jam |

- **Penyimpanan**: counter jendela-tetap di Redis, atomik lewat skrip Lua (INCR + EXPIRE pada hit pertama; kunci tanpa
  TTL disembuhkan). Redis tidak terjangkau → jatuh ke memori proses (aplikasi 1 replika), dengan circuit breaker 10 detik
  agar tidak menunggu timeout tiap request. Redis mati **tidak** berarti pembatasan hilang; memori ter-reset saat restart.
- **IP klien**: `X-Forwarded-For` yang **ditimpa Caddy** dengan alamat koneksi sebenarnya (tak bisa dipalsukan klien selama
  container web tidak di-publish langsung — compose production tidak mem-publish port web). Tanpa IP yang valid, hanya batas
  berbasis identitas yang berlaku. Next.js sendiri mengisi header ini dari alamat koneksi bila tidak ada (dev: `::1`).
- **Identitas panjang** di-hash (> 128 karakter) supaya kunci tidak bisa digelembungkan; memori dibatasi 50.000 kunci.
- **Dev**: `RATE_LIMIT_DISABLED=true` hanya berlaku bila `NODE_ENV=development` (fail-closed).
- **Pengujian**: `bun run test` (`scripts/test-rate-limit.ts`) — memori, Redis mati, dan (di CI, `REDIS_TEST_URL`) Redis
  sungguhan dengan pembacaan kunci lewat klien terpisah; job `docker` CI menguji limiter di image produksi dengan Redis nyata.
- **Risiko sisa** (SEC-14/15): penyerang terdistribusi bisa mengunci login satu akun (30 gagal/jam) dan mengunci
  forgot-password satu email (3/10 mnt) — kompromi umum "lockout vs brute-force"; belum ada mekanisme buka-kunci admin.

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
- CI (`.github/workflows/ci.yml`, sejak 2026-10-21): `bun audit --audit-level=critical` **memblokir**; ringkasan high/moderate
  tampil sebagai peringatan sampai SEC-05 dibereskan (lalu naikkan ke `--audit-level=high`). `gitleaks` memindai riwayat commit.
- Dependabot mingguan (`.github/dependabot.yml`): npm (minor/patch digabung), `github-actions`, `docker`.
- Hook `.claude/hooks/dependency-audit.sh` mengingatkan tiap `bun add`.
- Status audit 2026-10-21: Next.js 15.5.18 punya 2 Critical (RCE Image Optimization) → dinaikkan ke 15.5.28 (SEC-01,
  Selesai). Tersisa 34 advisory (17 high, 15 moderate, 2 low) — perlu triase runtime vs build-time (SEC-05, Terbuka).
- Action GitHub dipin ke tag, bukan SHA (SEC-11, Low).

## 10. Logging & Monitoring
- **Belum ada** structured logging atau error tracking (Sentry/dst) — cuma
  `console.error` tersebar (165 titik per audit retrofit 2026-09-10), hilang
  begitu container restart. Lihat `docs/RETROFIT-GAPS.md` #3.
- `CLAUDE.md` § Security sudah eksplisit larang log PII jamaah (paspor,
  DOB, KTP) — aturan ini penting dipertahankan begitu observability
  tooling akhirnya ditambahkan (jangan sampai structured logger malah
  ikut nge-log field sensitif by default).

## 11. Infrastruktur, Container & CI/CD
Berlaku untuk `Dockerfile`, `docker-compose.prod.yml`, `Caddyfile`, `.github/workflows/*`, `scripts/*`, `.env*.example`
(detail rancangan: `docs/deployment.md`).
- **Image**: berjalan sebagai user `bun` (non-root); `.dockerignore` mengecualikan `.env*`, `.git`, `docs`, `.claude`,
  `scripts` (kecuali `create-superadmin.ts`); job CI `docker` memeriksa image web tidak memuat `.env`/docs/`.git` dan bukan root.
  `ARG NEXT_PUBLIC_*` terlihat di riwayat image — memang informasi publik, **jangan pernah** menaruh rahasia di `ARG`/`ENV`.
- **Compose**: hanya Caddy yang mem-publish port (80/443); Postgres, Redis, MinIO (termasuk console :9001) hanya jaringan
  internal; batas memori/CPU per service; rotasi log. Belum ada `no-new-privileges`/`cap_drop`, Redis tanpa password,
  `POSTGRES_PASSWORD` terbaca container web (SEC-10, Low).
- **Rahasia**: `.env.production` dan `.env.deploy` ada di `.gitignore` (dibuat di server oleh `scripts/buat-env-production.sh`,
  izin 600, tidak menampilkan rahasia). Hanya `*.example` yang ter-commit. NEXT_PUBLIC_* = GitHub **Variables**, bukan Secrets.
- **Storage**: URL presigned ditandatangani atas host publik (`MINIO_PUBLIC_URL`) — bucket tetap privat; host file di Caddy
  hanya GET/HEAD dan `frame-ancestors` hanya domain aplikasi (preview PDF memakai iframe).
- **Workflow**: `permissions: contents: read` per job; tidak memakai `pull_request_target`; `minio-image.yml` baru boleh
  `packages: write` dan hanya di `push` ke `main`/dispatch manual.
- **Akun awal**: lihat § 4 (`create-superadmin.ts`).
- **Tidak bisa diverifikasi dari kode**: hardening SSH/firewall VPS, rahasia Actions hanya di Secrets, branch protection
  GitHub (harus diatur pemilik repo — `docs/deployment.md` §3).

## 12. Proses (SOP)
Security check adalah **langkah wajib** di `CLAUDE.md` § Fase Eksekusi SOP (langkah 5) dan § Milestone SOP (langkah 2):
skill `security-review` untuk file yang berubah, subagent `security-auditor` untuk fase besar, `bun audit`; Critical/High
pada kode fase itu diperbaiki sebelum fase ditutup; Medium/Low dan temuan pre-existing dicatat di Register Temuan Security
(`docs/lessons-learned.md`). Pola ini mengikuti langkah "Security check" pada SOP smart-ai (repo terpisah).

## Referensi Enforcement
- `.claude/hooks/secret-scan.sh` — block commit kalau ada secret ter-hardcode.
- `.claude/hooks/security-review-reminder.sh` — reminder otomatis (warning,
  bukan block) supaya skill `security-review` tidak kelupaan dipanggil kalau
  edit file security-sensitive (Route Handler/auth/upload/webhook/payment/
  middleware) terjadi di luar sesi yang sadar mengikuti checklist ini.
- Hook pengingat kini juga mengenali file infra (Dockerfile, compose, Caddyfile, workflow, skrip, `.env*.example`,
  `next.config.ts`, `instrumentation*.ts`) dan `lib/auth|storage`/OTP/session (2026-10-21).
- CI: `bun audit --audit-level=critical` (memblokir), gitleaks, Dependabot.
- `.claude/hooks/README.md` — daftar hook lain (lint, guard branch, dst).
- Checklist ringkas versi `CLAUDE.md` root ada di bagian "## Security".
