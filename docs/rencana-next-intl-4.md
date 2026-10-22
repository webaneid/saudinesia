# Rencana — upgrade `next-intl` 3.26 → 4 (SEC-05, sisa advisory)

> Status: **DIEKSEKUSI 2026-10-22 (opsi A, disetujui pemilik) — as-built di §10.** Dokumen ini hasil riset + **spike nyata** di worktree terpisah, lalu dieksekusi persis sesuai §7. Konteks: `docs/lessons-learned.md` SEC-05; pelajaran proses: bump dependency diuji di **artefak produksi** (`bun server.js`), bukan hanya build/dev (memori proyek, CLAUDE.md § Security).

## 1. Mengapa ini ada

`bun audit` melaporkan dua advisory *moderate* pada `next-intl` <4.9.1, dan tidak ada perbaikan di jalur 3.x:

| Advisory | Syarat terkena | Kita? |
|---|---|---|
| GHSA-8f24-v5vv-gm5j / CVE-2026-40299 — open redirect pada middleware | `localePrefix: 'as-needed'` | **Tidak** — kita memakai bawaan (`always`). **Dibuktikan** lewat uji nyata terhadap `middleware.ts`: 18 jalur uji (12 di antaranya bermusuhan: `//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`, `/%09/evil.com`, `/id@evil.com`, …) — tak satu pun mengalihkan ke host lain |
| GHSA-4c35-wcg5-mm9h — prototype pollution | `experimental.messages.precompile` dengan katalog terjemahan dari penyerang | **Tidak** — opsi itu tak dipakai; `experimental` di `next.config.ts` hanya `serverActions`; katalog kita dua berkas statis di repo |

Jadi ini **bukan celah yang bisa dieksploitasi hari ini**; ini soal kebersihan audit dan kebiasaan tetap di versi yang dipelihara (v3 tidak akan menerima perbaikan baru).

## 2. Permukaan pemakaian (recheck kode, bukan asumsi)

- Hanya **5 API** yang dipakai: `createNextIntlPlugin` (`next.config.ts`), `createIntlMiddleware` (`middleware.ts`), `getRequestConfig` (`i18n/request.ts`), `getMessages` + `NextIntlClientProvider` (`app/[locale]/layout.tsx`).
- **Nol** pemakaian `useTranslations`/`getTranslations`/`useLocale`/`next-intl/navigation`. Dua berkas pesan (`id.json`, `en.json`, masing-masing 5 kunci tingkat-atas) praktis belum dikonsumsi.
- `LocaleSwitcher.tsx` hanya stub (`return null`) — tidak ada pergantian bahasa di UI.
- Daftar locale terduplikasi di tiga tempat (`middleware.ts` `LOCALES`, `app/[locale]/layout.tsx` `locales`, dan `i18n/request.ts` tanpa validasi sama sekali: `import(`./messages/${locale}.json`)` memakai nilai mentah).

## 3. Bukti spike (worktree terpisah dari `main`, 2026-10-22)

Dua versi dicoba: **4.9.2** (versi minimum yang menutup kedua advisory) dan **4.14.9** (terbaru). Kode aplikasi **tidak diubah sama sekali**.

| Pemeriksaan | 4.9.2 | 4.14.9 |
|---|---|---|
| `tsc --noEmit` | bersih | bersih |
| `next build` (Bun) | exit 0, 0 baris `error:` | exit 0, 0 baris `error:` |
| Karakterisasi middleware (20 jalur: 12 bermusuhan + rute biasa/terlindungi/API) vs v3 | sama kecuali 2 perbedaan jinak (§4) | identik dengan 4.9.2 |
| Server produksi `bun server.js` (standalone) | `/id` `/en` `/id/login` `/id/hotels` 200; `/id/admin` → login 307; log server bersih | sama |
| `bun audit` | 8 → **6** (kedua advisory `next-intl` hilang) | 8 → **6** |
| Ukuran middleware (Edge) | 58,1 kB → **52,0 kB** | 52,1 kB |

Catatan penting dari spike:
- **v4 hanya ESM** (`"type": "module"`), tetapi bundel runtime `standalone` **memuat `next-intl` ter-bundle** dan **tidak membawa biner native** — image runtime tidak membesar (standalone 98 MB).
- **Dependency baru (semua versi 4.9.2+):** `@swc/core` (biner per platform), `@parcel/watcher`, `next-intl-swc-plugin-extractor`, `icu-minify`, `po-parser`, `negotiator`; `intl-messageformat` 10 → 11, `@formatjs/*` naik. Lock bergeser pada **46 paket**, hampir semuanya biner platform (`@swc/core-*`, `@parcel/watcher-*`, hanya yang cocok yang terpasang). Hanya tahap build/deps yang membawanya: `node_modules` +~12 MB. `bun` memblokir 2 `postinstall` (swc, parcel) tetapi build/produksi tetap berfungsi (biner datang lewat `optionalDependencies`).
- **Jebakan versi:** `bun add next-intl@4.9.2` menarik `use-intl@4.14.9` (rentang `^4.9.2`) → versi campur. Rencana harus **menyematkan keduanya ke versi yang sama persis**.
- Tak ada paket PDF/gambar yang bergeser (pelajaran SEC-05: lock diperiksa untuk drift transitif).

## 4. Perbedaan perilaku yang teramati (semua jinak, tetapi harus dikunci tes)

1. **Prefiks locale**: v3 membalas `x-middleware-rewrite` ke URL yang sama untuk `/id`, `/en`, `/id/hotels`; v4 meneruskan apa adanya. Status tetap 200, halaman identik.
2. **`/%09/evil.com`**: v3 mengalihkan ke `/id//evil.com` (slash ganda); v4 menormalkan jadi `/id/evil.com`. Sama-origin di kedua kasus; v4 lebih bersih (ini inti perbaikan 4.9.1).
3. **Cookie locale**: v4 membuat `NEXT_LOCALE` sebagai *session cookie* (`Path=/; SameSite=lax`) dan hanya bila pengguna berpindah ke locale yang berbeda dari `Accept-Language`. Karena tak ada pengalih bahasa di UI, cookie ini nyaris tak berguna → opsi `localeCookie: false` (keputusan §6).
4. **Header `Link` alternate**: `x-default` kini juga dikirim di sub-halaman (`localePrefix: 'always'`) — baik untuk SEO, tak berdampak fungsional.
5. Sisanya di panduan v4 (`AppConfig` typing, ICU argumen `null`, `format.relativeTime`, multi-domain) **tidak relevan** — tak dipakai.

Sumber: [catatan rilis next-intl 4.0](https://next-intl.dev/blog/next-intl-4-0); advisory [GHSA-8f24-v5vv-gm5j](https://github.com/advisories/GHSA-8f24-v5vv-gm5j) (diperbaiki 4.9.1; perbaikan prototype pollution tercatat di 4.9.2 menurut Snyk).

## 5. Opsi dan rekomendasi

| Opsi | Isi | Penilaian |
|---|---|---|
| **A. Upgrade ke 4.14.9** (disarankan) | Satu PR kecil: bump + sematkan `next-intl` & `use-intl` persis sama, konsolidasi daftar locale (`defineRouting` + `hasLocale`), tes karakterisasi routing | Spike menunjukkan nol perubahan kode wajib dan produksi sehat. Audit 8 → 6. Menutup kebiasaan duduk di v3 yang tak dipelihara |
| B. Tetap di v3, terima | Catat sebagai risiko diterima (sudah terbukti tak terjangkau); pantau advisory baru | Sah. Biaya: tak ada perbaikan keamanan v3 ke depan; advisory baru `next-intl` akan menumpuk |
| C. Pin 4.9.2 | Versi minimum | Tidak disarankan: `use-intl` tetap tertarik ke 4.14.9 (campuran), tak ada keuntungan dibanding A |

**Rekomendasi: A, dijadwalkan SEBELUM go-live** (perubahannya kecil dan sudah terbukti; lebih murah dilakukan sekarang daripada setelah ada lalu lintas produksi). Bukan blocker go-live bila pemilik memilih B.

## 6. Keputusan yang dibutuhkan dari pemilik

1. **A atau B?** (rekomendasi: A).
2. **Cookie locale:** `localeCookie: false` (rekomendasi — tak ada pengalih bahasa; deteksi lewat `Accept-Language` tiap kunjungan) atau tetap session cookie bawaan?
3. **Waktu:** sebelum go-live (disarankan) atau setelahnya.

## 7. Rencana eksekusi (satu PR, urutan tetap — SOP Fase Eksekusi)

**Langkah 0 — Tes karakterisasi dulu (di atas v3, harus hijau SEBELUM bump).** `scripts/test-i18n-routing.ts`: memanggil `middleware()` dengan 20 jalur dari spike (12 bermusuhan, sisanya rute biasa/terlindungi/API) (`/`, `/id`, `/en`, `/id/hotels`, `/xx/hotels`, `/hotels`, varian `//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`, `/%09/evil.com`, `/en/..//evil.com`, `/id@evil.com`, `/id/admin` → admin login, `/id/dashboard` → login, `/api/...` dilewati). Asersi: status; **tidak pernah** redirect ke host selain asal; `/` → `/id`; locale tak dikenal diprefiks `id`. Dimasukkan ke rantai `bun run test` (CI). Mutasi: ubah `LOCALES`/matcher → tes merah.

**Langkah 1 — Bump dependency.** `next-intl@4.14.9` **persis** (tanpa caret) dan `overrides.use-intl: 4.14.9`. Periksa `bun.lock` vs HEAD: perubahan hanya pada keluarga `next-intl`/`use-intl`/`intl-messageformat`/`@formatjs`/`@swc`/`@parcel`/`icu-minify`/`po-parser`/`negotiator`; **tak ada** paket PDF/gambar/React. Tambahkan `next-intl` ke `ignore` Dependabot untuk update mayor.

**Langkah 2 — Kode (kecil, tapi mengikuti praktik v4).**
- `i18n/routing.ts` baru: `defineRouting({ locales: ['id','en'], defaultLocale: 'id', localeCookie: <keputusan §6> })` — satu-satunya sumber daftar locale.
- `middleware.ts`: `createMiddleware(routing)`; hapus `LOCALES` duplikat (tetap gunakan untuk logika auth lewat impor dari `routing`).
- `i18n/request.ts`: `hasLocale(routing.locales, await requestLocale) ? requested : routing.defaultLocale` — menutup impor dinamis dengan nilai mentah.
- `app/[locale]/layout.tsx`: `hasLocale` + `notFound()`; `NextIntlClientProvider` tanpa prop `messages`/`locale` (diwarisi).
- Matcher middleware disesuaikan saran v4 (`/((?!api|_next|_vercel|.*\\..*).*)`) — hati-hati: middleware kita juga melindungi `/dashboard`, `/admin`, `/bookings`, dll.; pastikan tidak ada rute terlindungi yang jatuh dari matcher (tes karakterisasi menjaganya).

**Langkah 3 — Verifikasi pada artefak produksi** (bukan hanya build): `tsc`, `next build` + 0 baris `error:`, `bun server.js` dari `standalone` (halaman `/id`, `/en`, `/id/login`, `/id/hotels`, redirect admin), tes karakterisasi (hijau), `scripts/ci-invoice-smoke.ts`, CI job `docker` (build image sungguhan dengan `bun install --frozen-lockfile` — satu-satunya tempat jalur Docker diuji), `bun audit` (target: 6, tanpa advisory `next-intl`).

**Langkah 4 — Review & dokumentasi.** `security-auditor` fokus pada middleware + routing (matcher tidak membuka rute terlindungi; tak ada redirect lintas host). Perbarui register SEC-05, `docs/decisions.md`, `docs/progress.md`, memori proyek bila ada temuan baru.

**Rollback:** revert satu PR (lock dan kode kembali ke v3); tidak ada migrasi data atau skema.

## 8. Risiko dan mitigasi

| Risiko | Mitigasi |
|---|---|
| ESM-only + Bun di produksi (kelas insiden SEC-05: build/dev lulus, produksi gagal) | Spike sudah lulus di `bun server.js`; langkah 3 mengulangnya + CI docker |
| Matcher/middleware baru melepas rute terlindungi | Tes karakterisasi (rute auth 307 ke login) + review |
| Biner native (`@swc/core`, `@parcel/watcher`) gagal terpasang di image (arsitektur lain) | Hanya tahap build; CI docker membuktikan di runner Linux x64; VPS Hostinger akan Linux — tetap diuji di CI; `bun` memblokir `postinstall` tapi tak diperlukan |
| `use-intl` dan `next-intl` versi campur | Sematkan persis keduanya (langkah 1) |
| Cookie `NEXT_LOCALE` berubah perilaku | Putuskan `localeCookie` (§6); diuji di karakterisasi header |
| Perubahan SEO (`x-default` di sub-halaman) | Bermanfaat; tak perlu mitigasi |

## 9. Ukuran pekerjaan

Satu PR, kira-kira 1–2 jam kerja termasuk verifikasi dan review. Tidak butuh perubahan skema, migrasi, atau pengujian layanan eksternal.

## 10. As-built (2026-10-22)

Keputusan pemilik: **opsi A**. Cookie locale: `localeCookie: false` (rekomendasi; pemilik tidak keberatan) — mudah dibalik bila pengalih bahasa dibangun. Waktu: sebelum go-live.

| Langkah | Hasil |
|---|---|
| 0. Tes karakterisasi di atas v3 | `scripts/test-i18n-routing.ts` (7 tes; 14 jalur bermusuhan, locale, rute terlindungi tamu & berperan, matcher, penjaga sumber) hijau di v3; **10 mutan terbunuh** (rute dibuka, peran dihapus, matcher dilonggarkan, redirect lintas host, token tak diverifikasi, dst.); masuk `bun run test`/CI |
| 1. Bump | `next-intl@4.14.9` persis + `overrides.use-intl: 4.14.9`; lock bergeser pada 49 paket, seluruhnya keluarga `next-intl`/`use-intl`/`intl-messageformat`/`@formatjs`/`@swc`/`@parcel`/`icu-minify`/`po-parser`/`negotiator` + 3 paket `@eloqnt/*` milik `next-intl` 4.14.9; **tak ada** paket PDF/gambar/React/Prisma/MinIO |
| 2. Kode | `i18n/routing.ts` (satu sumber locale, `localeCookie: false`); `middleware.ts` → `createIntlMiddleware(routing)`; `i18n/request.ts` → `hasLocale`; `app/[locale]/layout.tsx` → `hasLocale` + provider tanpa prop. **Penyimpangan dari rencana:** matcher middleware **tidak diubah** — spike dan tes menunjukkan tak ada kebutuhan, dan `/api` tetap dilewati oleh early-return; mengubahnya hanya menambah risiko tanpa manfaat |
| 3. Verifikasi artefak produksi | `tsc`, `next build` (0 baris `error:`), `bun server.js` (standalone): `/id` `/en` `/id/login` `/en/login` `/id/hotels` `/id/transport` `/id/visa` 200, `/` → `/id`, `/id/admin` → login, `/id/dashboard` → login, `//evil.com` → 308 ke origin sama, **tak ada cookie `NEXT_LOCALE`**, `Accept-Language: en` → `/en`, invoice PDF 200, log server bersih; `bun install --frozen-lockfile` lulus; `bun audit` 7 → 5; middleware 58,1 → 51,8 kB |
| 4. Review & dokumen | Lihat register SEC-05 dan `docs/decisions.md` 2026-10-22 |

**Tambahan dari review (2026-10-22):** review menemukan celah LAMA pada gerbang middleware (path mentah vs path kanonik yang di-rewrite next-intl). Perbandingan langsung membuktikan perilakunya **identik di v3 dan v4**, jadi bukan regresi upgrade; diperbaiki di PR yang sama (`lib/auth/gatePath.ts`, SEC-59) dan dikunci tes. Pelajaran umum: tes karakterisasi harus mencakup **rewrite**, bukan hanya redirect — rewrite menentukan halaman yang dirender.

