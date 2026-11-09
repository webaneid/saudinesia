# Arsitektur — Front-end Publik (mulai dari Homepage)

> **Status: DISETUJUI PEMILIK (2026-11-06). F1, F2, dan F3 selesai (2026-11-06). Tahap 2 (§6) diarahkan pemilik 2026-11-09: F4 dan F5 selesai 2026-11-09, F6 menyusul.**
> Urutan pekerjaan menurut pemilik: front-end publik dulu, mulai dari homepage; UI admin terakhir. Istilah "jamaah" tetap dipakai untuk sementara (keputusan pemilik 2026-11-06).

---

## 1. Hasil recheck kode (SOP Fase Eksekusi langkah 1)

Dicek langsung: `app/[locale]/(public)/page.tsx`, `(public)/layout.tsx`, `components/shared/Header.tsx`, `app/globals.css`, `tailwind.config.ts`, `app/layout.tsx`, tombol pesan di semua katalog, dan tampilan di browser (desktop + 375 px).

### 1.1 Homepage dan kerangka publik

| # | Temuan | Lokasi | Fase |
|---|---|---|---|
| A1 | Warna publik biru (`--primary` shadcn), padahal brand hijau + emas hanya aktif di admin. Komentar CSS memang menyatakan "publik tetap biru", jadi ini keputusan lama yang perlu diganti tertulis. | `app/globals.css:11`, `:57` | F1 |
| A2 | Font yang dipakai bukan font brand: `font-sans` menunjuk `Inter` yang tidak pernah dimuat, sehingga jatuh ke font bawaan peramban. Plus Jakarta Sans sudah dimuat tetapi hanya sebagai `font-jakarta`. | `tailwind.config.ts:13`, `app/layout.tsx:5` | F1 |
| A3 | **Di HP tidak ada menu sama sekali**: navigasi `hidden md:flex` tanpa tombol menu. Delapan katalog tak bisa dicapai dari header. | `Header.tsx:27` | F1 |
| A4 | Tidak ada footer: tidak ada kontak, tautan kebijakan privasi, atau identitas usaha. | `(public)/layout.tsx` | F1 |
| A5 | Tombol Dashboard salah untuk peran `manager` (daftar hanya `admin`, `superadmin`), sehingga manager diarahkan ke dashboard jamaah. | `Header.tsx:38` | F1 |
| A6 | Layanan unggulan homepage tidak memuat Paket, Haji, Visa, dan Pesawat, padahal itu ada di menu. Hero mengarahkan "Mulai Rencanakan" ke daftar hotel. | `page.tsx:47-53`, `:69` | F2 |
| A7 | Bagian "Muthowif Terpercaya" menampilkan nama dan rating seolah jamaah memilih orangnya. Sejak 2026-07-20 modelnya booking generik dan Saudinesia yang menugaskan (`docs/arsitektur-muthowif.md` §9). Rating di data lokal juga bukan ulasan sungguhan. | `page.tsx:135-173` | F2 |
| A8 | Warna palet mentah (`text-blue-600`, `bg-green-50`, `fill-amber-400`) melanggar aturan token. | `page.tsx:48-52`, `:120`, `:164` | F2 |
| A9 | Semua teks ditulis langsung dalam bahasa Indonesia, padahal rute `/en` ada. Berkas pesan belum punya bagian homepage. | `page.tsx`, `Header.tsx`, `i18n/messages/*` | F1, F2 |
| A10 | Ejaan campur: "Umrah" di homepage, "Umroh" di produk dan percakapan pemilik. | `page.tsx:59-61`, `app/layout.tsx:13` | F2 |
| A11 | Tidak ada metadata khusus homepage (judul bawaan "Saudinesia", tanpa Open Graph). | `page.tsx` | F3 |
| A12 | Error hydration React sekali muncul di homepage saat dibuka di dev server pada ukuran HP. Penyebab belum ditelusuri, bisa jadi hanya gejala dev. **Tidak muncul lagi setelah F2** (dev, dan artefak produksi `bun server.js` pada desktop + 375 px). Penyebab asli tidak terbukti: pesannya membandingkan markup lama, dan halaman itu sudah ditulis ulang. | `page.tsx` (`LandingPage`) | F2 |

### 1.2 Syarat pemilik: "kalau semua alur booking sudah aman" — BELUM terpenuhi seluruhnya

Mesin booking dan jalur admin sudah diuji (simulasi 2026-11-06). Jalur **pelanggan** belum:

| Produk | Tombol di katalog publik sekarang | Bisa dibeli sendiri di browser? |
|---|---|---|
| Visa | `bookings/checkout/visa` (hanya Visa only) | Ya, tetapi belum diuji ujung ke ujung |
| Transport | `bookings/checkout/transport` | Ya, tetapi belum diuji ujung ke ujung |
| Paket, Haji, Ziarah, Hotel, Muthowif | `/register` lalu buntu | **Tidak** |
| Pesawat, Katering | Tidak ada tombol pesan | **Tidak** |

Masih terbuka juga:
- Booking lunas tidak bisa dibatalkan, dan pemrosesan refund belum ada (menunggu aturan refund dari pemilik).
- Belum ada rekening bank aktif di Pengaturan Invoice, jadi pelanggan tidak punya tujuan transfer.
- Pembayaran bertahap dan buku kas (Fase 7), serta front-end pelanggan di atas mesin baru (Fase 11 `docs/arsitektur-booking-engine-v2.md`) belum dikerjakan.

**Akibat bagi rencana ini:** homepage tidak mengubah alur booking, jadi aman dikerjakan lebih dulu. Tetapi homepage tidak boleh menjanjikan pembelian yang belum bisa dilakukan, dan situs belum siap menerima pelanggan sungguhan sampai jalur pelanggan selesai.

---

## 2. Keputusan yang diusulkan

| # | Usulan | Alasan |
|---|---|---|
| K1 | Publik memakai brand hijau + emas lewat satu perubahan token `--primary`/`--ring` di `:root`; blok `.admin-canvas`/`.brand-scope` jadi tak perlu. Menggantikan keputusan "publik tetap biru". | Satu identitas di seluruh situs. Seluruh katalog, login, dan area jamaah ikut berubah tanpa mengedit tiap halaman. |
| K2 | Plus Jakarta Sans menjadi `font-sans`, `Inter` dibuang. | Font brand yang sudah dimuat, tanpa berkas tambahan. |
| K3 | Hanya data dan klaim yang benar: tanpa angka jamaah, testimoni, atau izin usaha sampai pemilik memberi datanya. | Situs ibadah dan pembayaran bergantung pada kepercayaan; klaim karangan berisiko hukum. |
| K4 | Harga di homepage hanya harga jual dari `lib/pricing/engine/read.ts`, tak pernah modal. | Aturan `docs/arsitektur-harga-terpadu.md`. |
| K5 | Tanpa pustaka animasi atau karusel baru. | Halaman Server Component murni, ringan di HP. |
| K6 | Hero memakai permukaan hijau dengan pola geometri SVG buatan sendiri; foto bisa dipasang kemudian. | Belum ada foto yang berhak dipakai (basis data lokal hanya 1 foto produk). |
| K7 | Ejaan publik "Umroh". | Mengikuti pemilik dan nama produk. |

---

## 3. Struktur homepage baru

Semua bagian Server Component, data dari katalog aktif. Bagian tanpa data disembunyikan, bukan ditampilkan kosong.

1. **Hero** — judul, satu kalimat nilai ("satu operator, satu invoice"), tombol utama ke Paket, tombol kedua ke Visa.
2. **Pilih kebutuhan** — delapan layanan sesuai menu: Paket, Haji, Visa, Pesawat, Hotel, Transport, Muthowif, Ziarah (Katering lewat Paket atau menu).
3. **Paket Umroh unggulan** — dari `Package` (`isFeatured`, lalu terbaru), foto dan harga jual.
4. **Visa** — produk visa aktif dengan harga "Mulai dari"; satu-satunya bagian dengan tombol beli langsung.
5. **Hotel dekat Haram** — Makkah dan Madinah, bintang, jarak, harga termurah periode berjalan.
6. **Pendamping muthowif** — kartu layanan tanpa daftar nama, harga per hari, kalimat "kami yang menugaskan".
7. **Cara kerja** — pilih layanan, isi data jamaah, bayar dan unggah bukti, tim memverifikasi. Sesuai alur nyata.
8. **Ajakan akhir** — daftar akun.

Kerangka (sudah dibangun F1): satu daftar menu `components/shared/publicNav.ts`, dipakai header, menu HP `PublicMobileNav` (panel lewat portal karena header memakai `backdrop-filter`), dan `PublicFooter`. Menu lengkap baru tampil di lebar ≥ 1280 px (`xl`), karena pada 1024 px delapan menu + tombol akun meluap dengan font brand. Warna untuk area publik/jamaah = token Tailwind `brand` (`brand-dark`, `brand-gold`, …), bukan `admin-*`.

Komponen bagian homepage di `app/[locale]/(public)/_home/`, satu berkas per bagian. Pengambilan data terpusat di `lib/catalog/home.ts`, supaya `page.tsx` hanya menyusun.

Catatan as-built F2: bagian Visa memberi tombol ajukan hanya bila `canBuyDirectly` (tanpa produk wajib lain dan sudah berharga), selain itu tombol detail ke katalog. Harga belum ada (`null`) disembunyikan. Kalimat ketersediaan di bawah Cara kerja (`home.steps.availability`) dihapus setelah checkout produk lain ada. Teks dari data produk (nama, `priceLabel`) tidak diterjemahkan di `/en`, karena belum ada kolom terjemahannya.

Catatan as-built F3: alamat situs dan tautan antarbahasa ada di `lib/seo/site.ts`, juga dipakai robots dan sitemap. `NEXT_PUBLIC_APP_URL` kosong atau salah jatuh ke `https://saudinesia.com`, bukan meruntuhkan layout akar. Homepage belum punya gambar Open Graph sampai ada foto atau logo yang berhak dipakai (§5). `<html lang>` dibaca lewat `getLocale()` di layout akar, sehingga halaman 404 ikut bahasa URL dan teksnya diterjemahkan. Halaman katalog lain belum punya metadata sendiri: judulnya tetap "Saudinesia".

---

## 4. Fase

Satu PR per fase. Setiap fase: `bun run build`, security check, uji di browser pada desktop dan 375 px, lalu dokumentasi.

| Fase | Isi | Bukti selesai |
|---|---|---|
| **F1 Kerangka** | K1, K2, menu HP, footer, perbaikan peran manager (A5), pesan `nav`/`footer` id + en. | Semua halaman publik hijau, admin tak berubah; menu HP mencapai 8 katalog; manager ke `/admin`. |
| **F2 Homepage** | §3, `lib/catalog/home.ts`, pesan `home` id + en. | Tiap harga sama dengan `price_points`; tanpa data tetap rapi; tanpa kelas palet mentah. |
| **F3 SEO & penjaga** | Metadata + Open Graph + `hreflang`; `<html lang>` mengikuti locale (kini selalu `id`, `app/layout.tsx`); `scripts/test-public-home.ts`: tanpa palet mentah, tanpa kolom modal, tiap tautan homepage menuju rute yang ada. | Skrip merah bila dilanggar; `bun run build` hijau. |

**Di luar lingkup:** halaman katalog lain selain ikut warna dan font (menyusul satu per satu; warna kategori jenis Haji di `haji/page.tsx:26-31` masih palet mentah), menu area jamaah di HP, checkout pelanggan (Fase 11 mesin booking), UI admin, penggantian istilah "jamaah".

---

## 5. Yang dibutuhkan dari pemilik

Tidak menghalangi F1–F3; bagian terkait disembunyikan sampai datanya ada.

- Nomor WhatsApp dan email layanan pelanggan untuk footer.
- Nama badan usaha dan izin (mis. PPIU) bila ingin ditampilkan.
- Logo dan foto yang berhak dipakai.

---

## 6. Tahap 2 — Hero dan CTA di setiap katalog, lalu konten yang bisa diedit (arahan pemilik 2026-11-09)

> Arahan pemilik: setiap halaman katalog produk selalu punya hero dan CTA seperti homepage, supaya konsisten. Buat satu dulu sampai benar, katalog lain mengikuti. Sesudah itu, setelan dan halaman admin khusus supaya seluruh teks front-end (hero sampai CTA) bisa diedit. CSS dipakai ulang supaya ringan.

### 6.1 Recheck (2026-11-09)

- Hero dan CTA homepage hanya ada di `_home/HomeHero.tsx` dan `_home/HomeCta.tsx`, dengan kelas tombol yang ditulis ulang di masing-masing berkas. Pola geometri ada di `_home/HomePattern.tsx`.
- Halaman katalog (`packages`, `visa`, `hotels`, `haji`, `transport`, `muthowif`, `tours`, `flight`, `catering`) membuka dengan judul polos `h1` + paragraf, tanpa hero dan CTA. Teksnya ditulis langsung dalam bahasa Indonesia.
- Katalog Paket memakai palet mentah (`text-green-500`) dan tanda centang berupa karakter teks, bukan ikon Lucide. Tombol "Pesan Paket Ini" menuju `/register`, yang buntu (§1.2). Perilaku ini **tidak diubah** di F4, karena checkout Paket belum ada.

### 6.2 Rancangan

| # | Keputusan | Alasan |
|---|---|---|
| H1 | Satu komponen `PageHero` dan satu `PageCta` di `components/shared/public/`, dipakai homepage dan semua katalog. Pola geometri dipindah ke `BrandPattern` di folder yang sama. | Satu desain, satu tempat diubah. |
| H2 | Tombol brand jadi kelas komponen di `globals.css` (`btn-brand-gold`, `btn-brand-glass`, `btn-brand-outline`), bukan rangkaian utilitas yang disalin. | Permintaan pemilik: CSS dipakai ulang, ringan. |
| H3 | Hero menerima isi sebagai data (`HeroContent`: label kecil, judul, subjudul, dua tombol). Gambar latar opsional dengan lapisan hijau gelap (gaya foto + overlay). Tanpa gambar, permukaan hijau + pola (K6). | Bentuk isi sudah sama dengan yang nanti disimpan admin di F5. Foto baru dipasang bila ada yang berhak dipakai. |
| H4 | Hero katalog boleh memuat fakta dari data nyata (mis. jumlah paket aktif, harga mulai). Fakta tanpa data disembunyikan. | K3: hanya klaim yang benar. |
| H5 | Isi bawaan tetap di berkas pesan (`catalog.<halaman>.hero/cta`, id + en). Satu pembaca `lib/public-content/` mengembalikan isi halaman. Di F4 pembaca hanya membaca pesan; di F5 suntingan admin menimpa pesan, dan pesan tetap jadi cadangan. | Halaman tidak perlu diubah lagi saat F5 masuk. |
| H6 | Tautan tombol hanya boleh menuju rute publik dari daftar putih (`PUBLIC_NAV`, beranda, daftar akun), tidak pernah alamat bebas. | Cegah tautan keluar atau open redirect saat isi bisa diedit. |

### 6.3 Fase

| Fase | Isi | Bukti selesai |
|---|---|---|
| **F4 Hero & CTA bersama + katalog Paket** | H1–H5. Homepage memakai komponen bersama (tampilan sama). Katalog Paket: hero, kartu dengan token brand dan ikon Lucide, CTA, metadata + hreflang. Penjaga `scripts/test-public-home.ts` diperluas ke katalog yang sudah dirombak. | Homepage tampak sama seperti sebelumnya; katalog Paket rapi di desktop dan 375 px; penjaga merah bila dilanggar; `bun run build` hijau. |
| **F5 Konten situs bisa diedit** | Tabel isi halaman publik per halaman + bahasa (kolom JSON divalidasi Zod `.strict()`, teks polos dengan batas panjang, penanda pengubah dan waktu); halaman admin Sistem → Konten Situs (daftar halaman, editor per halaman dari hero sampai CTA, pratinjau, kembalikan ke bawaan); foto hero lewat registry media (`docs/arsitektur-media.md`); tautan hanya dari daftar putih H6; halaman publik disegarkan saat disimpan. Rincian peran, jejak perubahan, dan bentuk tabel ditulis di sini sebelum F5 dieksekusi. | Suntingan admin tampil di halaman publik; kosongkan = kembali ke bawaan; tautan di luar daftar putih ditolak 400. |
| **F6 Katalog lain mengikuti** | Visa, Hotel, Haji, Transport, Muthowif, Ziarah, Pesawat, Katering memakai `PageHero` + `PageCta` dan pola kartu F4, satu PR per beberapa halaman. | Semua katalog punya hero + CTA, terdaftar di penjaga. |

### 6.4 As-built F4 (2026-11-09)

- `components/shared/public/`: `PageHero` (`size` `lg` beranda / `md` katalog, `facts` opsional), `PageCta`, `BrandLink`, `BrandPattern` (pindahan `_home/HomePattern`). `_home/HomeHero` dan `_home/HomeCta` dihapus; beranda memakai komponen bersama dengan tampilan sama.
- Kelas `btn-brand`, `btn-brand-gold`, `btn-brand-glass`, `btn-brand-solid` di `app/globals.css`.
- `lib/public-content/content.ts`: registry halaman (`home` → pesan `home`, `packages` → pesan `catalog.packages`) dan tujuan tombolnya. `lib/public-content/links.ts`: `LINK_TARGETS`, `targetHref` (melempar galat di luar daftar putih), `CATALOG_ANCHOR`.
- Katalog Paket: hero (fakta jumlah paket, harga mulai, satu invoice; disembunyikan bila tak ada paket), daftar `#catalog` dengan kartu token brand dan ikon `Check`, harga belum ada disembunyikan (bukan "Rp 0"), CTA, metadata + hreflang. Urutan diberi tie-breaker `id`.
- **Deviasi dari H3:** foto latar hero belum dibuat di F4. Ditambahkan di F5 bersama unggahannya, supaya kode gambar tidak masuk tanpa pernah dipakai.
- Penjaga `scripts/test-public-home.ts`: komponen bersama dan katalog dirombak ikut diperiksa (palet, modal, tautan); tiap tujuan daftar putih harus rute yang ada; beranda dan katalog wajib `PageHero` + `PageCta` + `getPageContent`; katalog wajib metadata + `localizedAlternates(locale, '<path>')` + elemen `#catalog`; selain komponen bersama tidak boleh merakit `panel-brand`. Katalog yang dirombak di F6 ditambahkan ke `REDESIGNED_CATALOGS`.


### 6.5 Rancangan rinci F5 — Konten Situs (ditulis 2026-11-09, sebelum eksekusi)

Recheck: foto produk lewat registry `lib/media/owners.ts` (pemilik berlabel `superadminOnly` sudah didukung); jejak perubahan setelan memakai tabel append-only `settings_audit` (`lib/invoice/audit.ts`); grup menu Sistem hanya untuk superadmin (`lib/admin/navigation.ts`); halaman edit admin = `EditPage` + `useEditEntity` + `useDirtyForm`.

| # | Keputusan |
|---|---|
| C1 | **Semua teks halaman bisa diedit, bukan hanya hero dan CTA.** Yang bisa diedit = setiap kunci daun di namespace pesan halaman itu (`home`, `catalog.packages`), dalam id dan en. Kunci berformat ICU (berisi `{`, mis. jumlah, harga, bintang) TIDAK bisa diedit, karena nilainya diisi data dan salah ketik akan merusak halaman. Daftar kolom diturunkan otomatis dari berkas pesan, jadi teks baru di halaman langsung muncul di editor tanpa daftar yang dihafal. |
| C2 | Satu tabel `public_page_contents`: satu baris per halaman (`pageKey` unik), kolom `content` JSON berbentuk `{ text: { id: {kunci: teks}, en: {...} }, links: { "hero.primary": tujuan \| null } }`, `updatedAt` (`timestamptz`). Teks kosong/tidak ada = pakai teks bawaan; tautan `null` = tombol disembunyikan, tidak ada = tujuan bawaan. Tujuan tombol tidak tergantung bahasa. Tanpa kolom pengguna (pengubah dicatat di jejak). |
| C3 | Ditulis HANYA oleh `lib/public-content/service.ts`: validasi Zod `.strict()` (kunci harus kolom yang bisa diedit, teks polos dipangkas maks 400 karakter tanpa karakter kontrol selain baris baru, tujuan dari `LINK_TARGETS`), kunci baris + `expectedUpdatedAt` (409 bila basi), jejak `settings_audit` (`entity = 'public_page'`, hanya kolom yang berubah) di transaksi yang sama. "Kembalikan ke bawaan" = mengosongkan isi (jejak tercatat), bukan menghapus baris. |
| C4 | Dibaca HANYA lewat `getPageContent`/`getPageText` (`lib/public-content/content.ts`, `cache()` per permintaan): suntingan menimpa pesan, pesan jadi cadangan. Bagian beranda berhenti memanggil `getTranslations` untuk namespace halamannya (dijaga penjaga). Halaman publik sudah dinamis, jadi suntingan langsung tampil tanpa revalidasi. |
| C5 | Foto latar hero: pemilik media `public_page` (mode `featured`, `superadminOnly`), id = id baris halaman. Hero dengan foto memakai lapisan hijau gelap di atas foto (gaya foto + overlay); tanpa foto tetap permukaan hijau + pola. |
| C6 | Admin: **Sistem → Konten Situs** (superadmin, sejalan grup Sistem): daftar halaman (`/admin/system/site-content`) dan editor per halaman (`/[page]`) memakai `EditPage`: kolom kiri dikelompokkan per bagian (Hero, Layanan, …, CTA) dengan tab bahasa, teks bawaan jadi placeholder; kanan: Simpan, Foto hero, Tujuan tombol, Kembalikan ke bawaan, Lihat halaman. API: `GET /api/v1/admin/site-content`, `GET`/`PUT /api/v1/admin/site-content/[page]` (`requireSuperAdmin` di awal handler). |
| C7 | Halaman tidak bisa dibuat/dihapus dari admin (daftar halaman ada di kode, mengikuti rute yang ada); "hapus" = kembalikan ke bawaan. Ini memenuhi aturan CRUD: isi bisa dilihat, diubah, dan dikosongkan. |
| C8 | Teks dari admin tampil sebagai teks React biasa (di-escape), tidak pernah HTML. Isi tidak memuat data pribadi; tabel tidak perlu ditangani `lib/account/deletion.ts` (pengubah hanya di `settings_audit`, yang sudah ditangani). |

Uji: `scripts/test-site-content.ts` (murni: kolom ICU tak bisa diedit, kunci asing/terlalu panjang/tujuan di luar daftar putih ditolak, penggabungan bawaan + suntingan, tombol tersembunyi) + perluasan `scripts/test-public-home.ts` (bagian beranda tak membaca namespace halaman langsung) + uji nyata API (400/403/409) + browser.

### 6.6 As-built F5 (2026-11-09)

Sesuai §6.5, dengan catatan:
- Registry halaman dan turunan kolom ada di `lib/public-content/pages.ts` (murni, tanpa DB/next-intl); `content.ts` hanya pembaca (`getPageText(locale, page, bagian?)`, `getPageContent`); `service.ts` penulis tunggal + `parseStoredContent` (isi tersimpan yang asing/rusak dibuang, tidak merusak halaman).
- Kunci kolom dibatasi bentuk camelCase bersegmen (`^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$`); kunci berkas pesan baru wajib mengikuti bentuk ini.
- Editor (`system/site-content/[page]/SiteContentEditor.tsx`): tab bahasa, kolom per bagian dengan teks bawaan sebagai placeholder, bagian SEO paling bawah dengan label jelas, kotak Tombol (bawaan / sembunyikan / tujuan daftar putih), Foto Hero, Lihat halaman, Kembalikan ke bawaan (konfirmasi). Terdaftar di `scripts/test-admin-editor.ts` (entri berkas `.tsx` di folder halaman).
- `PageHero` dengan foto: `<img>` penuh + gradasi `brand-dark`; tanpa foto tetap pola.
- Uji: `scripts/test-site-content.ts` (masuk `bun run test`), `test-public-home` membaca registry dari `pages.ts`, `test-media` memetakan `public_page` ke editor.
- Katalog lain (F6) cukup: entri di `PUBLIC_PAGES` + pesan `catalog.<halaman>` id/en + `PageHero`/`PageCta` + `getPageText`; editornya otomatis ikut.

