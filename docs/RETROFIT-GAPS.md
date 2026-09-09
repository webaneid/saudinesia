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
| 1 | Backup otomatis (Postgres + MinIO) | Tidak ada — `scripts/` cuma berisi `import-wilayah.ts`, tidak ada script/cron backup apa pun | **Tinggi** — self-hosted di satu VPS Hostinger (`docs/architecture.md`), satu Docker container. Kalau VPS gagal/corrupt, seluruh data booking, pembayaran, dan dokumen pribadi jamaah (paspor/KTP/KK) hilang tanpa jalan pulih | Kecil–Sedang (pg_dump terjadwal + mirror bucket MinIO ke storage lain, lewat `lib/cron/` yang sudah ada polanya) | **Tinggi** |
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

## Catatan Terpisah (Bukan Bagian Checklist Template, Tapi Layak Diketahui)

`docs/decisions.md` (319 KB) dan `docs/progress.md` (122 KB) sudah tumbuh besar
sebagai log kronologis append-only — pola yang sama seperti `CLAUDE.md` di
project `jalajogja` sebelum di-restrukturisasi (22.224 baris → 1.174 baris).
Belum jadi masalah akut di sini karena file-file itu **tidak** di-load penuh
oleh Claude di awal sesi (beda dari kasus `jalajogja` yang CLAUDE.md-nya
otomatis ter-load selalu) — tapi tetap layak dipantau. Bukan bagian dari
audit `retrofit-adopt` ini, sekadar catatan kalau suatu saat kedua file itu
mulai terasa berat untuk dibaca/di-grep.
