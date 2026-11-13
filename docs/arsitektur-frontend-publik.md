# Arsitektur — Front-end Publik (mulai dari Homepage)

> **Status: DISETUJUI PEMILIK (2026-11-06). F1, F2, dan F3 selesai (2026-11-06). Tahap 2 (§6) diarahkan pemilik 2026-11-09: F4, F5, dan F6 selesai 2026-11-09 — semua katalog memakai satu pola. Tahap 3 (§7, F7 layanan tampil hanya bila berproduk) selesai 2026-11-09.**
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


### 6.7 Rancangan F6 — katalog lain mengikuti pola Paket (ditulis 2026-11-09, sebelum eksekusi)

Arahan pemilik: "duplikasi untuk semua katalog". Recheck delapan halaman (`visa`, `haji`, `hotels`, `transport`, `muthowif`, `tours`, `flight`, `catering`):

| # | Temuan | Halaman |
|---|---|---|
| R1 | Judul polos tanpa hero/CTA/metadata; teks Indonesia ditulis langsung (tanpa `/en`). | semua |
| R2 | Palet mentah (`teal-*`, `amber-*`, `slate-*`, `green-500`, `red-500`), tanda centang karakter "✓"; Pesawat memakai token `admin-*` di halaman publik. | visa, haji, tours, flight, catering, `TransportSearch` |
| R3 | Harga belum ada bisa tampil "Rp 0" (default 0). | visa, hotels, tours, catering |
| R4 | Filter Hotel berupa pil, bintang memakai emoji — melanggar aturan tabel (filter = `FilterSelect` di `FilterBar`) dan larangan emoji. | hotels |
| R5 | Muthowif menampilkan rating, padahal bukan ulasan sungguhan (A7). Katering memuat klaim "Halal bersertifikat / Chef berpengalaman / …" tanpa data (K3). | muthowif, catering |

Keputusan:
- **G1** Setiap katalog: `PageHero` (fakta dari data nyata) → daftar `#catalog` → `PageCta`, metadata + hreflang lewat satu pembantu `catalogMetadata(locale, page)` (`lib/public-content/metadata.ts`, juga dipakai Paket). Semua teks di pesan `catalog.<halaman>` id + en, dibaca lewat `getPageText`, jadi otomatis bisa diedit di Konten Situs (entri `PUBLIC_PAGES`).
- **G2** Kepingan dipakai ulang: `CatalogSection` (judul + deskripsi + jangkar `#catalog` + keadaan kosong) dan `PriceTag` (label, harga, satuan, catatan; tidak tampil bila belum berharga) di `components/shared/public/`, kelas kartu `.catalog-card` di `globals.css`.
- **G3** Warna hanya token `brand`/shadcn; jenis Haji dibedakan label, bukan warna mentah.
- **G4** Hotel: filter kota dan bintang lewat `FilterSelect` (mode `nav`) di `FilterBar`; param asing diabaikan (daftar putih).
- **G5** Muthowif: rating dihapus dari kartu (A7); daftar profil tetap, kalimat "Saudinesia yang menugaskan" dipertahankan. Katering: blok "Keunggulan" berisi klaim tanpa data dihapus (K3); bisa dikembalikan bila pemilik memberi data yang benar.
- **G6** Perilaku tombol pesan tidak diubah (Visa → checkout bila bisa dibeli langsung; lainnya tetap seperti sekarang). Halaman detail (`hotels/[id]`, `muthowif/[id]`) di luar lingkup F6.
- **G7** Penjaga: semua delapan masuk `REDESIGNED_CATALOGS` di `scripts/test-public-home.ts` (palet, modal, tautan, hero/CTA, metadata, `#catalog`).

### 6.8 As-built F6 (2026-11-09)

Kedelapan katalog (`visa`, `haji`, `hotels`, `transport`, `muthowif`, `tours`, `flight`, `catering`) kini sama dengan Paket: `PageHero` dengan fakta dari data → `CatalogSection` (`#catalog`) → `PageCta`; metadata lewat `catalogMetadata` (Paket ikut dipindah). Semua teks di `catalog.<halaman>` id + en, terdaftar di `PUBLIC_PAGES` — sepuluh halaman bisa diedit di Konten Situs, tujuan tombol bawaan: hero utama `#catalog`, hero kedua katalog terkait, CTA `register`.

- **Fakta hero** hanya dari data aktif: jumlah produk, harga jual termurah (> 0), lalu satu fakta per katalog (proses visa tercepat, total kursi Haji, hotel terdekat dari Haram, jumlah jenis kendaraan, jumlah situs, musim katering yang berlaku). Tak ada data → tak ada fakta.
- **Harga** lewat `PriceTag`: belum berharga = tidak ada angka (Haji: "Harga belum ditetapkan"; Pesawat: "—"). Visa tanpa harga tidak menampilkan tombol "Ajukan" (server tetap menolak 422); rute Transport tanpa kendaraan berharga tidak menampilkan "Pesan sekarang".
- **Waktu:** Hotel dan Katering memakai `dbDateOf(todayInApp())` untuk periode/musim berjalan (sebelumnya `new Date()` instan — bisa meleset sehari di 00:00–07:00 WIB).
- **Hotel:** filter `FilterSelect` (kota daftar tetap, bintang dari data; nilai asing diabaikan) di `FilterBar`; hotel dimuat semua lalu difilter di memori (master data kecil) sehingga fakta hero tetap seluruh katalog. Kartu memakai `ProductImage` (bukan `next/image` `unoptimized`).
- **Transport:** `TransportSearch` (klien) menerima semua teks dari halaman (`labels`), warna token brand, kategori lewat `FilterSelect` (mode `onChange`) — pil dihapus. Kunci kategori DB `city_tour` dipetakan ke kunci pesan `cityTour` (C1: kunci camelCase).
- **Pesawat:** nama maskapai dari pembaca `lib/catalog/flight.ts` (hanya `vendor.name`); halaman publik tidak lagi menyentuh tabel `productCost`. Token `admin-*` diganti token brand.
- **Muthowif:** rating dihapus (G5), urut nama. **Katering:** blok "Keunggulan" dihapus (G5).
- **Ziarah:** tautan peta situs lewat `safeExternalUrl` (`lib/public-content/links.ts`, hanya http/https) — `gmapsUrl` admin bisa berisi `javascript:` (SEC-220, validator admin masih terbuka).
- **Penjaga:** `scripts/test-public-home.ts` — kedelapan katalog di `REDESIGNED_CATALOGS` (+ `TransportSearch.tsx` dipindai gaya/modal); setiap katalog wajib `catalogMetadata(…, '<halaman>')`, `PageHero`, `PageCta`, `CatalogSection`, `getPageContent`, dan tidak memakai `getTranslations`.

Celah yang diketahui (di luar lingkup F6): halaman detail `hotels/[id]` dan `muthowif/[id]` belum dirombak; teks kit tabel bersama (`FilterBar` "Atur ulang", `FilterSelect` "Ketik untuk mencari…", `SearchForm`) masih Indonesia di `/en`; label komponen visa plus (`model.parts`) masih Indonesia; memilih filter Hotel memuat ulang halaman ke posisi atas (bukan ke `#catalog`); tombol pesan Paket/Haji/Ziarah masih ke daftar akun (checkout belum ada, §1.2).

## 7. Tahap 3 — Layanan tampil hanya bila ada produknya (arahan pemilik 2026-11-09)

> "Jika produknya terisi … tampilkan shortcut produk-nya di menu maupun home page. Jika tidak ada produk 1 pun, maka jangan ditampilkan … di manapun. Jika sudah mulai ada baru tampilkan." Tujuan: operator memilih sendiri layanan mana yang dipakai dulu; situs tidak menjanjikan layanan yang belum ada (sejalan K3).

### 7.1 Recheck (2026-11-09)

| Tempat | Perilaku sekarang |
|---|---|
| Menu desktop `Header` + menu HP `PublicMobileNav` (klien) | Selalu delapan layanan dari `PUBLIC_NAV` |
| `PublicFooter` | Delapan layanan + Katering (ditulis manual) |
| Beranda `HomeServices` (kotak layanan) | Selalu delapan |
| Beranda Paket/Visa/Hotel/Muthowif | **Sudah** tersembunyi bila kosong (`lib/catalog/home.ts`) |
| Tombol hero/CTA (`getPageContent`) | Bisa menuju katalog kosong (mis. hero beranda → Visa) |
| `app/sitemap.ts` | Sepuluh alamat tetap |
| Halaman katalog | Tetap terbuka dengan keadaan kosong "akan segera tersedia" |
| Detail `hotels/[id]`, `muthowif/[id]` | **Sudah** 404 untuk produk nonaktif |

### 7.2 Keputusan

- **V1 Satu sumber:** `lib/catalog/availability.ts` — `CATALOG_KEYS` (sembilan: delapan menu + `catering`), aturan "ada produk" per layanan = SAMA dengan `where` daftar di halaman katalognya (baris aktif: Paket, Haji, Visa, Hotel, rute Transport, Muthowif, Paket Ziarah, Katering; Pesawat = jadwal aktif pada rute aktif). Tidak bergantung harga: produk aktif yang belum berharga tetap membuat layanannya tampil (harga tak tampil, §6.8). `availableCatalogs()` dibungkus `cache()` React — satu set kueri ringan (`findFirst`) per permintaan, tanpa cache antar-permintaan, jadi produk pertama yang diaktifkan langsung membuat layanannya tampil, dan menonaktifkan produk terakhir langsung menyembunyikannya.
- **V2 Menu dan beranda:** `Header`, `PublicMobileNav` (menerima daftar dari `Header`, tidak mengambil data sendiri), `PublicFooter`, dan `HomeServices` hanya menampilkan layanan yang tersedia; kotak layanan beranda hilang bila tak satu pun tersedia. Katering tetap hanya di footer (bukan menu utama) seperti sekarang.
- **V3 Halaman katalog:** layanan tanpa produk → `notFound()` (404), termasuk untuk pengunjung yang mengetik alamatnya. Keadaan kosong di `CatalogSection` tetap untuk hasil filter/pencarian.
- **V4 Tombol hero/CTA:** `getPageContent` menyembunyikan tombol yang tujuannya katalog tanpa produk (sama seperti tombol yang disembunyikan admin). Editor Konten Situs menandai tujuan itu "belum ada produk — tombol disembunyikan sampai ada" supaya admin tidak bingung.
- **V5 Sitemap:** hanya katalog yang tersedia.
- **V6 Di luar lingkup:** area jamaah dan checkout tidak berubah (checkout butuh `productId`, katalog kosong tidak punya). Admin tidak berubah — produk tetap dikelola seperti biasa.
- **V7 Penjaga:** uji murni + sumber di `scripts/test-public-home.ts`: menu/footer/beranda/sitemap memakai `availableCatalogs`, setiap halaman katalog memanggil `requireCatalog`, setiap kunci `PUBLIC_NAV` punya aturan di `availability.ts`, dan uji DB sekali pakai: layanan tanpa produk aktif → tidak tersedia, satu produk aktif → tersedia, dinonaktifkan → hilang lagi.

### 7.3 As-built F7 (2026-11-09)

Sesuai §7.2, dengan tambahan:
- **Catatan "Cara kerja"** di beranda (`HomeSteps`) hanya menyebut layanan yang ada: Visa + Transport, salah satunya, atau tanpa catatan (kunci baru `home.steps.availabilityVisa`/`availabilityTransport`, bisa diedit di Konten Situs).
- **Menu HP** tidak dirender sama sekali bila tak ada layanan berproduk (tombol menu ikut hilang).
- **Admin Konten Situs:** kartu halaman katalog tanpa produk menampilkan "Belum ada produk aktif — halaman ini dan menunya disembunyikan dari situs …"; pilihan tujuan tombol ke layanan kosong diberi label "(belum ada produk — tombol disembunyikan)".
- **Bukti:** artefak produksi (`bun server.js`) dijalankan pada database KOSONG sekali pakai → sembilan katalog 404, menu/footer/kotak layanan/tombol hero ke katalog/catatan Cara kerja tidak tampil, sitemap hanya beranda; artefak yang sama pada database dev → sembilan katalog 200, menu delapan, footer sembilan (dengan Katering), tombol hero tampil, sitemap lengkap. Uji DB sekali pakai (`scripts/test-catalog-availability.ts`): satu Katering aktif → tampil, dinonaktifkan → hilang.

Celah yang diketahui: teks hero beranda bawaan menyebut semua layanan ("Visa, hotel, transportasi, muthowif, dan paket …") — itu teks bebas yang diedit admin di Konten Situs, tidak disaring otomatis; ubah di sana bila layanan tertentu belum dibuka.


## 8. Audit front-end menyeluruh + simulasi alur (2026-11-11, arahan pemilik "evaluasi total semua front-end")

Dijalankan di server uji terpisah (port 6270) di atas **salinan** DB dev (`saudinesia_tmp_audit`, email/WA dimatikan) — data dev pemilik tidak disentuh. Simulasi lewat browser sungguhan: daftar akun baru → aktivasi → checkout Visa 2 jamaah (jenjang 1–30 hari) → invoice terbit → "Jadikan saya jamaah" → unggah paspor → unggah bukti transfer → admin mengonfirmasi pembayaran (status "Dikonfirmasi", sisa Rp 0) → jamaah mengisi data tambahan. Halaman checkout kesembilan jenis (Paket, Visa, Transport, Haji, Hotel, Ziarah, Muthowif, Katering, Tiket) dan keranjang terbuka 200 sebagai jamaah; semua tombol pesan katalog menuju `/checkout/...`; belum login → login dengan `next` → kembali ke checkout yang sama.

### 8.1 Celah yang ditemukan dan DIPERBAIKI

| # | Celah | Dampak | Perbaikan |
|---|---|---|---|
| G1 | Kolom manifest **non-kartu** (mis. "Nomor HP Host", "Short Address" di Visa Istidhofah) hanya bisa diisi petugas; checkout tidak lagi mengumpulkan data jamaah | Pemesan **tidak pernah bisa** mengajukan jamaahnya untuk diperiksa (tombol Ajukan mati) — alur utama buntu | Route pemilik `PUT /api/v1/bookings/[id]/pilgrims/[pilgrimId]` + penulis `lib/pilgrims/extraFields.ts` (`saveExtraFields`): hanya kolom yang TIDAK terikat peran kartu (`cardBoundKeys`), kolom kartu/asing → 400, hanya booking aktif milik sesi (lainnya 404), data `submitted|verified` terkunci (409), kunci `users FOR SHARE` → `booking_pilgrims FOR UPDATE`, `onboardingRefusal` + `ipLimited` + skema strict. Formulir "Data tambahan" (`PilgrimExtraFields`, memakai `ManifestFieldsForm`) di halaman jamaah. Uji `scripts/test-pilgrim-extra-fields.ts` |
| G2 | Tombol "Keluar" di area jamaah menampilkan JSON mentah `{"success":true,"data":null}` | Pengguna tertinggal di halaman API | `POST /api/v1/auth/logout`: kiriman formulir → 303 ke `/{locale}/login` (locale lewat `safeLocale`, `Location` relatif — tak ada alihan ke luar); `fetch` admin tetap JSON |
| G3 | Booking **visa saja** tak punya tanggal berangkat ("Berangkat -" di detail, daftar, pengingat) | Tanggal acuan hilang | `itemDateRange`: tanpa item bertanggal, rencana berangkat visa paling awal jadi `departureDate` (cadangan saja; tanggal kembali tak ditebak); route admin yang mengubah rencana berangkat memanggil `recomputeBookingDates`. Uji di `test-booking-lifecycle` (4 zona waktu) |
| G4 | Pelanggan memilih jenjang "1–30 hari", invoice/detail menulis "1 hari" (hari awal jenjang) | Rincian pesanan salah baca | Teks dari kunci varian titik harga yang dipakai (`lib/booking/visaDuration.ts`); `itemDetail` snapshot kini "1–30 hari"; detail booking jamaah/admin membaca `visaTierTexts` (snapshot berlaku) |
| G5 | Catatan beranda "baru Visa dan Transport yang bisa dipesan online" masih tampil (§F2 sudah menetapkan dihapus setelah checkout lain ada) | Klaim tidak benar (K3) | Catatan + kunci pesan `home.steps.availability*` dihapus |
| G6 | Tombol katalog Paket Ziarah bertuliskan "Tambah ke paket" padahal membuka checkout | Membingungkan | "Pesan sekarang" / "Book now" |
| G7 | Detail `muthowif/[id]` menampilkan rating "5.0 / 5.0" (bukan ulasan sungguhan, A7), teks Indonesia ditulis langsung, tanpa metadata | Klaim palsu; `/en` berbahasa Indonesia | Rating dihapus; teks `catalog.muthowif.detail` (id/en, bisa diedit di Konten Situs); `generateMetadata` (judul = nama, canonical/hreflang); `requireCatalog`; id bukan UUID → 404 |
| G8 | Detail `hotels/[id]`: hotel Madinah ditulis "dari Masjid Al-Haram"; teks Indonesia langsung; palet mentah (`amber`, `green`, `black`, `white`) dan token `admin-*` di halaman publik; layanan hotel tanpa harga tampil "Rp 0"; tanpa metadata | Fakta salah; aturan warna dilanggar | Jarak menyebut masjid kotanya (Masjidil Haram / Masjid Nabawi); teks `catalog.hotels.detail`; token `brand`; tombol `btn-brand-*`; layanan/kamar tak berharga disembunyikan atau "—"; `generateMetadata`; `requireCatalog` |

### 8.2 Dicatat, BELUM dikerjakan (butuh keputusan pemilik atau di luar lingkup audit)

1. **Area jamaah, checkout, dan keranjang hanya berbahasa Indonesia di `/en`** (judul "Keranjang", semua label). Tidak pernah ada di rencana; menerjemahkannya = proyek tersendiri (puluhan komponen).
2. Daftar fasilitas hotel (`HOTEL_FACILITIES`) dan kit tabel bersama masih Indonesia di `/en` (sudah tercatat F6).
3. Katalog Muthowif tidak punya tombol pesan; pemesanan hanya dari halaman profil ("Pesan layanan muthowif"). Pertimbangkan tombol hero ke checkout layanan.
4. Bagian CTA bawah setiap katalog ("Daftar Akun") tetap tampil untuk pengguna yang sudah masuk.
5. Ringkasan keranjang visa menulis "1+ hari" untuk jenjang 1–30 (masukan keranjang hanya membawa hari awal).
6. Halaman jamaah/login/daftar belum punya judul tab sendiri (semua "Saudinesia").
7. Pesan galat bentuk isian manifest dari server masih teks Zod berbahasa Inggris (hanya muncul bila API dipanggil langsung — formulir tidak menghasilkan bentuk itu).
8. Staf yang membuka `/{locale}/login` diarahkan ke dasbor jamaah ("Buat Booking Pertama").
9. Rekening bank belum diisi di Pengaturan Invoice (peringatan tampil di halaman bayar) — setelan pemilik, bukan kode.
10. Uji `test-site-content` tidak idempoten (gagal pada jalan kedua di DB yang sama karena jejak audit tersisa; lulus di DB segar seperti CI).

## 9. Tahap 4 — Hero "kotak cari" untuk Pesawat dan Hotel (arahan pemilik 2026-11-13)

> **Status: RENCANA DISETUJUI (2026-11-13) — K-H1..K-H4 sesuai usulan. H1 SELESAI 2026-11-13 (§9.5); H2, H3 belum.**

Arahan pemilik: katalog Pesawat dan Hotel boleh punya tampilan hero berbeda (foto besar + kotak cari menempel di bawahnya, gaya situs pemesanan tiket), **asal isi teksnya tetap sama** — judul, subjudul, tombol dari Konten Situs, dua bahasa.

### 9.1 Recheck (2026-11-13)

| Hal | Temuan di kode |
|---|---|
| Hero | Satu komponen `components/shared/public/PageHero.tsx` (ukuran `lg`/`md`, fakta, dua tombol). Isi dari `getPageContent(locale, '<halaman>')`. |
| Foto hero | **Sudah ada** sejak F5 (C5): pemilik media `public_page` (`featured`, `superadminOnly`), diunggah superadmin di Sistem → Konten Situs per halaman; `PageHero` menampilkan foto + lapisan `brand-dark`. Tidak perlu fitur unggah baru — cukup foto untuk halaman `flight` dan `hotels` diunggah. |
| Data pesawat | `FlightRoute` (`origin`/`destination` teks bebas, mis. "Cengkareng (CGK)") + `FlightSchedule` = **periode** keberangkatan (`departureFrom`–`departureTo`) dengan kuota kursi (`totalSeats − pendingSeats − bookedSeats`); maskapai dari vendor biaya (`lib/catalog/flight.ts`). **Tidak ada** jam, nomor penerbangan, transit, atau bagasi. Halaman sekarang: tabel + cari teks rute. |
| Data hotel | `Hotel` (`city`, `stars`, `distanceToHaramM`) → `HotelPricePeriod` (rentang tanggal) → `HotelRoomSchedule` (tipe kamar, kuota). Halaman sekarang: kartu + filter kota/bintang, harga "mulai dari / malam" periode berjalan. |
| Checkout | Satu halaman `/{locale}/checkout/[jenis]?id=` (`hotel`, `flight` termasuk). Hotel menerima check-in/check-out/kamar; pesawat menerima tanggal + orang. |
| Drift dokumen | `docs/arsitektur-tiket-pesawat.md` banner masih "kuota tanpa pemanggil, belum terintegrasi booking" — **basi**: `reserveFlightQuota` dipanggil `lib/booking/create.ts` + `lib/quota/adapters/flight.ts`, checkout `flight` ada. Diperbarui di fase pertama tahap ini. |

### 9.2 Rancangan

- **R1 — Varian, bukan hero baru.** `PageHero` mendapat `variant: 'default' | 'search'` dan slot `search?: ReactNode`. Varian `search`: foto penuh (atau permukaan hijau + pola bila belum ada foto), judul/subjudul di atas foto, kotak cari menempel di tepi bawah hero. Teks tetap kunci yang sama → Konten Situs dan terjemahan tak berubah; penjaga `REDESIGNED_CATALOGS` tetap berlaku.
- **R2 — Kotak cari = formulir GET** ke halaman yang sama (`#catalog`), parameter di URL (bisa di-bookmark), disaring di server dengan daftar putih (nilai asing diabaikan, bukan 500), memakai `FilterSelect`/`AutocompleteSelect` dan kontrol tanggal yang sudah ada (bukan `<select>` polos).
  - Pesawat: `from` (asal, dari rute aktif), `to` (tujuan, dari rute aktif), `month` (YYYY-MM, bulan berjalan s.d. +12), `pax` (1–`CHECKOUT_MAX_PEOPLE`).
  - Hotel: `city` (Makkah/Madinah — `CITIES` yang ada), `checkIn`, `checkOut` (tanggal kalender lewat `lib/time`), `rooms`.
- **R3 — Pita bulan (pesawat).** 6 bulan ke depan dengan harga jual termurah jadwal yang beririsan dengan bulan itu dan masih punya kursi; bulan tanpa kursi abu-abu "habis". Harga hanya lewat `sellPrices` (jual saja).
- **R4 — Kartu hasil** hanya data yang benar-benar ada: rute, maskapai, periode berangkat, sisa kursi (ditampilkan hanya bila ≤ ambang, mis. 10), harga per orang (dan × `pax` bila diisi), tombol Pesan → checkout dengan isian terbawa (`?id=…&date=…&pax=…` lewat `checkoutPath`). Hotel: bintang, jarak ke Haram, tipe kamar, harga "mulai dari / malam"; bila tanggal diisi, hotel yang periodenya tidak menutup seluruh malam disaring keluar.
- **R5 — Kosong yang membantu.** Pencarian tanpa hasil menawarkan bulan/tanggal terdekat yang ada kursinya, bukan halaman kosong.
- **R6 — Yang sengaja TIDAK ditiru:** angka statistik karangan (fakta hero tetap dari data aktif, §6), pita promo/kode diskon (tak ada mesinnya), jam/nomor penerbangan/bagasi (data tak ada — lihat K-H3).

### 9.3 Keputusan yang menunggu pemilik

| # | Pertanyaan | Usulan |
|---|---|---|
| K-H1 | Pesawat dicari per **bulan** atau per **tanggal persis**? | Bulan (jadwal kita berupa periode; tanggal persis dipilih di checkout). |
| K-H2 | Harga hotel di kartu: "mulai dari / malam" atau **total seluruh malam × kamar** bila tanggal diisi? | Total bila tanggal + kamar diisi (dihitung server dari titik harga, sama dengan checkout), selain itu "mulai dari / malam". |
| K-H3 | Tambah data pesawat (jam berangkat, transit, bagasi) di admin? | Belum — tahap terpisah; kartu cukup dengan data yang ada. |
| K-H4 | Varian `search` juga untuk katalog lain (Transport, Paket)? | Tidak sekarang — hanya Pesawat dan Hotel. |

### 9.4 Fase (satu PR per fase, Fase Eksekusi SOP)

| Fase | Isi | Selesai bila |
|---|---|---|
| **H1** | `PageHero` varian `search` + slot; perbarui banner `docs/arsitektur-tiket-pesawat.md`; penjaga katalog tetap hijau. | Halaman lain tak berubah (HTML dibandingkan); varian tampil di HP 375 px tanpa geser horizontal. |
| **H2** | Pesawat: kotak cari + parameter + pita bulan + kartu hasil + kosong yang membantu + tautan checkout berisi. | `/id` dan `/en` utuh; parameter asing diabaikan; harga hanya jual; uji penyaringan di `scripts/`. |
| **H3** | Hotel: kotak cari + saring periode + harga sesuai K-H2 + tautan checkout berisi. | Sama seperti H2. |

### 9.5 As-built H1 (2026-11-13)

- `PageHero` menerima `variant` (`'default' | 'search'`) dan `search?: ReactNode`. Latar (foto Konten Situs + lapisan, atau pola) dan teks (label, judul, subjudul, tombol, fakta) adalah SATU potongan JSX yang dipakai kedua varian — teks tak mungkin berbeda antarvarian. Varian `search`: panel hero dengan ruang bawah lebih lega, lalu kotak `.hero-search` (`app/globals.css`: kartu putih ber-bayangan, `-mt-12` menimpa tepi bawah hero, `z-10` supaya daftar dropdown di dalamnya tak tertutup).
- Katalog Pesawat dan Hotel memakai varian itu. **Sementara (sampai H2/H3)** isi kotak = filter lama yang dipindah dari atas daftar (cari rute; kota + bintang) — supaya varian langsung dipakai dan diuji, tidak ada kode tanpa pemakai.
- **Bukti:** HTML `<main>` 10 halaman publik × 2 bahasa dibandingkan sebelum/sesudah di server uji (DB audit): 16 identik byte demi byte, hanya Pesawat dan Hotel (id/en) yang berubah. HP 375 px tanpa geser horizontal (`scrollWidth` = 375), kotak di dalam layar (28–347 px); dropdown Kota terbuka di atas daftar dan memilih Makkah menyaring ke 3 hotel (`?city=makkah`). Suite penuh lulus di DB sekali pakai; build 0 error.
- **Belum diuji dengan foto hero terunggah** di halaman ini (DB audit tanpa foto) — jalur foto memakai potongan yang sama persis dengan varian bawaan.

