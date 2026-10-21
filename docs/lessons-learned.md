# Lessons Learned

> Format tiap entri: tanggal, masalah, penyebab/fix, pencegahan.
> Dua fungsi: (1) **Register Temuan Security** di bawah — tempat WAJIB mencatat temuan Medium/Low dan Critical/High yang
> belum selesai (CLAUDE.md § Fase Eksekusi SOP langkah 5); (2) pelajaran dari bug/insiden yang layak diingat.
> Pola mengikuti `smartai/docs/lessons-learned.md`.

---

## Register Temuan Security

Status: **Selesai** (sudah diperbaiki, ada bukti verifikasi) · **Terbuka** (belum) · **Diterima** (risiko diterima sadar, alasan tertulis).
Severity mengikuti `.claude/agents/security-auditor.md`. **Pre-existing** = kode sudah ada sebelum fase yang menemukannya.
Temuan Critical/High yang Terbuka WAJIB Selesai sebelum go-live (`docs/progress.md` M15).

Sumber: security review pertama, 2026-10-21 (audit mekanis 125 `route.ts` + pembacaan manual rute/infra baru + `bun audit`).

| ID | Severity | Status | Temuan | Lokasi | Pre-existing |
|---|---|---|---|---|---|
| SEC-01 | **Critical** | Selesai 2026-10-21 | Next.js 15.5.18: 2 advisory critical (RCE tanpa autentikasi di Image Optimization API; RCE di server Windows) + 3 high (DoS Server Actions, 2× SSRF). Diperbaiki dengan `next` → 15.5.28 (`bun audit --audit-level=critical` kini bersih) | `package.json`, `bun.lock` | ya |
| SEC-02 | **High** | Selesai 2026-10-21 | Perilaku dev **fail-open**: `isDev = NODE_ENV !== 'production'` membuat OTP tampil di response HTTP (`devCode`) dan **tidak dikirim lewat WhatsApp** di lingkungan mana pun yang NODE_ENV-nya salah/kosong; `forgot-password` + `verify-reset-otp` + `reset-password` = pengambilalihan akun siapa pun. `GET /api/v1/dev/otp` dan bypass `checkRateLimit` punya pola sama. Kini hanya `NODE_ENV === 'development'` persis | `auth/register`, `auth/forgot-password`, `dev/otp`, `lib/auth/otp.ts` | ya |
| SEC-03 | Medium | Selesai 2026-10-21 | Mass assignment: `prisma.hajiProduct.update({ data: body })` (manager) dan `prisma.user.update({ data: body })` (superadmin) — body mentah bisa mengubah `bookedQuota`/`pendingQuota`, `passwordHash`, `resetToken`, `email`, dst. Diganti skema Zod `.strict()` (`lib/validators/adminUpdates.ts`); `totalQuota` tak boleh di bawah kuota terpesan | `admin/products/haji/[id]`, `admin/system/users/[id]` | ya |
| SEC-04 | **High** | **Selesai 2026-10-21** (jalur Redis menunggu hasil CI) | ~~Tidak ada rate limit~~ di `login`, `register`, `forgot-password`, `reset-password`, `verify-phone`, `verify-reset-otp`; `checkRateLimit()` tidak dipanggil siapa pun; OTP 6 digit bisa di-brute-force. Kini `lib/auth/rateLimit.ts` (Redis + fallback memori, Lua atomik) dipasang di keenam rute dengan batas per IP, per akun, per nomor/email, dan batas percobaan salah OTP (OTP dibatalkan di kegagalan ke-5). Angka & perilaku: `architecture-security.md` § 6. Terbukti lokal: 14 uji unit (memori + Redis mati), uji mutasi, 43 dari 44 pemeriksaan HTTP terhadap server berjalan lolos (1 gagal karena premis uji keliru, lalu jalur itu diuji lewat pemanggilan handler langsung). **Dibuktikan di CI**: uji dengan Redis nyata (`validate`) dan limiter di image produksi + kunci ada di Redis (`docker`) | `lib/auth/rateLimit.ts`, `lib/auth/otpVerify.ts`, `app/api/v1/auth/*` | ya |
| SEC-05 | **High** | **Terbuka** | 17 advisory high tersisa di dependency (34 total: 17 high, 15 moderate, 2 low). Perlu triase *runtime vs build-time*: `sharp` via Next (libvips/librsvg — optimizer gambar; app memakai custom loader), `prosemirror-view` (XSS pada paste — editor Tiptap), `markdown-it`/`linkify-it` (DoS kuadratik), serta tooling build (`browserslist`, `postcss`, `braces`, `nanoid`, `source-map-js`). Dependabot kini dipasang | `bun.lock` | ya |
| SEC-06 | Medium | Selesai 2026-10-21 (sebagian) | Tidak ada `Content-Security-Policy`/`frame-ancestors` dari aplikasi; domain aplikasi bisa di-frame pihak lain (clickjacking). `Caddyfile` kini memasang `frame-ancestors 'self'` untuk domain aplikasi. **CSP penuh (script-src dst.) belum** — Tiptap/Next butuh nonce; kerjakan sebagai fase sendiri | `Caddyfile`, `next.config.ts` | sebagian |
| SEC-07 | Medium | Terbuka | 11 rute **stub** `ok(null)` yang menerima semua method **tanpa auth** dan membalas sukses (POST → 201) tanpa melakukan apa pun: `admin/hotels`, `admin/muthowif`, `admin/seasons`, `admin/bookings/[id]/status`, `admin/notifications`, `admin/reports`, `groups`, `groups/[id]`, `groups/[id]/invite`, `pilgrims/[bookingId]`, `pilgrims/[bookingId]/[pilgrimId]`. Tidak membocorkan data, tapi menyesatkan (klien mengira berhasil) dan memperlebar permukaan serang. `groups`/`pilgrims` mungkin kerangka modul Group Booking — putuskan hapus atau beri auth + 501 | `app/api/v1/…` | ya |
| SEC-08 | Medium | Terbuka | Banyak rute admin memakai `catch { return 403 }` — **semua** error (validasi, DB, bug) dilaporkan sebagai "Forbidden", menyembunyikan kegagalan & menyulitkan deteksi serangan. POST `catering`/`haji`/`seasons` juga membangun `data` dari `b.x` tanpa Zod (`+b.price` → `NaN` → error DB → 403). Pola benar: lihat `admin/deletion-requests/[id]` (Zod + 401/403/500 terpisah) | `app/api/v1/admin/products/*` | ya |
| SEC-09 | Low | Selesai 2026-10-21 | `lib/whatsapp/client.ts` mencatat **nomor telepon** penerima di log saat gagal kirim (PII di log; `CLAUDE.md` melarang PII jamaah di log). Ditutup saat klien WA dirombak (hasil dikembalikan, nomor tidak lagi masuk log) — dibuktikan `scripts/test-notify.ts` | `lib/whatsapp/client.ts:60` | ya |
| SEC-10 | Low | Terbuka | Hardening container belum: tanpa `security_opt: no-new-privileges`/`cap_drop`; Redis tanpa password (hanya jaringan internal); `POSTGRES_PASSWORD` ikut terbaca container `web` lewat `env_file`; nilai `ARG NEXT_PUBLIC_*` terlihat di riwayat image (memang informasi publik) | `docker-compose.prod.yml`, `Dockerfile` | tidak |
| SEC-11 | Low | Terbuka | GitHub Actions dipin ke tag (`@v7`), bukan commit SHA → rentan supply-chain bila tag dipindah. Dependabot (mingguan, termasuk `github-actions`) kini membantu menaikkan versi | `.github/workflows/*` | tidak |
| SEC-12 | Low | Terbuka | `PATCH /admin/deletion-requests/[id]` bisa memproses ulang permintaan yang sudah `completed`/`rejected` (menimpa `processedBy`/`processedAt` → jejak audit UU PDP berubah). Tambahkan guard `status = pending` | `admin/deletion-requests/[id]` | tidak |
| SEC-13 | Low | Terbuka | Superadmin bisa menurunkan role / menonaktifkan **akunnya sendiri** atau superadmin terakhir lewat `PUT /admin/system/users/[id]` → terkunci dari sistem (pemulihan butuh `create-superadmin --additional`) | `admin/system/users/[id]` | ya |
| SEC-14 | Low | Terbuka | Lockout-DoS: penyerang terdistribusi dapat mengunci login satu akun (30 gagal/jam) atau forgot-password satu email (3/10 mnt) — kompromi inheren rate limit. Belum ada buka-kunci oleh admin / CAPTCHA. Bila jadi masalah: tombol "reset pembatasan" superadmin (`reset()` sudah ada) | `lib/auth/rateLimit.ts` | tidak |
| SEC-15 | Low | Terbuka | `forgot-password` masih membedakan respons "email punya nomor WA terverifikasi" (`masked: '0812***789'`) dari "tidak" (`masked: null`) → enumerasi email terdaftar (kini dibatasi 10 permintaan/IP/jam, tapi tidak hilang). Samakan bentuk respons | `auth/forgot-password` | ya |
| SEC-16 | Low | Terbuka | Email notifikasi dikirim ke alamat akun yang **belum terverifikasi** (registrasi email+password hanya memverifikasi nomor WA, bukan email). Orang yang mendaftar dengan email korban bisa membuat korban menerima email booking/pembayaran bermerek Saudinesia (terbatas pada booking milik penyerang sendiri; tanpa tautan sensitif, isi tetap kode booking & status). Mitigasi: Google login menetapkan `emailVerifiedAt` dan `notify` bisa dibatasi ke email terverifikasi; opsi lain, verifikasi email saat registrasi (docs/arsitektur-login-google.md) | `lib/notifications/notify.ts` | tidak |

**Tidak bisa diverifikasi dari kode** (perlu cek manual saat server ada): hardening SSH/firewall VPS, rahasia GitHub Actions
benar-benar hanya di Secrets, izin akses repo, apakah WAF/CDN dipakai, dan perilaku `X-Forwarded-For` di balik proxy sungguhan.

---

## 2026-10-21 — Security review pertama: yang lolos CI & tipe tetap bisa berbahaya

**Masalah:** SOP lama tidak punya langkah security check; skill `security-review`, subagent, dan hook pengingat ada tapi tidak
ada yang mewajibkannya. Review pertama (register di atas) menemukan 1 Critical, 2 High (1 selesai, 1 terbuka), dan temuan
Medium/Low — hampir semuanya **sudah ada sebelum** pekerjaan hari itu, dan tidak satu pun tertangkap typecheck/build/CI.

**Penyebab:** (1) dependency tidak pernah diaudit di CI; (2) aturan keamanan hanya tertulis di `CLAUDE.md` tanpa pengecekan
nyata — mis. rate limit OTP "aktif" menurut dokumen tapi fungsinya tidak pernah dipanggil; (3) skill/agent hasil adaptasi
template masih membawa sisa Elysia (`t.Any()`, `apps/api/src`) yang tidak berlaku di Next.js + Prisma sehingga auditor
mencari pola yang salah; (4) checklist tidak mencakup infra (Dockerfile, compose, Caddyfile, workflow, skrip).

**Fix:** langkah **Security check** ditambahkan ke SOP (CLAUDE.md); `bun audit --audit-level=critical` memblokir CI;
Dependabot; skill & agent disesuaikan (+ checklist infra, mass assignment, fail-closed dev, rate limit); hook pengingat
mencakup file infra; `architecture-security.md` dikoreksi.

**Pencegahan:** "tertulis di dokumen" ≠ "ada di kode". Setiap klaim keamanan di dokumen (rate limit, guard role, dst.) harus
ada pemanggilnya yang bisa di-`grep`; auditor wajib memeriksa **pemakai** sebuah fungsi proteksi, bukan hanya keberadaannya.
Perilaku khusus dev selalu *fail-closed* (`=== 'development'`), tidak pernah *fail-open* (`!== 'production'`).

---

## 2026-10-21 — `next build` gagal di CI padahal dev server & typecheck hijau (instrumentation)

**Masalah:** commit yang menambah pembuatan bucket MinIO di `instrumentation.ts` merahkan job `validate` dan `docker`:
`Reading from "node:fs" is not handled` (SDK `minio` → `mime-types`).

**Penyebab:** `instrumentation.ts` dikompilasi juga untuk runtime Edge; guard `if (NEXT_RUNTIME !== 'nodejs') return` tidak
membuat webpack membuang `import()` di bawahnya. Dev server (Turbopack) dan `tsc` tidak melihat masalah ini.

**Fix:** kode khusus Node ke `instrumentation-node.ts`, di-import dari dalam `if (NEXT_RUNTIME === 'nodejs')`.

**Pencegahan:** perubahan di `instrumentation.ts`/`next.config.ts`/`middleware.ts` hanya terbukti oleh `bun run build`
(CLAUDE.md § Milestone SOP langkah 1). Detail: `docs/decisions.md` 2026-10-21.

---

## 2026-10-21 — Uji yang "lulus karena alasan yang salah"

**Masalah:** dua kali harness uji saya memberi hasil menyesatkan saat menguji `scripts/create-superadmin.ts`: (a) variabel
berisi perintah tidak di-split di zsh, sehingga skenario sukses pertama tidak pernah berjalan dan skenario penolakan berjalan
di kondisi yang keliru; (b) `env -u DATABASE_URL` **tidak** mematikan pemuatan otomatis `.env.local` oleh Bun, sehingga
skrip sempat terhubung ke database dev asli (hanya membaca, lalu menolak karena sudah ada superadmin — "lulus" tanpa
menguji jalur yang dimaksud).

**Pencegahan:** uji skrip yang menyentuh database pada **database sekali pakai** dengan `DATABASE_URL` eksplisit (bukan
`unset`); cetak **pesan** hasil, bukan hanya kode keluar, supaya "lulus karena alasan yang benar" terlihat; tulis harness
sebagai file bash (bukan fungsi zsh interaktif).

---

## 2026-10-21 — `Bun.password` diam-diam mem-pre-hash password > 72 byte

**Masalah:** hash bcrypt dari `Bun.password` dan `bcryptjs.compare` (dipakai route login) saling cocok untuk password
normal, tetapi untuk password > 72 byte Bun mem-pre-hash dengan SHA-512 sehingga `compare` gagal → admin terkunci di luar
akunnya sendiri.

**Pencegahan:** `scripts/create-superadmin.ts` menolak password > 72 byte (batas asli bcrypt). Kompatibilitas hash antar
library diuji dulu sebelum skrip ditulis, bukan diasumsikan.

---

## 2026-10-21 — Rate limit: yang diuji harus bisa gagal, dan "tidak ada header" belum tentu "tidak ada IP"

**Masalah:** (1) satu uji HTTP (login tanpa `X-Forwarded-For` mengharapkan hanya batas akun yang berlaku) gagal; (2) Redis tidak
terpasang di mesin dev sehingga jalur Redis (termasuk skrip Lua atomik — bagian paling berisiko) tidak bisa diuji lokal.

**Penyebab:** (1) Next.js mengisi `x-forwarded-for` dari alamat koneksi (`::1`) bila header tidak ada — kodenya benar, premis uji
salah; jalur `ip = null` baru teruji dengan memanggil handler langsung. (2) Memasang Redis hanya untuk uji berarti mengubah mesin
pengguna.

**Pencegahan:** uji diverifikasi bisa gagal (mutasi off-by-one membuat 5 uji merah, lalu dipulihkan); jalur yang tak bisa dijalankan
lokal dibuktikan di CI dengan layanan nyata dan **pembacaan kunci lewat klien terpisah** (fallback diam-diam tidak boleh lolos
sebagai hijau); status temuan ditulis jujur ("jalur Redis menunggu CI") sampai CI benar-benar hijau.
