# Rencana — Domain Admin Terpisah (`admin.saudinesia.id`)

> Status: **DISETUJUI (K1–K4 sesuai rekomendasi) dan DIKERJAKAN 2026-11-21** (`feat/domain-admin`). Lihat §6 untuk hasil as-built.

## 1. Tujuan

| Host | Isi | Contoh |
|---|---|---|
| `app.saudinesia.id` | Situs publik + area jamaah (seperti sekarang) | `app.saudinesia.id/id/paket`, `/id/dashboard` |
| `admin.saudinesia.id` | Panel admin, **alamat ramah tanpa `/id/admin`** | `admin.saudinesia.id/bookings`, `/login` |
| `files.saudinesia.id` | MinIO (sudah ada) | URL presigned |

Root `saudinesia.id`/`www` tetap website lama pemilik — tidak disentuh.

## 2. Hasil recheck kode (2026-11-21)

- Halaman admin ada di `app/[locale]/admin/(protected)/*` + `app/[locale]/admin/login`. Admin hanya berbahasa Indonesia.
- `middleware.ts`: gerbang kasar `/admin` (role dari JWT), redirect ke `/${locale}/admin/login`; **`/api` dilewati seluruhnya** (akses API dijaga `getSession()` di tiap route).
- Tautan admin di kode: **±184 kemunculan `/${locale}/admin…` di 101 berkas** (`app/`, `components/`, `lib/` — termasuk `lib/admin/navigation.ts`, `lib/auth/pageGuards.ts` `redirect(...)`, `AdminLoginForm` `router.push`) + ±42 literal `'/admin…'`.
- Cookie sesi `snd-session` **host-only** (tanpa `Domain`) → sesi di `admin.` dan `app.` otomatis terpisah. Tidak perlu diubah.
- `appUrl()` (`APP_URL`) dipakai: tautan email, redirect Google OAuth, `notifyUrl` iPaymu, tautan invoice publik, integrasi. **Tidak ada email yang menautkan ke halaman admin** — semuanya tetap di `app.`.
- `siteOrigin()` (`NEXT_PUBLIC_APP_URL`) untuk SEO/sitemap — tetap `app.`.
- `Caddyfile`: blok `{$APP_DOMAIN}` dan `{$FILES_DOMAIN}`; CSP host file `frame-ancestors https://{$APP_DOMAIN}` → **pratinjau dokumen di admin (iframe) akan diblokir** bila admin pindah host, wajib ditambah.
- Login: satu route `POST /api/v1/auth/login` untuk jamaah dan staf (staf dicatat `recordStaffEvent`).

## 3. Rancangan

### 3.1 Satu sumber alamat admin — `adminPath()`
- Modul baru `lib/admin/paths.ts` (murni, aman klien): `adminPath(base, '/bookings') → base + '/bookings'`.
- `base` = `''` bila mode domain (host admin), `'/id/admin'` bila mode jalur (dev tanpa `ADMIN_DOMAIN`).
- Server membaca mode dari env runtime `ADMIN_DOMAIN` (bukan `NEXT_PUBLIC_*` → tak perlu build ulang image per domain). Klien menerima `base` lewat `AdminBaseProvider` di layout admin (`useAdminPath()`).
- **Codemod** mengganti semua `/${locale}/admin…` / `'/admin…'` ke helper ini. Penjaga baru `scripts/test-admin-domain.ts` menolak tautan admin yang ditulis tangan (penemu sumber, pola sama `test-time-guard`).

### 3.2 Middleware berbasis host
Bila `ADMIN_DOMAIN` terisi:
- **Host admin**: `/X` di-*rewrite* ke `/id/admin/X` (internal, URL di browser tetap ramah); `/login` → `/id/admin/login`. Gerbang role berjalan atas jalur internal. Jalur lama `/id/admin/X` → **308 ke `/X`** (bookmark lama tetap jalan). Halaman non-admin (katalog, dashboard jamaah) → 404.
- **Host app**: `/{locale}/admin*` → 404 (admin tak terlihat dari situs publik).
Bila `ADMIN_DOMAIN` kosong: perilaku sekarang, tidak berubah (dev lokal `localhost:6260/id/admin`).

### 3.3 API
- Halaman admin memanggil `/api/v1/...` relatif → otomatis ke host admin (same-origin, cookie host-only ikut).
- **Caddy** (lapis tepi): host app menolak `/api/v1/admin/*` (404); host admin menolak alur khusus jamaah yang mengirim email/OAuth (`/api/v1/auth/google/*`, `register`, `registration/*`, `webhooks/*`). Akses sesungguhnya tetap dijaga `getSession()` di route — Caddy hanya lapis kedua.
- Google OAuth & webhook (iPaymu, GOWA) tetap di host app (`APP_URL`), tidak berubah.

### 3.4 Caddy, compose, env
- Blok ketiga `{$ADMIN_DOMAIN}` (header keamanan sama + `X-Robots-Tag: noindex`, `frame-ancestors 'none'`).
- Host file: `frame-ancestors https://{$APP_DOMAIN} https://{$ADMIN_DOMAIN}`.
- `ADMIN_DOMAIN` di `docker-compose.prod.yml` (caddy + web), `.env.production.example`, `scripts/buat-env-production.sh <APP> <ADMIN> <FILES>`.
- CI smoke docker: host admin `/bookings` → halaman login; host app `/id/admin` → 404; jalur lama → 308.

### 3.5 Staf login di host app
Staf yang login di `app.` (form jamaah) → ditolak dengan pesan "Gunakan admin.saudinesia.id" (lihat keputusan K2).

## 4. Keputusan pemilik

| # | Pertanyaan | Rekomendasi |
|---|---|---|
| K1 | Dev lokal: tetap `localhost:6260/id/admin` (tanpa `ADMIN_DOMAIN`) atau ikut `admin.localhost:6260`? | **Tetap seperti sekarang**; mode domain bisa dicoba lokal kapan saja dengan mengisi `ADMIN_DOMAIN=admin.localhost` |
| K2 | Staf login lewat halaman login jamaah di `app.`: tolak atau izinkan? | **Tolak** dengan pesan menunjuk domain admin (sesi staf hanya ada di host admin) |
| K3 | `app.saudinesia.id/id/admin`: 404 atau alihkan ke domain admin? | **404** — tidak mengiklankan alamat panel admin |
| K4 | Jalur lama `admin.saudinesia.id/id/admin/...`: 308 ke alamat ramah? | **Ya, 308** |

## 5. Fase

1. **F1** — `lib/admin/paths.ts` + provider + codemod seluruh tautan + penjaga `test-admin-domain.ts`. Mode jalur saja → perilaku dev tidak berubah (dibuktikan klik-uji halaman admin).
2. **F2** — middleware host (rewrite/308/404) + login staf (K2) + uji middleware di beberapa host.
3. **F3** — Caddy blok admin + CSP file + compose/env/generator + smoke CI.
4. **F4** — dokumentasi (deployment.md, CLAUDE.md, decisions.md) + security review.

Satu PR untuk keempat fase (perubahan saling bergantung; F1 saja tak berguna di produksi), tiap fase build + uji.

## 6. As-built (2026-11-21)

- **Alamat admin:** `lib/admin/href.ts` — `adminHref(locale, '/admin/...')` (jalur logis), `adminLogicalPath(pathname)` (breadcrumb), `publicHref(path, origin)` (admin → halaman publik). Mode: server = env `ADMIN_DOMAIN`; browser = bentuk alamat yang sedang dibuka (tanpa selisih hidrasi). Origin publik (`APP_URL`) diberikan layout admin lewat `AdminPublicOriginProvider` (`components/admin/shell/AdminPublicOrigin.tsx`) dan prop `publicOrigin` di halaman login. ±200 tautan diganti lewat codemod.
- **Host:** `lib/admin/domain.ts` (murni, aman Edge) — `hostKind`, `apiBlockedOnHost`, `loginHostRefusal`. `middleware.ts`: host admin → rewrite `/X` ke `/id/admin/X` + header `X-NEXT-INTL-LOCALE`, jalur lama 308, halaman berlocale 404, jalur bersegmen `.`/`..` 404; host app → `/…/admin` dan `/api/v1/admin` 404. Matcher kini juga mencakup `/api/:path*` (jalur bertitik tak lolos).
- **Login (K2):** `POST /api/v1/auth/login` menolak staf di host app (`staffUseAdminDomain`) dan jamaah di host admin (`adminDomainStaffOnly`), sesudah password & status akun; staf tercatat `login_failed` alasan `wrong_host`.
- **Header `Location`** dari Next standalone relatif (`/login`), jadi pengalihan selalu tinggal di host yang diminta.
- **Infra:** `Caddyfile` (snippet `batas_body` dipakai dua host; penolakan di dalam `handle` karena `handle` diproses sebelum `respond`), compose (`ADMIN_DOMAIN` wajib di web + caddy), generator `buat-env-production.sh <APP> <ADMIN> <FILES> [DIR]` (tiga host wajib berbeda), CI (validasi Caddy, uji batas body + penolakan per host, smoke artefak produksi per host).
- **Halaman publik → panel admin** (catatan staf di checkout/keranjang, pengalihan staf dari `lengkapi-data`): `staffPanelHref` (`lib/auth/staffPanel.ts`, server) — area publik tak boleh mengimpor `lib/admin`; mode domain = alamat absolut ke host admin.
- **Penjaga:** `scripts/test-admin-domain.ts` — penemu sumber tautan admin tulisan tangan, helper di dua mode, aturan host, middleware sungguhan atas tiga host, infra.
- **Dibuktikan di browser** atas artefak produksi (`bun server.js`, DB sekali pakai): mode domain `admin.localhost` (login → `/`, menu `/bookings`…, breadcrumb, buat produk → `/products/haji/<id>`, tautan publik absolut ke host app, logout → `/login`, host app `/id/admin` 404, staf login di host app 403) dan mode jalur (`/id/admin/...` tak berubah). Dev lokal (`ADMIN_DOMAIN` kosong) tetap `localhost:6260/id/admin`; mode domain bisa dicoba lokal dengan `ADMIN_DOMAIN=admin.localhost` lalu membuka `http://admin.localhost:6260`.
