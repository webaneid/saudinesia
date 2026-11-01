# Git, CI & Production — Saudinesia

> Status per 2026-10-21: **alur git + CI berjalan; berkas production (compose, Caddyfile, Dockerfile, env) sudah ditulis dan diuji di CI; workflow DEPLOY dan server VPS BELUM ada.**
> Pola acuan: project **smart-ai** (repo terpisah di `/Users/webane/sites/smartai`: folder `.github/workflows/`, dokumen
> conventions, deployment-server-setup, dan ADR versioning-nya). Dokumen ini mencatat apa yang diambil, apa yang sengaja belum, dan
> keputusan yang masih menunggu pemilik project.

Repo: `https://github.com/webaneid/saudinesia` (private).

## 1. Alur git (sudah dipakai)

- `main` = jalur menuju production. **Tidak ada commit langsung** — hook `.claude/hooks/pre-commit-guard.sh` menolaknya
  (lapisan kenyamanan di sesi Claude Code; proteksi sungguhan = branch protection GitHub, lihat §3).
- Kerja lewat branch `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` → **pull request ke `main`** → CI harus hijau → merge.
- Commit = Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). Ini bukan sekadar gaya: kalau nanti
  semantic-release dipasang (§4), pesan commit itulah yang menentukan nomor versi.
- Satu perubahan logis per commit. Skema Prisma berubah → **migrasinya ikut di commit/PR yang sama**.
- `prisma/migrations/` **harus di-commit** (sebelumnya ter-ignore sejak commit pertama — production memakai
  `prisma migrate deploy` dan tidak bisa berjalan tanpanya).

Perbedaan dengan smart-ai: smart-ai punya `develop` (staging, auto-deploy) di antara feature branch dan `main`. Saudinesia
belum punya staging, jadi PR langsung ke `main`. Menambah `develop` = keputusan §5 butir 3.

## 2. CI (`.github/workflows/ci.yml`)

Jalan di tiap pull request ke `main`. Langkah: `bun install --frozen-lockfile` → `prisma generate` → `typecheck` →
**migrasi diterapkan dari DB kosong dan harus sama dengan `schema.prisma`** (gagal kalau skema berubah tanpa migrasi) →
`build` → gitleaks. Postgres sungguhan lewat service container.

Diuji pada clone bersih sebelum di-commit (tanpa `.env.local`, hanya `DATABASE_URL` + `JWT_SECRET` dummy): semua langkah
selain gitleaks lolos. **gitleaks belum pernah dijalankan** (tidak terpasang lokal) — kalau menemukan false positive di
riwayat lama, tambahkan ke allowlist `.gitleaks.toml`, jangan matikan langkahnya.

Job kedua, **`docker`**, menguji jalur production tanpa server (lihat §4): validasi `docker-compose.prod.yml` dan `Caddyfile`,
build image `web` dan `migrate`, uji skrip env, lalu smoke test aplikasi sungguhan.

Sengaja **tidak ada**: `lint` (project belum punya konfigurasi ESLint; `next lint` meminta input interaktif) dan test suite
(belum ada). Keduanya menyusul bila diadopsi.

## 3. Branch protection (WAJIB, dikerjakan pemilik repo di GitHub)

Settings → Branches → rule untuk `main`: require pull request, require status check **`validate`**, require branch up to
date, block force push, block deletion. Tanpa ini, hook dan CI hanya pengingat — siapa pun masih bisa `git push` langsung.

## 4. Production — status per komponen

Dibangun 2026-10-21 di branch `feat/production-compose-caddy`. **Belum pernah dijalankan di server sungguhan** (VPS belum
disiapkan, `docs/progress.md` M15), dan Docker tidak terpasang di mesin dev — jadi seluruh jalur dibuktikan oleh job
`docker` di CI (`.github/workflows/ci.yml`): validasi compose + Caddyfile, build 2 image, uji skrip env, lalu smoke test
(migrasi → web → `/api/v1/health` menyentuh DB, halaman publik 200, log bebas error Prisma/openssl).

| Komponen | Berkas | Keterangan |
|---|---|---|
| Compose production | `docker-compose.prod.yml` | web, migrate (sekali jalan), postgres, redis, minio, caddy. Image dari GHCR. Tanpa port terbuka kecuali Caddy 80/443. **web = 1 replika** (cron node-cron di dalam proses). `docker-compose.yml` lama = bentuk dev, jangan dipakai di production |
| Reverse proxy | `Caddyfile` | TLS otomatis; domain dari env (`APP_DOMAIN`, `FILES_DOMAIN`), tidak ada domain di repo. Host file hanya GET/HEAD dan `frame-ancestors` (preview PDF memakai iframe — `X-Frame-Options: DENY` akan memblokirnya) |
| Image aplikasi | `Dockerfile` | 2 target: `runner` (standalone Next.js, non-root) dan `migrate` (CLI Prisma). `NEXT_PUBLIC_*` masuk sebagai build-arg |
| `.dockerignore` | `.dockerignore` | Sebelumnya tidak ada → `COPY . .` menyalin `.env.local` ke layer build |
| Env production | `.env.production.example`, `scripts/buat-env-production.sh` | Skrip membuat `.env.production` dengan rahasia acak di server (termasuk `REDIS_PASSWORD` + `REDIS_URL` yang disamakan — Redis berpassword, SEC-10); tidak menimpa, izin 600, tidak menampilkan rahasia. **`.env.production` yang sudah ada sebelum 2026-10-25 harus ditambah `REDIS_PASSWORD=<acak>` dan `REDIS_URL=redis://:<sandi sama>@redis:6379`** — tanpa itu `docker compose up` menolak jalan (`REDIS_PASSWORD belum diisi`) |
| Image MinIO | `infra/minio/Dockerfile`, `.github/workflows/minio-image.yml` | MinIO tidak lagi menerbitkan image publik (pengalaman smart-ai) → dibangun sendiri ke GHCR. **Workflow harus dijalankan sekali sebelum deploy pertama** |
| Health | `GET /api/v1/health` | Publik, hanya status + ping DB |

### Perbaikan kode yang ikut (ditemukan saat merancang production)

- **URL presigned MinIO** (`lib/storage/minio.ts`): sebelumnya ditandatangani atas `MINIO_ENDPOINT`, yang di Docker bernilai
  `minio` → semua foto hotel/muthowif/transport dan preview dokumen berisi `http://minio:9000/...` yang tidak bisa dibuka
  browser. Kini bila `MINIO_PUBLIC_URL` diisi, tanda tangan dibuat atas host publik (offline; `region` diberikan eksplisit).
  Tanpa variabel itu (dev lokal) perilaku lama tidak berubah. Diuji unit; **belum diverifikasi di browser** karena data lokal
  tidak punya foto.
- **Bucket dibuat otomatis** saat server start (`instrumentation.ts`, retry 5×, tidak pernah menjatuhkan boot) — tidak ada
  langkah manual `mc mb`.
- `Dockerfile` lama: `COPY bun.lockb*` tidak menyalin `bun.lock`; tanpa `openssl` (Prisma salah mendeteksi libssl di image
  slim); tanpa jalur migrasi; root user.
- **`sitemap.xml` dibuat dinamis** (`export const dynamic = 'force-dynamic'`): sitemap membaca hotel/muthowif dari DB, tapi
  di-prerender statis saat `next build` — gagal di image Docker (tidak ada database saat build; ditemukan job `docker` CI)
  dan, kalaupun berhasil, isinya membeku pada data saat build. Diverifikasi: build dengan `DATABASE_URL` kosong lolos dan
  sitemap hasil build memuat 5 hotel + 3 muthowif yang sama dengan DB.
- `CRON_SECRET` dihapus dari `.env.example` — tidak dibaca kode mana pun (rute cron HTTP sudah dihapus).

### Yang masih memakai pola smart-ai tapi BELUM ada di sini

| Komponen | smart-ai | Saudinesia |
|---|---|---|
| Workflow build+push image & deploy | `deploy.yml` (scp compose → SSH → `pull && up -d` → health check; rollback manual ke tag mana pun) | **belum ditulis** — kontrak sudah ada: image `ghcr.io/<repo>/web` & `/migrate`, `.env.deploy`, health endpoint |
| Versi & changelog otomatis | semantic-release | belum; `package.json` `0.1.0` manual |
| Staging (`develop`) | `deploy-staging.yml` | belum |
| Role DB terpisah (pemilik vs aplikasi) | `scripts/pisah-role-db.sh` | belum — satu role `saudinesia` memegang migrasi dan runtime |
| Backup terjadwal + uji restore | `backup-produksi.sh` ke Drive, dipantau | `backup-db.sh`/`backup-minio.sh` ada, **belum dijadwalkan** |
| Update dependency | Dependabot | belum |

## 5. Keputusan

1. ~~Reverse proxy: Nginx atau Caddy?~~ **SELESAI 2026-10-21: Caddy**, mengikuti smart-ai (TLS otomatis, konfigurasi pendek,
   terbukti di production smart-ai). Menggantikan rencana Nginx di M15.
2. **semantic-release sekarang atau nanti?** Saran: setelah deploy pertama berhasil.
3. **Staging (`develop`)?** Saran: tidak dulu — smart-ai sendiri belum mengaktifkannya.
4. Registry: GHCR, repo private (server login GHCR dengan token job deploy).

## 6. Sebelum go-live (blocker, urut)

0. **Sisa hardening kontainer (SEC-10) — kerjakan sebelum server dipakai** (disimpan 2026-10-25; server belum dibeli, boleh dikerjakan sambil menyentuh modul terkait):
   (a) `cap_drop: ALL` + `cap_add` minimal untuk `minio` dan `caddy` (uji di server/staging — CI tidak menjalankan keduanya);
   (b) `read_only` rootfs + `tmpfs` untuk web, dibuktikan di artefak produksi dan job CI `docker`;
   (c) pin digest image (`oven/bun`, `postgres`, `redis`, `caddy`, MinIO) bersama Dependabot ecosystem `docker`.
   Rincian dan alasan: `docs/lessons-learned.md` SEC-10, `docs/decisions.md` 2026-10-25 (SEC-10).

1. **Superadmin pertama** — `scripts/create-superadmin.ts` (ikut ke image web). Jalankan di server:
   `docker compose -f docker-compose.prod.yml --env-file .env.production --env-file .env.deploy exec web bun scripts/create-superadmin.ts --email <email> --name "<nama>"`
   lalu ketik password dua kali (tidak ditampilkan; tidak lewat argumen supaya tak masuk riwayat shell). Otomasi: `exec -T` + `--password-stdin`.
   (Sejak SEC-27 `bun run db:seed` menolak sendiri di luar mesin dev: `NODE_ENV` harus `development`, host DB lokal, dan DB tanpa jamaah/booking/akun nyata; seed juga tidak ada di image mana pun.)
   **Jangan** memakai `bun run db:seed` di production: menghapus data katalog/harga **dan** membuat akun
   `admin@saudinesia.local` dengan password default yang diketahui (`Admin@1234`), menimpa password bila akunnya sudah ada.
   Perilaku skrip: hanya menambah satu baris `users`; menolak bila sudah ada superadmin (kecuali `--additional`); menolak
   email yang sudah terdaftar dan tidak pernah mengubah akun yang ada; password harus lolos aturan aplikasi dan
   **≤ 72 byte** (lebih panjang → `Bun.password` mem-pre-hash sehingga `bcryptjs.compare` di login tidak cocok dan admin
   terkunci). Email dinormalisasi huruf kecil di semua jalur auth.
2. GitHub **Variables** (bukan Secrets) untuk build-arg `NEXT_PUBLIC_*` (nama bisnis, WA, alamat, rekening, URL aplikasi,
   `NEXT_PUBLIC_MINIO_PUBLIC_URL` = `https://<FILES_DOMAIN>/saudinesia-docs`). Image bersifat spesifik-environment.
3. Jalankan workflow **MinIO Image** (Actions → Run workflow) sekali.
4. DNS: A record `APP_DOMAIN` dan `FILES_DOMAIN` ke IP VPS **sebelum** Caddy dinyalakan.
5. Server: Docker + Compose, folder `/opt/app` berisi `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`,
   `scripts/buat-env-production.sh`; jalankan skrip env (mengisi `APP_URL` otomatis); isi manual `WA_GATEWAY_*`, `RESEND_*`.
   **Email (Resend)**: verifikasi domain pengirim di Resend (SPF + DKIM + DMARC) dulu, lalu isi `RESEND_API_KEY`/`RESEND_FROM`,
   `docker compose up -d web`, login superadmin → Pengaturan → Integrasi & Notifikasi → **Kirim uji**. Detail: `docs/arsitektur-notifikasi.md` §7.
   Sebelum diisi, email dicatat `dilewati` di Log Notifikasi (aplikasi tetap normal).
   **Verifikasi WhatsApp (webhook GOWA)**: `scripts/buat-env-production.sh` membuat `WHATSAPP_WEBHOOK_SECRET` otomatis. Di GOWA (Sumopod) atur
   `WHATSAPP_WEBHOOK=https://<APP_DOMAIN>/api/v1/webhooks/whatsapp`, `WHATSAPP_WEBHOOK_SECRET=<NILAI YANG SAMA>` dan `WHATSAPP_WEBHOOK_EVENTS=message`;
   pastikan `NEXT_PUBLIC_BUSINESS_WA` (GitHub Variable build-arg) adalah nomor yang terhubung ke GOWA. Admin → Pengaturan → Integrasi menampilkan status
   gateway langsung (aktif/terputus/tak terjangkau), apakah secret terisi, dan URL webhook yang harus dipasang. Tanpa secret webhook mati (fail-closed) dan
   nomor tak bisa diverifikasi — notifikasi tetap lewat email.
   **Login Google (opsional)**: Google Cloud Console → buat project → OAuth consent screen (External; scope `openid`, `email`, `profile`;
   scope itu tidak butuh verifikasi manual, tapi status aplikasi harus *In production* agar semua pengguna bisa masuk, bukan hanya penguji) →
   Credentials → OAuth client ID → *Web application* → Authorized redirect URI **persis** `https://<APP_DOMAIN>/api/v1/auth/google/callback`
   (+ `http://localhost:6260/...` untuk dev) → isi `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` di `.env.production`, `docker compose up -d web`.
   Admin → Pengaturan → Integrasi menampilkan redirect URI yang harus didaftarkan dan apakah Google sudah terkonfigurasi. Tanpa kredensial tombol Google tidak tampil.
6. Rahasia Actions untuk deploy: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY` — diisi langsung di GitHub, **jangan**
   ditempel di chat.
7. Tulis `deploy.yml` (build+push 2 image, scp, SSH, health check, rollback). Baru setelah itu semantic-release.
8. Jadwalkan backup (`backup-db.sh`, `backup-minio.sh`) dan uji restore.
9. **Blocker keamanan yang masih terbuka** (`docs/lessons-learned.md`): SEC-05 (sisa 1 advisory *high* tanpa versi perbaikan — `braces`, hanya build/dev; keputusan `next-intl` 4 menunggu pemilik), ~~SEC-18 (sesi tak bisa dicabut)~~ — selesai 2026-10-22,
   ~~SEC-44 (hapus akun UU PDP)~~ — selesai 2026-10-22, **tetapi aturan retensi (`docs/arsitektur-hapus-akun.md` §2) perlu ditinjau penasihat hukum/pajak**, ~~serta SEC-26/27~~ — selesai 2026-10-22.
10. **Uji dengan layanan asli sebelum membuka ke jamaah:** Resend (domain SPF/DKIM/DMARC + email masuk inbox), **Google** (redirect URI terdaftar, aplikasi *In production*, dan pastikan login **mendarat di dashboard**, bukan
    terpental ke halaman login — cookie sesi sudah `Lax`), GOWA (bentuk `from` bukan `@lid`, `/app/status`). Pastikan DB produksi **tidak berisi akun pra-migrasi** (migrasi auth menandai semua `isActive=true` sebagai email terverifikasi).



## Catatan operasional: migrasi kontraksi harga (Fase 5, 2026-10-28)
Migrasi `20261029090000_price_legacy_columns_drop` menghapus 17 kolom (tak bisa dibalik) dan bersifat fail-closed (berhenti bila ada harga lama tanpa titik harga). Saat dirilis ke produksi: (1) **ambil cadangan DB** (`scripts/backup-db.sh`) tepat sebelumnya; (2) **hentikan `web` lama sebelum `migrate`** — klien Prisma versi lama mem-`SELECT` kolom yang dihapus, jadi tiap query ke tabel itu 500 sampai web baru naik; (3) jalankan hanya lewat `prisma migrate deploy` (satu transaksi; jangan manual tanpa transaksi — migrasi menonaktifkan trigger beku `price_snapshots_no_update` sebentar); (4) pasca-deploy periksa `select tgenabled from pg_trigger where tgname = 'price_snapshots_no_update'` = `'O'`; (5) bila migrasi berhenti dengan pesan "Kontraksi harga dibatalkan", buat titik harga yang disebut (hitung ulang lewat skrip sekali jalan / image versi sebelumnya, atau atur harga manual) lalu ulangi — tak ada data yang berubah saat gagal. Uji dulu pra-cek terhadap salinan DB produksi.


## Catatan operasional: migrasi Fase 7 (`20261030090000_adjustments_cost_actuals`, 2026-10-28)
Migrasi memuat perbaikan data: pembayaran **terkonfirmasi bernilai 0** diisi total booking-nya (alur lama mengonfirmasi lunas). Sebelum deploy produksi periksa pada salinan DB: `select "bookingId", count(*) from payments where status = 'confirmed' group by 1 having count(*) > 1` — bila ada booking dengan lebih dari satu pembayaran terkonfirmasi bernilai 0, isi hanya satu (yang terbaru) secara manual sebelum migrasi agar "dibayar" di laporan tidak menggelembung (SEC-97). Jumlah pembayaran kini diisi saat konfirmasi (bawaan total; kurang dari total ditolak).

## Catatan operasional: kunci data pribadi NIK/paspor (data jamaah Fase 1, ADR-0005, 2026-11-02)
- `PII_INDEX_KEY` dan `PII_ENCRYPTION_KEY` dibuat otomatis oleh `scripts/buat-env-production.sh` (64 hex, berbeda satu sama lain dan dari `JWT_SECRET`). **Cadangkan keduanya di password manager**: kunci hilang = NIK dan nomor paspor tersimpan tidak bisa dibaca lagi, dan keunikan NIK tidak bisa diperiksa.
- Kunci kosong/lemah tidak menjatuhkan server: boot mencatat `[pii] …` dan fitur data jamaah menolak bekerja (fail-closed) sampai diperbaiki.
- **Rotasi kunci enkripsi**: pindahkan kunci lama ke `PII_ENCRYPTION_KEYS_RETIRED="<versi lama>:<hex lama>"`, isi `PII_ENCRYPTION_KEY` baru, naikkan `PII_ENCRYPTION_KEY_VERSION`, restart. Nilai lama tetap terbaca; enkripsi ulang bertahap memakai `needsReencrypt` (alat enkripsi ulang dibuat bersama tabel jamaah, Fase 2+). Kunci lama baru boleh dibuang setelah tidak ada ciphertext versi itu.
- **`PII_INDEX_KEY` tidak dirotasi biasa**: menggantinya berarti menghitung ulang semua indeks NIK/paspor dari nilai terdekripsi (butuh alat khusus); lakukan hanya bila kunci bocor.
