# Arsitektur — Front-end Publik (mulai dari Homepage)

> **Status: RENCANA DISETUJUI PEMILIK (2026-11-06). F1 dan F2 selesai (2026-11-06); F3 belum.**
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
