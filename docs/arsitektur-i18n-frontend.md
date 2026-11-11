# Arsitektur — Bahasa (id/en) di seluruh front-end pelanggan

> **Status: RENCANA DISETUJUI (2026-11-11): K1 = (a) selalu Indonesia, K2 = (a) URL saja, K4 = (a) bertahap di I6, K5 = ditunda (Indonesia dulu); K3 dan K6 mengikuti usulan. I1, I2, dan I3 SELESAI 2026-11-11 (§6); I4–I6 belum.**
> Pemicu: audit front-end 2026-11-11 (`docs/arsitektur-frontend-publik.md` §8.2 butir 1) dan arahan pemilik:
> *"kita seriusi dulu bahasa ya di front-end.. default-nya bahasa Indonesia bro.. kita blm bikin select bahasa di menu.."*

## 1. Recheck kode aktual (SOP langkah 1, 2026-11-11)

| # | Temuan | Lokasi |
|---|---|---|
| R1 | Dua locale `id` (bawaan) dan `en`, SATU sumber `i18n/routing.ts`. `localeCookie: false`, `localeDetection` tidak diatur, jadi **bawaan next-intl aktif**: `/` dialihkan menurut `Accept-Language` browser. Pengunjung berbrowser Inggris mendarat di `/en`, padahal area pelanggan di sana masih Indonesia. Ini **bertentangan dengan "bawaan bahasa Indonesia"**. | `i18n/routing.ts`, `middleware.ts:57` |
| R2 | **Tidak ada pengalih bahasa** di mana pun. Komponen `LocaleSwitcher` lama dihapus karena tak pernah dipasang. `/en` hanya bisa dicapai dengan mengetik URL atau lewat deteksi browser (R1). | `components/shared/Header.tsx`, `PublicMobileNav`, `PublicFooter`, layout jamaah |
| R3 | Halaman publik (beranda + 9 katalog) **sudah** dwibahasa lewat `getPageText` (F1–F7). Header dan footer juga sudah (`nav`, `footer`). | `app/[locale]/(public)/*`, `i18n/messages/*` |
| R4 | Area lain **0% dwibahasa**. Tak satu berkas pun memakai `useTranslations`/`getTranslations`; teks Indonesia ditulis langsung. | lihat tabel §1.1 |
| R5 | Format tanggal di `lib/time` (`formatInstant`, `formatCalendarDate`) **terkunci `id-ID`**: di `/en` bulan tetap "Desember". Ada 39 berkas pemakai. `formatRupiah` juga `id-ID`; itu benar karena mata uangnya rupiah. | `lib/time/index.ts:166-178`, `lib/utils.ts:9` |
| R6 | Pesan galat dari API (Zod dan pesan domain di `lib/`) berbahasa Indonesia dan ditampilkan apa adanya oleh klien. | `lib/validators/*`, `lib/booking/*`, `lib/pilgrims/*`, … |
| R7 | Email, WhatsApp, dan PDF invoice hanya berbahasa Indonesia. Akun tidak menyimpan bahasa pilihan (tak ada kolom `locale` di `User`). | `lib/notifications/*`, `lib/pdf/*` |
| R8 | Namespace pesan lama `auth` (6 kunci), `booking` (15), `visa` (6) **tidak dipakai kode mana pun**. Sisa kerangka awal. | `i18n/messages/*.json` |
| R9 | Data produk (nama, deskripsi, label kolom manifest yang diatur admin) tak punya kolom terjemahan. Ini sudah diputuskan di F2: tetap tampil seperti diisi admin. | — |

### 1.1 Ukuran pekerjaan (berkas `.tsx` dengan teks langsung)

| Area | Berkas | Baris |
|---|---|---|
| Auth (`(auth)`: masuk, daftar, lupa/atur ulang password, aktivasi, lengkapi data) | 14 | ±850 |
| Checkout + keranjang (`(public)/checkout`, `(public)/keranjang`) | 17 | ±1.250 |
| Area jamaah (`(pilgrim)`: dasbor, booking, detail, jamaah per booking, Jamaah Saya, profil) | 18 | ±1.540 |
| Invoice publik (`invoice/[token]`) | 1 | ±120 |
| Komponen bersama yang tampil ke pelanggan (`components/shared`: kit tabel, pemilih alamat/kontak/negara, formulir kartu jamaah, dokumen, `components/booking/ManifestFieldsForm`) | ±38 | ±3.100 |
| Label/teks di `lib/` yang dirender UI (status booking, status pemeriksaan, peringatan kartu, ringkasan checkout, label jenis dokumen) | ±15 | — |

Totalnya sekitar **±85 berkas, ±7.000 baris**. Admin **tidak** termasuk: staf memakai bahasa Indonesia.

## 2. Keputusan yang dibutuhkan dari pemilik

| # | Pertanyaan | Usulan |
|---|---|---|
| K1 | Bahasa bawaan dan deteksi | **(a) Selalu Indonesia**: `localeDetection: false`, sehingga `/` → `/id` untuk semua pengunjung. Bahasa Inggris hanya bila dipilih lewat pengalih. Alternatif (b): tetap ikut bahasa browser. |
| K2 | Mengingat pilihan bahasa | **(a) URL saja** (`/en/...`): semua tautan internal sudah membawa locale, jadi pilihan bertahan selama menjelajah. Membuka `/` lagi kembali ke Indonesia. Alternatif (b): cookie `NEXT_LOCALE` (`/` membuka bahasa terakhir); (c) disimpan di akun (lihat K5). |
| K3 | Letak pengalih | Header (desktop) + menu HP + area jamaah + halaman masuk/daftar. Bentuknya tombol kecil "ID / EN" (`Languages` Lucide + kode), **tanpa** bendera (bendera ≠ bahasa, dan aturan proyek melarang emoji bendera). Berpindah bahasa membuka halaman yang SAMA (path + query) di locale lain. |
| K4 | Pesan galat dari server (R6) | **(a) Bertahap**: fase I1–I5 menerjemahkan semua teks UI. Pesan galat server tetap Indonesia sampai fase I6, yang memberi kode galat untuk jalur pelanggan (checkout, booking, jamaah, auth) dan menerjemahkannya di klien. Alternatif (b): langsung dikerjakan bersama tiap area (fase lebih besar). |
| K5 | Email, WhatsApp, PDF invoice (R7) | **Ditunda**: tetap Indonesia. Bila nanti perlu, tambahkan `User.locale` (diisi saat daftar/ganti bahasa) lalu template per bahasa. Itu proyek terpisah sesudah I6. |
| K6 | Format tanggal di `/en` (R5) | **Ikut bahasa halaman**: "15 December 2026" di `/en`, "15 Desember 2026" di `/id`. Zona waktu tetap zona aplikasi (WIB). Rupiah tetap "Rp 7.900.000" di kedua bahasa. |

## 3. Rancangan

1. **Satu pengalih**: `components/shared/LocaleSwitcher.tsx` (klien, `usePathname` + `useSearchParams` dari `next/navigation`). Penggantian segmen pertama lewat satu fungsi murni `switchLocalePath(path, query, to)` di `lib/i18n/switch.ts`: hanya locale dari `routing.locales`, path relatif, tak pernah alamat luar. Dipasang di Header, `PublicMobileNav`, layout jamaah, dan layout auth.
2. **Format sesuai bahasa**: `formatInstant`/`formatCalendarDate` menerima `locale?: AppLocale` (bawaan `id`, jadi pemanggil lama tak berubah). `id` → `id-ID`, `en` → `en-GB` (urutan tanggal-bulan-tahun, sama dengan kebiasaan pelanggan). Uji di 4 `TZ` seperti sekarang. Pemanggil di area pelanggan meneruskan locale.
3. **Teks pesan**: namespace baru per area di `i18n/messages/{id,en}.json`, yaitu `authPages`, `checkout`, `cart`, `pilgrim` (+ sub: `dashboard`, `bookings`, `booking`, `pilgrims`, `profile`), `invoicePublic`, `shared` (kit tabel, pemilih, dokumen, kartu jamaah). Server Component memakai `getTranslations({ locale, namespace })`. Client Component memakai `useTranslations` di bawah `NextIntlClientProvider` yang sudah ada di layout. Teks Indonesia yang sekarang dipindah **apa adanya** ke `id.json` (tak ada perubahan kalimat di `/id`). Namespace lama `auth`/`booking`/`visa` (R8) dihapus.
4. **Label di `lib/`** (status booking, status pemeriksaan, `WARNING_TEXT`, ringkasan checkout `entrySummary`, …): `lib/` hanya mengembalikan **kunci**, dan teks dirender di komponen lewat pesan. Satu daftar kunci per label supaya penjaga bisa memastikan setiap kunci punya terjemahan id+en.
5. **Halaman di luar Konten Situs**: teks auth/checkout/jamaah **tidak** bisa diedit di Konten Situs (bukan halaman katalog). Kalau nanti ingin diedit, cukup tambahkan entri `PUBLIC_PAGES`.
6. **Penjaga `scripts/test-i18n-coverage.ts`** (penemu sumber, pola sama dengan `test-time-guard`):
   - setiap kunci di `id.json` ada di `en.json` dan sebaliknya, dengan argumen ICU yang sama;
   - setiap kunci yang dipakai kode (`t('…')` per namespace) ada;
   - berkas di area yang SUDAH dimigrasi (daftar `MIGRATED_AREAS`, bertambah per fase) tak memuat teks JSX langsung (`>Teks<`, `placeholder="…"`, `aria-label="…"`, `title="…"`), kecuali daftar pengecualian beralasan;
   - pengalih hanya membangun path lewat `switchLocalePath`.
7. **Routing (K1–K2)**: `localeDetection: false` (dan `localeCookie` sesuai K2) di `i18n/routing.ts`. Uji `scripts/test-i18n-routing.ts` ditambah: `Accept-Language: en` di `/` → `/id`.

## 4. Fase (satu PR per fase)

| Fase | Isi | Selesai bila |
|---|---|---|
| **I1** | K1/K2 routing, pengalih (§3.1) di header/menu HP/footer, format tanggal sesuai bahasa (§3.2), penjaga kerangka (§3.6, kunci id↔en), namespace lama dihapus | Pengalih berpindah id↔en di halaman publik tanpa kehilangan path/query; browser Inggris membuka `/id`; tanggal katalog di `/en` berbahasa Inggris |
| **I2** | Auth: masuk, daftar, lupa/atur ulang password, aktivasi, lengkapi data, Google; pengalih di layout auth | Alur daftar → aktivasi → masuk utuh di `/en` (browser) |
| **I3** | Checkout (9 jenis) + keranjang + ringkasan + label `lib/checkout` | Pesan tiap jenis di `/en` sampai terbit (browser), pratinjau = total terbit |
| **I4** | Area jamaah: dasbor, daftar & detail booking, bayar/unggah bukti, jamaah per booking (termasuk "Data tambahan"), Jamaah Saya + formulir kartu + dokumen, profil; pengalih di layout jamaah | Simulasi audit §8 diulang penuh di `/en` |
| **I5** | Komponen bersama sisanya (kit tabel, `AddressPicker`, `DateTimeField`; `AutocompleteSelect`/`ContactPicker`/`CountryCodeSelect` sudah di I2) + invoice publik + fasilitas hotel (`HOTEL_FACILITIES`) + label visa plus | Penjaga §3.6 tanpa pengecualian di area pelanggan |
| **I6** | Pesan galat server jalur pelanggan → kode + terjemahan klien (K4a) | Galat checkout/jamaah/auth tampil berbahasa Inggris di `/en` |

I1 kecil (±10 berkas) dan langsung memperbaiki "bawaan Indonesia" + pengalih. I2–I5 masing-masing ±15–40 berkas. Setiap fase: build 0 galat, security review, `bun audit`, simulasi browser di `/id` **dan** `/en`, 375 px.

## 5. Di luar rencana ini

Admin (tetap Indonesia), terjemahan data produk (R9), email/WA/PDF per bahasa (K5), bahasa ketiga (mis. Arab). Bahasa tambahan cukup = locale baru di `routing.ts` + berkas pesan; penjaga §3.6 memastikan tak ada kunci yang terlewat.

## 6. As-built

### 6.1 I1 (2026-11-11)

| Bagian | Isi | Lokasi |
|---|---|---|
| Routing | `localeDetection: false`, `localeCookie: false`: `/` → `/id` untuk semua `Accept-Language`, `/en/...` tetap dihormati, tak ada cookie `NEXT_LOCALE`. | `i18n/routing.ts`, `scripts/test-i18n-routing.ts` |
| Pengalih | `LocaleSwitcher` (klien): "ID / EN" + ikon `Languages`, `aria-current`, `hrefLang`/`lang`, nama bahasa dalam bahasanya sendiri sebagai label (`LOCALE_LABEL`), label navigasi `nav.language`. `tone="onDark"` untuk footer. `useSearchParams` di dalam `Suspense` (cadangan = tautan tanpa query). | `components/shared/LocaleSwitcher.tsx` |
| Alamat | `switchLocalePath(path, query, to)` murni. Membuang awalan locale lama, merapatkan `//` dan `\`, membuang `?`/`#` yang terselip di path. Hasil selalu `/{to}`, `/{to}/…` atau `/{to}?…`. | `lib/i18n/switch.ts` |
| Pemasangan | Header (≥ sm; di HP disembunyikan), panel menu HP (bawah), footer (selalu, juga saat menu katalog kosong). | `Header.tsx`, `PublicMobileNav.tsx`, `PublicFooter.tsx` |
| Tanggal | `formatInstant(v, opsi, tz, locale)` dan `formatCalendarDate(v, opsi, locale)`. `dateLocaleTag`: `en` → `en-GB`, selain itu `id-ID`. Pemanggil lama tak berubah (bawaan `id`). Diteruskan di katalog Pesawat, Haji, dan detail Hotel. Pemanggil di area auth/checkout/jamaah menyusul di fasenya. | `lib/time/index.ts`, `scripts/test-time.ts` (4 `TZ`) |
| Pesan | `nav.language` ditambahkan. Namespace `auth`/`booking`/`visa` (tak dipakai) dihapus. | `i18n/messages/{id,en}.json` |
| Penjaga | `scripts/test-i18n-coverage.ts` (terdaftar di `bun run test`). Isinya: kunci + argumen ICU sama di semua locale; namespace/kunci literal yang dipakai kode ada; area `MIGRATED_AREAS` tanpa teks JSX langsung (pengecualian beralasan di `ALLOWED_TEXT`); pengalih memakai `<a href={switchLocalePath(…)}>`; masukan jahat tak menghasilkan alamat luar; properti K1/K2. | — |

**Bukti:**
- `bun run build` 0 galat.
- Browser `/id/flight?page=1`, klik EN: alamat menjadi `/en/flight?page=1`, `<html lang="en">`, periode tampil "1 Jul 2026 – 31 Dec 2026", `document.cookie` kosong.
- 375 px: pengalih header tersembunyi, pengalih di panel menu dan footer tampil, tanpa scroll horizontal, tanpa galat konsol.
- `curl` dengan `Accept-Language: en` ke `/` menghasilkan 307 ke `/id`.
- Mutasi penjaga semua merah: kunci en hilang, argumen ICU beda, teks/`title` langsung di Header, `t('tidakAda')`, dan pengalih dilepas dari footer.

**Untuk fase berikutnya:**
- Tiap fase menambah path-nya ke `MIGRATED_AREAS`.
- Tiap fase meneruskan `locale` ke formatter tanggal di area yang dimigrasi.
- Layout auth (I2) dan jamaah (I4) memasang `LocaleSwitcher` yang sama.

### 6.2 I2 (2026-11-11)

| Bagian | Isi | Lokasi |
|---|---|---|
| Halaman | 7 halaman auth (masuk, daftar, aktivasi, Google, lupa password, atur ulang, lengkapi data) memakai namespace `authPages.<halaman>` + `authPages.common`. Teks Indonesia dipindah apa adanya. Satu-satunya perubahan kalimat di `/id`: persetujuan privasi kini seragam "… <Kebijakan Privasi> Saudinesia." di tiga halaman. | `app/[locale]/(auth)/**`, `i18n/messages/*.json` |
| Judul tab | `generateMetadata` lewat `authMetadata(params, halaman, extra)`. Halaman bertoken tetap `referrer: 'no-referrer'` (dicek runtime dan dijaga penjaga). | `app/[locale]/(auth)/metadata.ts` |
| Galat Google | Kode `?error=` dipetakan ke KUNCI pesan lewat daftar putih `GOOGLE_ERRORS` (kode lain diabaikan). Teks diterjemahkan di server. | `login/page.tsx` |
| Petunjuk password | Satu komponen `PasswordHints` + `passwordMeetsHints` (sebelumnya disalin di dua formulir), ikon Lucide `Check`/`Circle` (bukan glyph), warna `text-brand`. | `app/[locale]/(auth)/PasswordHints.tsx` |
| Pengalih | Layout `(auth)` memasang `LocaleSwitcher` di pojok kanan atas. | `app/[locale]/(auth)/layout.tsx` |
| Jalur kembali | `switchLocalePath` mengganti awalan locale pada `next` (mis. `next=/en/checkout/…` → `/id/checkout/…`). Nilai lain tak disentuh; server tetap menyaring lewat `safeNextPath`. | `lib/i18n/switch.ts` |
| Komponen bersama (dimajukan dari I5) | `ContactPicker`, `CountryCodeSelect`, teks bawaan `AutocompleteSelect` (placeholder, cari, hapus, memuat, kosong), `OrDivider`. Semuanya tampil di alur daftar. Namespace `shared.*`. Admin tetap Indonesia karena dibuka di `/id`; pemanggil admin yang memberi teks sendiri tak berubah. | `components/shared/*` |
| Penjaga | `MIGRATED_AREAS` + `(auth)` dan 5 komponen bersama. Pemindai teks langsung kini memakai **parser TypeScript** (`JsxText` + atribut `placeholder`/`aria-label`/`title`/`alt`/`label`). Regex I1 melewatkan teks sebelum `{…}` (terbukti lewat mutasi). Tambahan: tag rich text (`<strong>`, `<link>`) sama di semua locale; kunci lewat peta (galat Google, petunjuk password) ada; halaman bertoken tetap no-referrer. | `scripts/test-i18n-coverage.ts` |

**Bukti:**
- `bun run build` dan `tsc` tanpa galat.
- Uji `auth`, `google`, `session`, `routes`, `combobox`, `checkout`, `customers-create`, `pilgrim-form` lulus.
- Simulasi di server uji terpisah (DB klon, port 6270), semuanya di `/en`:
  - daftar → layar "Check Your Email" → tautan aktivasi dari log dev → "Create a Password" (petunjuk berbahasa Inggris) → aktif dan dialihkan ke `/en/dashboard`;
  - keluar → `/en/login?error=google_staff` menampilkan galat Google berbahasa Inggris → masuk berhasil;
  - `/en/reset-password` tanpa token menampilkan "Invalid link".
- `/id/register` sama persis seperti sebelumnya.
- 375 px tanpa scroll horizontal; konsol tanpa galat atau pesan hilang.

**Diketahui (sesuai rencana):**
- Galat dari server (mis. "Email atau password salah.") tetap Indonesia sampai I6 (K4).
- Email aktivasi/reset tetap Indonesia (K5).
- `/en/dashboard` sesudah masuk masih Indonesia (I4).

### 6.3 I3 (2026-11-11)

| Bagian | Isi | Lokasi |
|---|---|---|
| Halaman checkout | 9 jenis (Paket, Visa, Transport, Haji, Hotel, Ziarah, Muthowif, Katering, Tiket) memakai namespace `checkout.*`: `page` (judul tab, tombol kembali per jenis, catatan staf `<link>`), `kinds`, `components`, `common`, `intro`, `form`, `summary`, `stepper`, `days`, satu kelompok per jenis (`package`, `visa`, …), dan `missing` per jenis untuk petunjuk isian yang kurang. Judul tab lewat `generateMetadata` (tetap `noindex`). Tanggal diformat dengan `useLocale()`. | `app/[locale]/(public)/checkout/[kind]/**` |
| Data tanpa teks | `lib/checkout/options.ts` tidak lagi mengembalikan kalimat Indonesia. `blocked` = `BlockedReason` (kunci `checkout.blocked.*`). `included` paket = `IncludedItem[]` (`key` + `nights`). Opsi pilihan membawa `nights`/`days` (label = data produk saja). `includedHotels` = `{label, nights}`. `includedFlight.label` boleh `null` (halaman memakai teks umum). `bundledWith` visa = jenis komponen (`RequiredComponentType[]`), bukan label. Nama "Layanan Muthowif" tinggal cadangan; halaman dan keranjang menimpanya dengan `checkout.common.muthowifService`. | `lib/checkout/options.ts` |
| Keranjang | `addRefusal` mengembalikan kunci `CartRefusal` (`checkout.cartRefusal.*`, argumen `max`). Entri keranjang tak lagi menulis `summary` teks. Ringkasan dibangun halaman dari `input` lewat `entrySummary(input, locale)` (kunci `checkout.entry.*` + nilai, jamak ICU di `en`). Kolom `summary` tetap opsional di skema, jadi keranjang lama di perangkat tetap terbaca. Halaman keranjang memakai `cart.*`. Ikon keranjang di header memakai `nav.cart`/`nav.cartCount`. | `lib/checkout/cartStore.ts`, `checkout/[kind]/fields.ts`, `keranjang/**`, `components/shared/CartButton.tsx` |
| Hotel | Pesan "tanggal di luar periode" dirangkai di `HotelFields` (`checkout.hotel.missing.noPeriod` dengan `{list}`). `noPeriodMessage` di `lib/booking/hotelPick.ts` tetap dipakai admin (`ItemRows`, bahasa admin). | `HotelFields.tsx` |
| Penjaga | `MIGRATED_AREAS` + `checkout`, `keranjang`, `CartButton`. Kunci yang dirangkai dari nilai (`kinds`, `page.back`, `components`, `blocked`, `includedItem`, `cartRefusal`, `entry`, `days`, slot paket, musim katering, menu/board) diperiksa terhadap SUMBER nilainya (union tipe/konstanta dibaca dari berkas), jadi nilai baru tanpa pesan = merah. Literal string di `lib/checkout/{options,cartStore}.ts` dipindai parser TypeScript; kata antarmuka Indonesia = merah (satu pengecualian beralasan). | `scripts/test-i18n-coverage.ts` |

**Bukti:**
- `bun run build` dan `tsc` tanpa galat. Penjaga `time-guard` sempat merah (tipe `Intl.DateTimeFormatOptions` di `PackageFields`), diperbaiki.
- Uji `checkout`, `table-consistency`, `combobox`, `time-guard`, `public-home`, `catalog-availability`, `i18n-routing`, `i18n-coverage`, `tx-no-global`, `routes` lulus.
- Mutasi penjaga semua merah: kunci `blocked` en hilang; alasan blokir baru tanpa pesan; kalimat Indonesia kembali ke `options.ts` (mutasi ini awalnya LOLOS dari daftar kata sempit → diganti pemindai literal); teks JSX langsung di keranjang.
- Format ICU dicek di kedua bahasa (jamak "1 day"/"2 rooms", kalimat kamar kurang dengan `{room}` di dalam cabang jamak).
- Simulasi di server uji terpisah (DB klon, port 6270), akun uji, `/en`:
  - kesembilan halaman checkout tampil berbahasa Inggris (sisa Indonesia = data produk: nama, deskripsi, rute);
  - visa: pilih lama tinggal + tanggal → ringkasan pratinjau → "Added to cart"; visa kedua ditolak dengan "The cart already contains a visa …";
  - Ziarah dan Muthowif ditambahkan; ikon header "Cart, 3 products";
  - `/en/keranjang` menampilkan ringkasan entri berbahasa Inggris ("Planned departure 20 Dec 2026 · 1+ days · 1 person"); `/id/keranjang` dari isi perangkat yang sama tetap Indonesia ("20 Des 2026");
  - "Order & issue invoice" → booking terbit (`SND-2026-00015`, total sama dengan pratinjau Rp 6.550.000) → dialihkan ke `/en/bookings/…?baru=1`.

**Diketahui (sesuai rencana):**
- Baris ringkasan pesanan (label/deskripsi item, mis. "1–30 hari", "5 hari · 1 orang") berasal dari snapshot server — tetap Indonesia sampai I6 (K4/K5, sama dengan invoice).
- Pesan galat pratinjau/pemesanan dari server (aturan visa, kuota) tetap Indonesia sampai I6.
- Halaman detail booking sesudah memesan masih Indonesia (I4).
