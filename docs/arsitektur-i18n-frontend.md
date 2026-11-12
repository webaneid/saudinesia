# Arsitektur — Bahasa (id/en) di seluruh front-end pelanggan

> **Status: RENCANA DISETUJUI (2026-11-11): K1 = (a) selalu Indonesia, K2 = (a) URL saja, K4 = (a) bertahap di I6, K5 = ditunda (Indonesia dulu); K3 dan K6 mengikuti usulan. I1, I2, I3, dan I4 SELESAI 2026-11-11, I5 SELESAI 2026-11-12 (§6); I6a SELESAI 2026-11-13 (§6.7); I6b belum.**
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
| **I5** | Komponen bersama sisanya (`DateTimeField`; `AutocompleteSelect`/`ContactPicker`/`CountryCodeSelect` sudah di I2; kit tabel, `Modal`, `AddressPicker` dimajukan ke I4) + invoice publik + fasilitas hotel (`HOTEL_FACILITIES`) + label visa plus | Penjaga §3.6 tanpa pengecualian di area pelanggan |
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

### 6.4 I4 (2026-11-11) — rencana rinci lalu as-built

Recheck kode area jamaah (SOP langkah 1) menemukan hal yang belum tertulis di §4:

- Layout jamaah **tidak** punya header publik (Header hanya di `(public)/layout.tsx`), jadi pengalih harus dipasang di nav jamaah sendiri.
- Halaman jamaah memakai kit tabel (`DataTable`, `FilterBar`, `FilterSelect`, `SearchForm`, `Pagination`, `RowActions`), `Modal`, dan `AddressPicker` yang masih Indonesia. Tanpa itu, kriteria "simulasi §8 penuh di `/en`" tidak tercapai. Ketiganya **dimajukan dari I5 ke I4** (pola sama dengan I2). I5 tinggal `DateTimeField`, invoice publik, fasilitas hotel, label visa plus.
- Teks yang dibangun di `lib/` dan tampil ke jamaah: status booking (`BOOKING_STATUS`), status pemeriksaan (`REVIEW_LABEL`), peringatan NIK (`WARNING_TEXT`), status/alasan tolak dokumen (`STATUS_TEXT`/`REJECT_TEXT`), jenjang visa "1–30 hari" (`visaTierTexts`), nama rombongan bawaan "Rombongan A"/"Semua jamaah" (`groupView`), tanggal di ringkasan data jamaah (`fieldRows`), musim (`booking.season` mentah).

| Bagian | Rencana |
|---|---|
| Pesan | `pilgrimArea.*` (`nav`, `dashboard`, `bookings`, `booking`, `summary`, `payment`, `pilgrim`, `trip`, `extra`, `jamaah`, `editor`, `profile`, `deletion`) dan `shared.*` (`bookingStatus`, `review`, `pilgrims`, `documents`, `table`, `modal`, `address`, `whatsapp`). |
| Label `lib/` | Komponen area jamaah dan komponen bersama menerjemahkan **kunci** (`shared.bookingStatus.<status>`, `shared.review.<status>`, `shared.pilgrims.warning.<kode>`, `shared.documents.status/reject.<kode>`). Peta di `lib/` tetap untuk halaman khusus admin (bahasa admin). Penjaga memastikan teks `id.json` = teks peta `lib/` (satu kalimat, tak bercabang) dan setiap kunci peta punya pesan. |
| Jenjang visa | `visaTierRangeOfKey` (murni, `{min,max}`) + pembaca `visaTierRanges` di `snapshot.ts`; halaman merangkai teks lewat pesan jamak. `visaTierTexts` tetap untuk admin. |
| Rombongan & tanggal | `groupView(groups, names?)` menerima teks bawaan yang sudah diterjemahkan; `fieldRows(fields, values, locale?)` memformat tanggal sesuai bahasa. Pemanggil lama tak berubah. |
| Ringkasan pesanan | Detail item (orang, penumpang, malam, kamar, hari) dan satuan rumus dari pesan jamak; musim lewat `pilgrimArea.booking.season.<s>`. |
| Pengalih | `LocaleSwitcher` di nav layout jamaah. |
| Tetap Indonesia (sesuai K4/K5/R9) | Pesan galat dan pesan sukses yang datang dari server (I6); data yang diisi admin (nama produk, label jenis dokumen, label kolom data jamaah, nama rombongan yang diberi admin); invoice PDF dan email. |
| Penjaga | `MIGRATED_AREAS` + `app/[locale]/(pilgrim)`, `components/shared/{pilgrims,documents,data-table}`, `Modal`, `AddressPicker`, `WhatsappVerifyCard`, `components/booking/ManifestFieldsForm.tsx`. |

**As-built (berbeda/tambahan dari rencana di atas):**

| Bagian | Isi | Lokasi |
|---|---|---|
| Halaman | Dasbor, daftar & detail booking, jamaah per booking, Jamaah Saya (daftar, baru, ubah), profil memakai `getTranslations({ locale, namespace })` (halaman async) atau `useTranslations` (komponen klien dan komponen kit non-async). Setiap halaman punya `generateMetadata` (penerjemah metadata dinamai `tm` supaya penjaga tidak bingung dua `t` beda namespace). Halaman ubah kartu jamaah sebelumnya tanpa judul tab; kini "Ubah Jamaah"/"Edit Pilgrim" — **generik, tanpa nama jamaah** (data pribadi tak masuk judul tab/riwayat browser). | `app/[locale]/(pilgrim)/**` |
| Layout | Pengalih + tombol keluar diletakkan DI LUAR `<nav>` menu (menu `display: contents` di dalam satu baris `flex-wrap`) — `LocaleSwitcher` adalah landmark `nav` sendiri, jadi tidak bersarang. | `app/[locale]/(pilgrim)/layout.tsx` |
| Ringkasan pesanan | `OrderSummaryCard` menerima satuan rumus sebagai kunci (`SummaryUnit = 'order' \| 'pilgrim'`), rumus hanya bila jumlah > 1. Musim lewat daftar `SEASONS` + `isSeason` (nilai asing → tanpa label, bukan kunci mentah). | `bookings/[id]/OrderSummaryCard.tsx`, `bookings/[id]/page.tsx` |
| Kit bersama | `RowActions` (`ActionLink`/`KindButton` memakai `shared.table.action.<kind>`; `ACTION_LABELS` tetap diekspor untuk `ApiAction` admin), `DataTable` (`empty` bawaan), `Pagination` (`showing` dengan `<b>`), `FilterBar`/`SearchForm` (placeholder opsional)/`FilterSelect`, `Modal`, `AddressPicker` (termasuk kolom peta), `SavedPilgrimFields`, `PilgrimCardDialog` (`saveLabel` opsional), `PilgrimSlotsTable`, `DocumentRepeater`, `DocumentChecklist`, `FileViewerDialog`, `WhatsappVerifyCard` (`t.rich`). Admin yang memakai kit ini memperoleh teks Indonesia yang sama (pesan `id`). `documentRows.ts`: `STATUS_TEXT`/`REJECT_TEXT` mati dihapus. | `components/shared/**` |
| `lib/` | `visaTierRangeOfKey` + `visaTierRanges` (teks tetap lewat `visaTierTexts` untuk admin); `groupView(groups, names?)` + `groupMark`; `formatFieldValue`/`fieldRows(…, locale?)`; `bookingPilgrimSlots(…, locale?)`. Pemanggil admin tidak berubah. | `lib/booking/{visaDuration,groups}.ts`, `lib/pricing/engine/snapshot.ts`, `lib/manifest/display.ts`, `lib/pilgrims/slots.ts` |
| Penjaga | Uji baru "area jamaah (I4)": setiap kunci yang dirangkai dari nilai (`bookingStatus` atas enum Prisma + `DisplayStatus`, `review`, `trip.hint`, `documents.status/reject`, `warning`, `table.action`, musim, satuan rumus, `slots.docState`) diperiksa terhadap SUMBER nilainya. Uji "teks Indonesia di pesan = teks peta `lib`" (status booking, review, peringatan, label aksi) — admin dan jamaah tak bisa berbeda kata. `ALLOWED_TEXT` beralasan: contoh format di `ManifestFieldsForm`, URL peta di `AddressPicker`, kata kunci `VERIF` (harus sama di semua bahasa — dicocokkan webhook). `test-table-kit` merender di dalam `NextIntlClientProvider` (`timeZone` + `children` sebagai prop). | `scripts/test-i18n-coverage.ts`, `scripts/test-table-kit.ts` |

**Bukti:**
- `tsc` dan `bun run build` tanpa galat.
- Uji `i18n-coverage` (14), `table-kit`, `table-consistency`, `combobox`, `time-guard`, `routes`, `i18n-routing`, `public-home`, `checkout`, `pilgrim-documents`, `session` lulus. `site-content` gagal hanya di DB audit bekas pakai (sisa jejak audit dari uji sebelumnya; `lib/public-content` tidak berubah di I4).
- Mutasi penjaga semua merah: kunci en dihapus; nilai `DisplayStatus` baru tanpa pesan; teks `id.json` berbeda dari peta `lib`; teks JSX langsung.
- Simulasi §8 di server uji terpisah (DB klon, port 6270), akun uji, `/en`:
  - dasbor ("Needs action", "Pay Rp 6.550.000", "Complete data for 1 pilgrim"), daftar booking (filter, kolom, "Showing 1–1 of 1"), detail booking (tenggat "Sunday, 15 November 2026 at 23:59", musim "Regular", "1–30 days", total, tabel jamaah);
  - unggah bukti transfer → "Awaiting Verification" + "Transfer receipt uploaded, awaiting confirmation.";
  - jamaah per booking: dialog "Add a new pilgrim" lengkap (identitas, paspor, kontak, alamat berjenjang) → simpan & tautkan; "Additional data" → "Additional data saved."; unggah dokumen paspor → "Document saved.", "Valid until 1 Jan 2031", penampil berkas; daftar periksa "1 of 3 uploaded";
  - Jamaah Saya (daftar "12 May 1990", "NIK saved"), formulir kartu, profil, hapus akun, verifikasi WhatsApp;
  - 375 px: tanpa geser samping, tabel jadi kartu; pengalih "Bahasa Indonesia" membuka `/id/…` di path yang sama dan seluruh halaman kembali Indonesia (regresi `/id` bersih).

**Diketahui (sesuai rencana):** pesan dari server (mis. "Data incomplete: …" berisi label kolom admin) dan data isian admin (nama produk, label dokumen/kolom, "Diminta oleh <produk>") tetap Indonesia; tanggal di baris ringkasan item ("20/12/2026 – 24/12/2026") berasal dari snapshot server — I6.

**Insiden uji (bukan bug produk):** menjalankan skrip uji DB di DB audit menulis nilai cek kunci PII dengan kunci uji, sehingga server audit (kunci `.env.local`) menolak menyimpan jamaah — `ensurePiiKeysMatch` gagal-tertutup sesuai SEC-168. Dibereskan dengan mengosongkan `pii_key_checks` di DB sekali pakai itu saja. Pelajaran: DB untuk simulasi browser dan DB untuk skrip uji jangan sama.

### 6.5 I5 (2026-11-12) — rencana rinci lalu as-built

Recheck (SOP langkah 1) dengan memperluas sementara `MIGRATED_AREAS` ke seluruh area pelanggan (`app/[locale]/(public)`, `app/[locale]/invoice`, `components/shared`, `components/booking`) — teks JSX langsung yang tersisa hanya di 4 berkas: invoice publik (22), kebijakan privasi (13), `rich-text/RichTextEditorImpl` (12), `RequiredDocuments` (2). Di luar JSX: label fasilitas hotel (`HOTEL_FACILITIES` di halaman detail hotel publik) dan nama komponen "visa plus" di kartu katalog Visa (`visaSalesModel().parts` = label Indonesia `REQUIRED_COMPONENT_LABEL`). Temuan yang mengubah §4:

- `DateTimeField` dan editor teks kaya **hanya dipakai admin** (tak ada pengimpor di luar `admin/`) — bukan area pelanggan, tetap Indonesia (admin). Dikeluarkan dari cakupan dengan daftar beralasan yang DIPERIKSA penjaga (berkas itu tak boleh punya pengimpor di luar admin).
- Kebijakan privasi masih teks keras dan belum ada di §4 — masuk I5.

| Bagian | Rencana |
|---|---|
| Invoice publik | Teks halaman → `invoicePage.*`; status dari `displayStatus` (kunci `shared.bookingStatus`, sama dengan area jamaah) — `InvoiceData` mendapat `displayStatus` dan tanggal kalender mentah (`invoiceDay`/`dueDay`) di samping teks yang dipakai PDF; tanggal diformat sesuai bahasa halaman; judul tab lewat `generateMetadata` (tetap noindex/no-referrer); pengalih bahasa di halaman (token ikut di alamat sama, header no-referrer tetap). Isi baris (label/deskripsi item, nama bagian), kop, rekening, S&K = data beku → tetap apa adanya (K5, sama dengan PDF). |
| Kebijakan privasi | Seluruh teks → `privacy.*` (id = teks sekarang, en = terjemahan), kategori data dari pesan (`PERSONAL_DATA_CATEGORIES` dihapus — satu-satunya pemakai halaman ini); `generateMetadata`. Versi kebijakan (`PRIVACY_POLICY_VERSION`) TIDAK naik — isi kebijakan tak berubah, hanya ditambah terjemahan. Status DRAFT/peninjauan hukum berlaku untuk kedua bahasa. |
| Persyaratan dokumen | `RequiredDocuments` → `shared.requiredDocs.*`. Label/deskripsi syarat = data admin (tetap). |
| Fasilitas hotel | Halaman detail hotel menerjemahkan kode lewat `hotels.facilities.<kode>` (as-built: `shared.hotelFacilities.<kode>`); penjaga: setiap kode `HOTEL_FACILITIES` punya pesan dan teks `id` = label `lib` (admin tetap memakai label `lib`). |
| Visa plus | `visaSalesModel` ikut mengembalikan `types` (jenis komponen); kartu katalog menerjemahkan lewat `checkout.components.<jenis>` (sudah ada sejak I3). |
| Penjaga | `MIGRATED_AREAS` menjadi seluruh area pelanggan (`app/[locale]/(public)`, `app/[locale]/invoice`, `components/shared`, `components/booking`, `app/not-found.tsx`); pengecualian hanya `ADMIN_ONLY_SHARED` beralasan, dan penjaga membuktikan berkas itu tak diimpor dari luar admin. |

**As-built (berbeda/tambahan dari rencana di atas):**

| Bagian | Isi | Lokasi |
|---|---|---|
| Invoice publik | `InvoiceData` mendapat `displayStatus`, `invoiceDay`, `dueDay` (tanggal kalender mentah) di samping teks PDF; halaman memakai `invoicePage.*` + `shared.bookingStatus.<status>` — kata status mengikuti area jamaah ("Menunggu Verifikasi"), bukan teks PDF lama. Bank lewat `t.rich('transferTo', …)`. Pengalih bahasa di atas halaman. | `lib/pdf/invoiceData.ts`, `app/[locale]/invoice/[token]/page.tsx` |
| Matcher middleware | **Temuan simulasi:** token invoice berisi titik, sehingga entri matcher pertama (pengecualian berkas aset `.*\\..*`) melepasnya — tanpa middleware, `getLocale()`/`useLocale()` jatuh ke `id`: `<html lang>` dan pengalih bahasa salah di `/en/invoice/…` meski teks halaman sudah Inggris. Ditambah entri kedua `'/([^/_][^/]*)/invoice/([^/]+)'` (segmen pertama tak boleh `_`, jadi `/_next` tetap dilepas). Middleware kini MELIPUTI lebih banyak path (gerbang hanya bertambah). | `middleware.ts`, `scripts/test-i18n-routing.ts` |
| Fasilitas hotel | Namespace `shared.hotelFacilities` (bukan `hotels.facilities`); kode tak dikenal disaring (sebelumnya kode mentah tampil). | `app/[locale]/(public)/hotels/[id]/page.tsx` |
| Visa plus | `visaSalesModel` mengembalikan `types` berurutan sama dengan `parts`; katalog Visa memanggil `getTranslations` untuk `checkout.components`. Penjaga katalog (`test-public-home`) yang sebelumnya melarang `getTranslations` di halaman katalog kini hanya mengizinkan namespace kosakata bersama `SHARED_VOCAB_NAMESPACES` (`checkout.components`) — teks halaman katalog tetap hanya lewat `getPageText`/`getPageContent`. | `lib/validators/visa.ts`, `app/[locale]/(public)/visa/page.tsx`, `scripts/test-public-home.ts` |
| Penjaga | `MIGRATED_AREAS` = seluruh area pelanggan; `ADMIN_ONLY_SHARED` = `DateTimeField`, `RichTextEditor`, `RichTextEditorImpl` — uji membuktikan tak ada pengimpor non-admin (transitif lewat `components/shared` dan `lib`) dan daftar tak basi. Uji kunci dirangkai: `privacy.categories` (dari daftar `CATEGORIES` halaman) dan `shared.hotelFacilities` (dari `HOTEL_FACILITIES`, teks `id` = label `lib`). | `scripts/test-i18n-coverage.ts` |

**Bukti:**
- `tsc` dan `bun run build` tanpa galat (build diulang sesudah perubahan matcher); `bun run test` penuh di DB sekali pakai lulus; `bun audit` tidak berubah (tanpa dependensi baru).
- Mutasi penjaga merah lalu hijau setelah dipulihkan: kunci kategori privasi en dihapus; kode fasilitas baru tanpa pesan; teks `id` fasilitas berbeda dari label `lib`; teks JSX langsung di invoice; berkas `ADMIN_ONLY_SHARED` diimpor dari halaman publik; `getTranslations('catalog.visa')` di katalog.
- Simulasi browser (server uji port 6270, DB klon): `/en/invoice/<token>` (status "AWAITING VERIFICATION", "11 Nov 2026"/"15 Nov 2026", header no-store/noindex/no-referrer, `<html lang="en">` sesudah perbaikan matcher, pengalih membawa token ke `/id/…` yang sepenuhnya Indonesia, token salah tetap 404); `/en/privacy`; `/en/visa` ("Required Documents"; visa plus uji: "Booked together with: Flight ticket, Makkah hotel", lalu dikembalikan); `/en/hotels/<id>` (fasilitas Inggris); 375 px tanpa geser samping.

**Diketahui:** isi baris invoice, kop, rekening, S&K, dan PDF tetap Indonesia (K5); `DateTimeField` dan editor teks kaya tetap Indonesia (khusus admin). Blok "How to pay" tidak terlihat di browser (DB uji tanpa rekening) — teksnya diuji lewat render ICU kedua bahasa. **Di luar cakupan (dicatat):** kartu katalog visa plus menyuruh menghubungi admin tanpa tombol pesan, padahal checkout/keranjang sudah mendukung visa plus (11c); `canBuyDirectly` di `lib/catalog/home.ts` juga mengecualikannya.

### 6.6 I6 — rencana rinci (recheck 2026-11-13)

Recheck (SOP langkah 1) atas semua route non-admin dan modul yang mereka panggil. Pelanggan kini menampilkan `json.error` apa adanya di 21 berkas klien (auth 7, jamaah 6, checkout/keranjang 3, komponen bersama 5). Sumber teks galat yang bisa sampai ke pelanggan (perkiraan, ±150–180 pesan):

| Sumber | Contoh | Jumlah |
|---|---|---|
| Literal `err('…')` di route pelanggan | "Email atau password salah.", "Booking tidak ditemukan", "Internal server error"/"Unauthorized" (Inggris mentah) | 39 bentuk |
| Helper HTTP bersama | `lib/pilgrims/http.ts`, `lib/documents/http.ts` (ukuran berkas, terlalu banyak unggahan, booking tak aktif) | ±20 |
| Hasil service (`{ error, status }` / `message`) | `lib/pilgrims/service.ts`, `lib/documents/*`, `lib/address`, `auth/profile`, verifikasi WhatsApp, `DocumentFileRejected` | ±40 |
| Mesin pesan (`bookingFailure`) | `ItemNotBookableError` (±40, banyak dengan nama produk/tanggal), galat kuota **berbahasa Inggris teknis** ("Hotel quota insufficient: need 2, have 0"), bentrok serialisasi, P2025, `RuleViolationError` | ±50 |
| Pesan Zod validator pelanggan | `auth.ts` (password, nama, email), `checkout.ts`, `pilgrims.ts`, `address.ts`, `manifest` | ±60 |

Pelanggaran aturan visa (`meta.violations`) sudah membawa `visaName` + `missing` (kunci jenis) — bisa diterjemahkan di klien tanpa kode baru.

**Rancangan:**

| Bagian | Rencana |
|---|---|
| Katalog | Pesan `apiErrors.<kode>` di `id.json`/`en.json` = SATU sumber. Teks `id` = teks server sekarang (admin dan log tak berubah). |
| Server | `lib/errors/api.ts` (khusus server): `apiError(kode, params?)` → `{ success: false, error: <teks id>, meta: { code, params } }`; teks `id` dirender dari pesan `id` (ICU), jadi tak ada teks ganda. Bentuk respons tetap `{ success, data?, error?, meta? }` — kode masuk `meta`, bersama `field`/`violations` yang sudah ada. Galat domain membawa kode: hasil service `{ code, params, status }`, `ItemNotBookableError`/galat kuota mendapat `code` + `params` (teks tetap untuk admin). |
| Zod | Satu `zodFailure(error)` untuk route pelanggan: pesan issue dicari di indeks balik teks `id` → kode (hanya pesan statis); tak dikenal → `invalidInput` + `meta.field`. Pesan Zod berparameter (mis. "Maksimal {n} orang") diganti pesan statis per batas atau kode eksplisit lewat `superRefine`. |
| Parameter | Hanya data yang memang sudah tampil ke pemesan (nama produk, tanggal kalender `YYYY-MM-DD`, angka). Tanpa PII. Tanggal diformat di klien sesuai bahasa halaman (nama parameter berakhiran `Date`). |
| Klien | Satu helper `useApiError()` (komponen bersama): kode dikenal → `t(apiErrors.<kode>, params)`; tanpa kode → teks server di `/id`, teks gagal bawaan formulir di `/en` (lihat keputusan I6-1). Pelanggaran visa diterjemahkan dari `visaName` + `missing`. |
| Penjaga | (1) Route pelanggan dan helper/service yang mereka panggil tak boleh `err('<literal>')`/`error: '<literal>'` — harus `apiError`; (2) klien area pelanggan tak boleh membaca `json.error` langsung; (3) setiap `ItemNotBookableError`/galat kuota punya kode; (4) setiap pesan Zod statis di validator pelanggan ada di katalog; (5) kunci id↔en dan argumen ICU sama (penjaga lama). |

**Keputusan pemilik (2026-11-13): I6-1 = (a), I6-2 = (a).**

- **I6-1 — galat tanpa kode di `/en`:** **dipilih (a)** — tampilkan teks gagal bawaan formulir berbahasa Inggris (mis. "Order failed — please try again"); rinciannya hilang, tapi penjaga membuat kasus ini jarang. (b) tampilkan teks server apa adanya (Indonesia) — rincian tetap ada tapi campur bahasa.
- **I6-2 — pemecahan fase:** **dipilih (a)** — **I6a** auth, profil, alamat, jamaah & dokumen, bukti bayar (±100 pesan) lalu **I6b** checkout/keranjang + mesin pesan (±80, termasuk galat kuota Inggris teknis) — masing-masing satu PR; (b) satu fase I6 sekaligus (PR besar, ±40–60 berkas).

### 6.7 I6a (2026-11-13) — as-built

Cakupan: auth (masuk, daftar, aktivasi, Google, lupa/atur ulang password, kontak/WhatsApp), profil, penghapusan akun, alamat, jamaah tersimpan & dokumen, data jamaah booking, bukti bayar, invoice PDF pemesan. Checkout/keranjang dan mesin pesan = I6b.

| Bagian | As-built | Berkas |
|---|---|---|
| Katalog | ±135 kode `apiErrors.<kode>`; teks `id` = teks server (tak berubah untuk admin/log, kecuali tanda baca persetujuan dan `Unauthorized`/`Internal server error` yang kini kalimat Indonesia). | `i18n/messages/{id,en}.json` |
| Server | `apiErrorText`/`apiError`/`apiErrorJson(kode, status, {params, field, headers})`, `zodFailure` (pesan Zod dikenal → kode lewat indeks balik `codeOfText`; tak dikenal → teks tanpa kode + `meta.field`), `codedError` + `failureJson` untuk hasil service (`{ code, params, field }`, `Retry-After`). Khusus server (membaca `id.json`). | `lib/errors/api.ts` |
| Service | `fail`/`bad` menerima KODE: `lib/pilgrims/{service,bookingLink,review,extraFields,http}.ts`, `lib/documents/{service,http,file}.ts` (`DocumentFileRejected(code)`), `lib/address/{prepare,maps}.ts`, `lib/auth/{rateLimit,contact}.ts`. Galat kolom tambahan menyimpan teks rinci (`error`) + kode `fieldInvalid{label}`. | |
| Klien | `useApiError()` → `resolveApiError` murni: bahasa bawaan = teks server (lebih rinci, `/id` tak berubah); bahasa lain = kode dikenal → terjemahan (param `…Date` diformat sesuai bahasa), selain itu teks gagal bawaan formulir (I6-1). Kode dari JSON wajib berbentuk kunci katalog dan bukan nama `Object.prototype`; `__proto__` dibuang dari params (SEC-226). 18 berkas klien memakainya; `AddressPicker` menerjemahkan kode hasil urai tautan peta langsung. | `lib/errors/params.ts`, `components/shared/useApiError.ts` |
| Penjaga | `scripts/test-api-errors.ts`: route pelanggan tanpa `err(`; modul berkode hanya memberi kunci katalog ke `fail`/`bad`; klien tak membaca `.error ??` (pengecualian `CLIENT_PENDING_I6B` = checkout/keranjang); pesan statis validator pelanggan ada di katalog; teks `id` unik, `en` berbeda; setiap kode dipakai; perilaku `resolveApiError`/helper server. Mutasi M1–M6 semua merah. | |

**Bukti (2026-11-13, salinan DB audit, port 6270):** `/en/login` password salah → "Incorrect email or password." (`/id` "Email atau password salah."); NIK urut salah → "Invalid NIK sequence number" (server `meta.code = nikSequence`, `field = nik`); unggah PNG palsu → "Use a photo (JPG, PNG, WebP) or a PDF."; data tambahan nomor `812-ABC-999` → `/en` "Nomor HP Host is not valid", `/id` "Nomor hanya angka" (teks rinci server). Suite penuh lulus di DB sekali pakai; build 0 error.

**Ikut diperbaiki:** `GET /bookings/[id]/invoice` — booking akun lain kini 404 seragam (sebelumnya 401 = oracle keberadaan, dan kini akan tampil "Sesi Anda berakhir", SEC-227).

**Diketahui:** label kolom data jamaah di param (`fieldInvalid{label}`) adalah data admin → tetap seperti diisi; galat tanpa kode di `/en` jatuh ke teks bawaan formulir.

