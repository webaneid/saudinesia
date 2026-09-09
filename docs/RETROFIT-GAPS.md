# Retrofit Gaps — Saudinesia

> Dibuat: 2026-09-10, hasil audit `retrofit-adopt` (template `master-typescript`).
> Murni hasil AUDIT — tidak ada kode yang diubah untuk menghasilkan dokumen ini.
> Verifikasi dilakukan lewat baca kode langsung (Prisma schema, `app/api/v1/**`,
> `lib/**`, `scripts/`, `package.json`), bukan asumsi dari nama folder.

## Cara Baca Tabel

Diurutkan **risiko tertinggi + effort terendah dulu** (quick win keamanan/operasional),
bukan urutan checklist. **Jangan eksekusi item apa pun dari tabel ini di sesi yang
sama dengan audit** — laporkan ke user, biarkan user pilih mulai dari mana, lalu
jalankan sebagai fase terpisah lewat SOP normal project (`CLAUDE.md` § Fase
Eksekusi SOP / Milestone SOP yang sudah ada).

| # | Komponen | Status Saat Ini | Risiko Kalau Dibiarkan | Effort Estimasi | Prioritas |
|---|----------|------------------|--------------------------|-------------------|-------------|
| 1 | Backup otomatis (Postgres + MinIO) | **Sebagian tertutup (2026-09-10)** — `scripts/backup-db.sh`/`restore-db.sh` sudah ditambahkan (pg_dump + gzip + upload rclone/gdrive, retention 30 hari, restore dengan konfirmasi manual), diadaptasi dari template. **Belum dijadwalkan** (perlu setup rclone remote + `~/.pgpass` + crontab manual di VPS — lihat komentar di kedua script). MinIO (dokumen paspor/KTP/KK) **masih belum ada backup sama sekali** | Sedang — sisi Postgres tinggal dijadwalkan, tapi dokumen jamaah di MinIO tetap berisiko Tinggi kalau VPS gagal | Kecil (jadwalkan cron yang sudah ada) untuk Postgres; Kecil–Sedang (script serupa untuk MinIO, belum dibuat) | **Tinggi** |
| 2 | Kepatuhan UU PDP (data pribadi jamaah) | Sebagian — `CLAUDE.md` § Security sudah larang log PII, tapi tidak ada kebijakan privasi aktif (`components/campaigns/CampaignDashboard.tsx:159` link "Kebijakan Privasi" masih `href="#"`), tidak ada pencatatan consent, tidak ada mekanisme permintaan hapus/ekspor data pribadi | **Tinggi** — data yang diproses termasuk paspor, KTP, KK (lihat `lib/constants/booking.ts` `REQUIRED_DOCUMENTS`) — kategori data pribadi spesifik menurut UU PDP, ada konsekuensi hukum kalau tidak ada basis pemrosesan & hak subjek data yang jelas | Sedang (halaman kebijakan privasi + pencatatan consent saat registrasi + flow permintaan hapus akun) | **Tinggi** |
| 3 | Observability / error tracking | Tidak ada — tidak ada Sentry atau APM apa pun di `package.json`; error hanya `console.error` (165 titik tersebar di `lib/` + `app/api/`), hilang begitu container restart | **Sedang** — kegagalan produksi (termasuk kegagalan pembayaran/notifikasi WA) baru diketahui dari laporan user, tidak ada alert proaktif | Kecil (integrasi 1 SDK error-tracking, tidak perlu ubah logic) | **Tinggi** (quick win) |
| 4 | SEO — sitemap & robots | Tidak ada `sitemap.ts`/`robots.ts` (Next.js) atau file statis manapun ditemukan di `app/` | **Sedang** — platform publik dengan katalog produk (hotel/transport/visa/paket) kehilangan potensi traffic organik, mesin pencari mengindeks tidak optimal | Kecil (Next.js App Router native `sitemap.ts`/`robots.ts` generator dari data katalog yang sudah ada) | **Sedang–Tinggi** (quick win) |
| 5 | Staging environment | Tidak terdokumentasikan — `CLAUDE.md` § Tech Stack cuma sebut "Single Docker container, Hostinger VPS", tidak ada environment terpisah untuk uji sebelum production | **Sedang** — perubahan (terutama flow pembayaran/booking yang sudah kompleks, 8 step per `docs/arsitektur-booking.md`) langsung diuji di production | Sedang (butuh VPS/container terpisah + strategi seed data) | **Sedang** |
| 6 | Settings Page — scope terbatas | Ada, tapi hanya untuk `vendors` dan `pricing-rule` (`app/[locale]/admin/(protected)/system/settings/`) — tidak ada tempat untuk atur konfigurasi situs umum (nama platform, kontak, meta SEO default, dst.) lewat admin UI | Rendah–Sedang — perubahan semacam itu masih harus lewat kode, bukan blocking tapi menghambat operasional non-teknis | Kecil | **Sedang** |
| 7 | Search / full-text search | Tidak ada — "search" yang ditemukan di kode adalah listing/filter katalog biasa (`app/api/v1/catalog/*`), bukan mesin pencari sungguhan | Rendah — katalog produk masih relatif kecil, filter kategori kemungkinan masih cukup untuk saat ini | Sedang | **Rendah** |

## Item Checklist yang SUDAH Terpenuhi (untuk konteks, bukan gap)

Dicek langsung ke kode, bukan diasumsikan dari nama file:

- **Auth/RBAC** — WhatsApp OTP + JWT (`lib/auth/session.ts`, `httpOnly` cookie), 5 role (`pilgrim/agent/admin/manager/superadmin`), guard di `middleware.ts` **dan** re-check di tiap Route Handler (sesuai rule `CLAUDE.md` § API Conventions).
- **Multi-tenant** — **tidak relevan** untuk project ini (beda dari `jalajogja`). Saudinesia adalah satu operator tunggal yang memegang semua inventory (bukan platform SaaS multi-tenant) — dikonfirmasi di intro `CLAUDE.md` dan tidak ada pola schema-per-tenant di `prisma/schema.prisma`.
- **Alamat** — `docs/arsitektur-alamat.md`, SELESAI & TERVERIFIKASI, malah lebih detail dari sekadar checklist (data wilayah Kemendagri, mode domestik/internasional).
- **Payment** — pola manual bank-transfer confirmation (model `Payment`: `buktiTransferPath`, `confirmedById`, status `pending/confirmed/rejected`) + model `Refund` terpisah — filosofi sama dengan pola "manual confirmation, no payment gateway" yang juga dipakai di project `jalajogja`.
- **Media Library** — implementasi ADA (`components/shared/media/`, admin ZIP download di `app/api/v1/admin/bookings/[id]/documents/zip/route.ts`, storage lewat `lib/storage/minio.ts`) — **catatan**: `docs/media-library-plan.md` masih menyatakan status "DRAFT — belum diimplementasi" (per 2026-05-21), padahal sudah dibangun & diverifikasi lewat `docs/arsitektur-dokumen.md` (2026-07-24). Dokumen plan itu sudah **superseded**, bukan salah — tapi kalau dibaca sendirian tanpa cross-check bisa menyesatkan.
- **Notifikasi** — `lib/notifications/send.ts` + template WhatsApp (`lib/notifications/templates/whatsapp.ts`) via GOWA, email via Resend (`package.json`).
- **Jobs** — `lib/cron/exchangeRateJob.ts`, `lib/cron/autocancelJob.ts`, pakai `node-cron`.
- **i18n** — `next-intl`, locale `id`/`en`, terintegrasi di `middleware.ts`.

## Update 2026-09-10 — Audit Tooling (Skills/Hooks/Struktur)

User bertanya apakah fitur/skill/struktur folder dari template `master-typescript`
sudah ikut diadopsi (bukan cuma audit fitur bisnis). Jawaban: **belum**, retrofit
sebelumnya cuma menghasilkan laporan gap ini. Sudah ditutup di sesi ini:

- `.claude/hooks/` (6 hook: adr-guard, secret-scan, dependency-audit,
  post-edit-lint, pre-commit-guard, security-review-reminder) + `.claude/settings.json`
  — diadaptasi ke Next.js Route Handler (`route.ts`), bukan pola `apps/api/src/routes/*`.
- `.claude/agents/security-auditor.md` — subagent read-only untuk audit keamanan menyeluruh.
- `.claude/skills/security-review/` dan `.claude/skills/new-api-route/` — ditulis ulang
  untuk stack Prisma + Zod + Route Handler (bukan copy Elysia/Drizzle mentah).
- `docs/decisions/adr-template.md` + `scripts/next-adr-number.sh` — mekanisme ADR baru
  untuk keputusan besar ke depan (lihat `CLAUDE.md` § ADR untuk pembagian dengan `docs/decisions.md`).
- `docs/architecture/architecture-security.md` — ditulis dari audit kode langsung,
  BUKAN salinan template — termasuk temuan baru: `CLAUDE.md` § Tech Stack tidak
  menyebutkan bahwa login sebenarnya **email+password** (bcrypt), OTP WhatsApp
  cuma untuk verifikasi akun saat registrasi. Sudah dikoreksi di `CLAUDE.md`.
- `scripts/backup-db.sh`/`restore-db.sh` — lihat gap #1 di atas.
- `docs/WORKFLOW-MODES.md` — panduan pemakaian Claude Code (mode/subagent/hemat token),
  bagian daftar plugin marketplace template DIHAPUS (belum diverifikasi terpasang di sini).

**Sengaja TIDAK diadopsi:**
- Skill `phase-workflow` — redundan dengan § "Fase Eksekusi SOP"/"Milestone SOP"
  yang sudah ada inline di `CLAUDE.md`; mengadopsinya mentah akan menciptakan dua
  sistem SOP paralel dengan istilah berbeda (Fase vs Milestone) yang berisiko drift.
- `docs/SOP.md`/`docs/conventions.md`/`docs/PROGRESS.md`/`docs/phases/` terpisah —
  saudinesia sudah punya ekuivalennya inline di `CLAUDE.md` (SOP) dan `docs/progress.md`
  (tracking milestone M1-M15) — tidak diduplikasi ke nama/format template.
- `docs/glossary.md` — domain Umroh/Haji (Muthowif, Manifest, dst.) sudah dijelaskan
  ad-hoc di tiap `docs/arsitektur-*.md` terkait; belum dibuat glossary terpisah,
  masih kandidat kalau user mau.
- Skill `project-init`/`retrofit-adopt` milik template itu sendiri — meta-tool untuk
  bootstrap project baru/retrofit, tidak relevan dipakai dari dalam saudinesia sendiri.
- Multi-env scaffolding (docker-compose staging/prod terpisah, `.env.staging.example`) —
  ini pekerjaan infrastruktur nyata (bukan sekadar copy file), tetap tercatat sebagai
  gap #5 (Staging) di atas, bukan dieksekusi di sesi audit ini.

## Update 2026-09-10 — Follow-up: 4 "Referensi Mati" dari `check-docs-consistency.sh`

Dicek satu per satu — **bukan bug**, semuanya catatan riwayat yang memang benar
di `docs/decisions.md` (append-only log, tidak boleh diedit/dihapus):
- `docs/arsitektur-transport.md` / `docs/transport-architecture.md` — nama file
  lama Transport, sudah di-rename lalu dihapus & diserap ke
  `docs/arsitektur-transportasi.md` (dicatat 2026-07-08). Referensi di
  `docs/decisions.md` sengaja menyebut nama lama ini sebagai riwayat.
- `docs/visa-architecture.md` — sama, sudah dihapus & diserap ke
  `docs/arsitektur-visa.md` (dicatat di 2 tempat: `decisions.md` dan header
  `arsitektur-visa.md` sendiri — konsisten).
- `docs/arsitektur-visa-varian.md` — file ini **tidak pernah dibuat**, ini
  opsi yang secara eksplisit DITOLAK saat itu (dicatat sebagai
  "Alternatives considered" di `decisions.md`).

Satu polish kecil dilakukan: `docs/arsitektur-harga.md` baris 3 memakai nama
file lama (`arsitektur-transport.md`) sebagai analogi pola tanpa penjelasan
"sudah dihapus" — diperjelas supaya pembaca baru tidak salah sangka itu link
aktif. Tidak ada perubahan lain — `docs/decisions.md` sengaja TIDAK disentuh
(mengedit log historis akan merusak audit trail-nya).

`check-docs-consistency.sh` sendiri sudah punya disclaimer soal ini di
outputnya ("MISSING belum tentu bug") — perilaku ini memang disengaja
(tool naif secara sadar, butuh judgment manusia/Claude buat filter), bukan
sesuatu yang perlu "diperbaiki" di skrip itu sendiri.

## Catatan Terpisah (Bukan Bagian Checklist Template, Tapi Layak Diketahui)

`docs/decisions.md` (319 KB) dan `docs/progress.md` (122 KB) sudah tumbuh besar
sebagai log kronologis append-only — pola yang sama seperti `CLAUDE.md` di
project `jalajogja` sebelum di-restrukturisasi (22.224 baris → 1.174 baris).
Belum jadi masalah akut di sini karena file-file itu **tidak** di-load penuh
oleh Claude di awal sesi (beda dari kasus `jalajogja` yang CLAUDE.md-nya
otomatis ter-load selalu) — tapi tetap layak dipantau. Bukan bagian dari
audit `retrofit-adopt` ini, sekadar catatan kalau suatu saat kedua file itu
mulai terasa berat untuk dibaca/di-grep.
