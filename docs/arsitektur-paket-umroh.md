# Arsitektur — Modul Paket Umroh (`Package`/`PackageItem`)

> **Pembaruan 2026-10-31 (booking engine v2 Fase 4, `docs/arsitektur-booking-engine-v2.md` §10.2):** Paket Umroh kini **dapat dipesan** (item `package`, model `BookingPackage`) dan dijual **PER ORANG**: hotel `included` = malam × harga kamar ÷ isi kamar (kolom `included*NumRooms` diganti `included*Occupancy`), kendaraan `included` = harga ÷ kapasitas, katering `included` = hari × harga per orang-hari. Di invoice paket diurai satu baris per komponen × jumlah orang. Tanggal berangkat dipilih saat booking (dalam periode tiket bila bertiket); hanya kursi tiket yang ditahan. Muthowif `user_choice` belum dapat dipesan. Bagian di bawah yang menyebut "jumlah kamar" atau "booking belum disentuh" adalah riwayat.

> **Status per 2026-07-22: SELESAI & TERVERIFIKASI (§4-§6 — Fase 1-6 semua dieksekusi).** §1-§2 adalah audit as-built kondisi SEBELUM refactor (arsip). §3-§6 adalah rencana yang SUDAH dieksekusi penuh mengikuti "Fase Eksekusi SOP" di `CLAUDE.md` — setiap fase digerbangi `bun run build` 0 error, diverifikasi browser end-to-end (lihat §7).
>
> Cakupan sesi ini **hanya modul PRODUCT** (schema, fungsi harga, admin builder, katalog publik) — **booking engine (wizard, `BookingPackage`, kuota) sengaja TIDAK disentuh**, akan direfactor total terpisah (lihat `docs/arsitektur-booking.md`, rencana pending). Ini instruksi eksplisit user 2026-07-22: "abaikan dulu booking engine ... intinya sekarang focus di product masing2 terlebih dahulu biar cepat."

> **Pembaruan 2026-10-26 — Komponen Biaya kini komponen universal.** Route CRUD biaya, hitung per komponen (`computeCostComponents`), registry pemilik, dan panel UI (`components/admin/pricing/CostComponentsPanel.tsx`) dipakai bersama Paket Umroh, Paket Ziarah, dan Haji — rujukan berkas/route inline pada bagian "Komponen Biaya" di bawah adalah riwayat; sumber kebenaran: `docs/arsitektur-komponen-biaya.md`.

---

## 1. Konteks Bisnis

`Package` adalah representasi "Paket Umroh" — bundel siap-jual yang menggabungkan beberapa produk (hotel Makkah, hotel Madinah, transport, muthowif, visa, tiket pesawat, katering) jadi satu harga per-orang. Konsepnya identik dengan `TourPackage` (Ziarah, `docs/arsitektur-ziarah.md` §8-§12) — bedanya Paket Umroh punya lebih banyak jenis komponen (Ziarah cuma Kendaraan+Hotel).

## 2. Audit As-Built (kondisi sebelum refactor)

Ditemukan lewat audit langsung 2026-07-22:

- **`Package`** (`prisma/schema.prisma:384`): `price`/`priceLabel` diketik **manual** oleh admin — tidak ada hubungan ke HPP/vendor/margin universal (`ProductCost`/`computeSellPrice()`) yang sudah dipakai 6 modul lain.
- **`PackageItem`** (`prisma/schema.prisma:401`): field `productType`/`productId`/`quantity` ada di schema tapi **tidak pernah dipakai** — tidak ada UI admin untuk menambah/mengedit item sama sekali (`app/[locale]/admin/(protected)/products/packages/page.tsx` cuma form nama/deskripsi/harga/highlight bebas teks; **tidak ada halaman `[id]/page.tsx`** untuk builder).
- **Katalog publik** (`app/[locale]/(public)/packages/page.tsx`): tombol "Pesan Paket Ini" cuma `<Link href="/register">` — tidak terhubung ke booking sama sekali.
- Ini persis **Gap #5** yang dicatat di `docs/arsitektur-ziarah.md` §6 — sengaja di luar scope saat itu, sekarang digarap.

**Kesimpulan:** `Package` saat ini murni brosur statis. Perlu dirombak total memakai pola yang sama seperti `TourPackage` (komponen biaya custom bermargin + variable harga 3-mode), tapi diperluas ke 6 komponen sumber (bukan 2).

---

## 3. Scope Komponen (dikonfirmasi user 2026-07-22)

Setiap komponen berikut punya mode `PriceVariableMode` (enum sudah ada — `included` / `user_choice` / `none`, sama seperti `docs/arsitektur-ziarah.md` §12):

| Komponen | Sumber modul | Included = pilih 1 | User Choice = link sumber opsi |
|---|---|---|---|
| Hotel Makkah | `HotelRoomSchedule` (filter kota Makkah) | 1 room schedule + nights + numRooms | daftar kurasi manual (`PackageHotelOption`, slot='makkah') |
| Hotel Madinah | `HotelRoomSchedule` (filter kota Madinah) | 1 room schedule + nights + numRooms | daftar kurasi manual (`PackageHotelOption`, slot='madinah') |
| Transport | `TransportTrip`+`TransportPricing` | 1 `TransportPricing` (vehicle) | link `TransportTrip` → semua `TransportPricing` aktif di trip itu jadi opsi otomatis (persis pola Ziarah, tidak perlu tabel baru) |
| Muthowif | `MuthowifServicePrice` (singleton) | harga singleton di-snapshot | tidak ada "opsi" untuk dipilih (cuma 1 harga) — user_choice di sini murni berarti "harga dikeluarkan dari harga dasar, jadi add-on toggle" |
| Visa | `VisaProduct` | 1 `VisaProduct` | daftar kurasi manual (`PackageVisaOption`) |
| Tiket Pesawat | `FlightRoute`+`FlightSchedule` | 1 `FlightSchedule` | link `FlightRoute` → semua `FlightSchedule` aktif di route itu jadi opsi otomatis (sama pola Transport) |
| Katering | `CateringOption` | 1 `CateringOption` + numPeople + numDays | daftar kurasi manual (`PackageCateringOption`, tiap baris juga simpan numPeople/numDays) |

Plus: **Komponen Biaya custom** (pola sama Ziarah §8.3 — `ProductCost` polimorfik, margin dihitung per komponen lalu dijumlah) untuk biaya lain yang tidak masuk 7 kategori di atas (mis. dokumen, admin fee, dsb) — supaya harga dasar bisa dikalibrasi HPP-nya presisi (permintaan eksplisit user: *"tambah variable harga custom agar mendapat harga dengan nilai hpp yang pas"*).

**Prinsip yang berlaku sama seperti Ziarah §12 (tidak berubah):**
- Semua komponen **opsional** — ketiadaan salah satu tidak membuatnya wajib (`none` selalu valid).
- Snapshot harga `included*Price` selalu **editable** setelah dibuat (prinsip "referensi dari modul lain, bukan angka statis").
- `user_choice` = harga dikeluarkan dari "Harga Jual Paket (dasar)", ditampilkan terpisah sebagai "Opsi Tambahan" — TIDAK dijumlah ke base price.
- **Booking lifecycle (reservasi kuota nyata saat `included`, reservasi saat pilgrim pilih di `user_choice`) TIDAK dikerjakan fase ini** — beda dari Ziarah yang sudah py booking flow existing. Paket Umroh belum py `BookingPackage` sama sekali, jadi tidak ada regresi yang perlu dijaga; kuota-reservation menyusul saat booking-engine-nya sendiri direfactor.

---

## 4. Skema Prisma (rencana)

Tambahan ke `model Package`:

```prisma
model Package {
  // ...existing fields (name, description, price, priceLabel, highlights, images, isActive, isFeatured, createdAt)...

  // Hotel Makkah
  hotelMakkahMode               PriceVariableMode @default(none)
  includedHotelMakkahScheduleId String?
  includedHotelMakkahNights     Int?
  includedHotelMakkahNumRooms   Int?
  includedHotelMakkahPrice      Decimal?          @db.Decimal(14, 2)

  // Hotel Madinah
  hotelMadinahMode               PriceVariableMode @default(none)
  includedHotelMadinahScheduleId String?
  includedHotelMadinahNights     Int?
  includedHotelMadinahNumRooms   Int?
  includedHotelMadinahPrice      Decimal?          @db.Decimal(14, 2)

  // Transport
  transportMode              PriceVariableMode @default(none)
  transportTripId            String?
  includedTransportPricingId String?
  includedTransportPrice     Decimal?          @db.Decimal(14, 2)

  // Muthowif (singleton — tidak ada "sumber opsi")
  muthowifMode          PriceVariableMode @default(none)
  includedMuthowifPrice Decimal?          @db.Decimal(14, 2)

  // Visa
  visaMode             PriceVariableMode @default(none)
  includedVisaProductId String?
  includedVisaPrice     Decimal?          @db.Decimal(14, 2)

  // Tiket Pesawat
  flightMode               PriceVariableMode @default(none)
  flightRouteId            String?
  includedFlightScheduleId String?
  includedFlightPrice      Decimal?          @db.Decimal(14, 2)

  // Katering
  cateringMode              PriceVariableMode @default(none)
  includedCateringOptionId  String?
  includedCateringNumPeople Int?
  includedCateringNumDays   Int?
  includedCateringPrice     Decimal?          @db.Decimal(14, 2)

  items PackageItem[] // TIDAK dipakai lagi setelah refactor — dihapus di Fase 1 (lihat §6 Gap penutupan)

  hotelOptions    PackageHotelOption[]
  visaOptions     PackageVisaOption[]
  cateringOptions PackageCateringOption[]

  transportTrip            TransportTrip?     @relation(fields: [transportTripId], references: [id])
  includedTransportPricing TransportPricing?  @relation(fields: [includedTransportPricingId], references: [id])
  includedVisaProduct      VisaProduct?       @relation(fields: [includedVisaProductId], references: [id])
  flightRoute              FlightRoute?       @relation(fields: [flightRouteId], references: [id])
  includedFlightSchedule   FlightSchedule?    @relation(fields: [includedFlightScheduleId], references: [id])
  includedCateringOption   CateringOption?    @relation(fields: [includedCateringOptionId], references: [id])
  includedHotelMakkahSchedule  HotelRoomSchedule? @relation("PackageHotelMakkah", fields: [includedHotelMakkahScheduleId], references: [id])
  includedHotelMadinahSchedule HotelRoomSchedule? @relation("PackageHotelMadinah", fields: [includedHotelMadinahScheduleId], references: [id])

  @@map("packages")
}

// Kurasi manual opsi Hotel (persis pola TourPackageHotelOption, + slot Makkah/Madinah)
model PackageHotelOption {
  id                  String @id @default(uuid())
  packageId           String
  slot                String // 'makkah' | 'madinah'
  hotelRoomScheduleId String
  nights              Int

  package           Package           @relation(fields: [packageId], references: [id], onDelete: Cascade)
  hotelRoomSchedule HotelRoomSchedule @relation(fields: [hotelRoomScheduleId], references: [id])

  @@unique([packageId, slot, hotelRoomScheduleId])
  @@map("package_hotel_options")
}

model PackageVisaOption {
  id            String @id @default(uuid())
  packageId     String
  visaProductId String

  package     Package     @relation(fields: [packageId], references: [id], onDelete: Cascade)
  visaProduct VisaProduct @relation(fields: [visaProductId], references: [id])

  @@unique([packageId, visaProductId])
  @@map("package_visa_options")
}

model PackageCateringOption {
  id               String @id @default(uuid())
  packageId        String
  cateringOptionId String
  numPeople        Int
  numDays          Int

  package        Package        @relation(fields: [packageId], references: [id], onDelete: Cascade)
  cateringOption CateringOption @relation(fields: [cateringOptionId], references: [id])

  @@unique([packageId, cateringOptionId])
  @@map("package_catering_options")
}
```

Back-relation ditambahkan di: `TransportTrip`, `TransportPricing`, `VisaProduct`, `FlightRoute`, `FlightSchedule`, `CateringOption`, `HotelRoomSchedule` (2 relasi bernama `PackageHotelMakkah`/`PackageHotelMadinah` karena FK ganda ke tabel sama).

`PackageItem` **dihapus** (tidak pernah dipakai kode manapun, dikonfirmasi via grep — aman dihapus, bukan "beri tahu tapi biarkan" karena akan membingungkan developer berikutnya kalau ada 2 sistem bundling di schema yang sama).

Migrasi: 1 file — `add_package_umroh_variable_harga` (drop `package_items`, tambah kolom + 3 tabel baru).

---

## 5. Fungsi Harga — `lib/pricing/computePackagePrice.ts` (baru)

Pola identik `computeTourPackagePrice.ts`:

- `computePackageBreakdown(pkg)` → ambil semua relasi, hitung breakdown detail per komponen + daftar Komponen Biaya custom (`ProductCost` where `productType='package'`, tiap komponen dapat margin sendiri via `computeSellPrice()`, dijumlah — pola §8.3 Ziarah).
- `baseTotal(breakdown)` → `componentsTotalSellPrice` (custom) + tiap komponen yang modenya `included` (hotelMakkah/hotelMadinah/transport/muthowif/visa/flight/catering) — **TIDAK PERNAH** menjumlah komponen `user_choice`.
- `refreshPackagePriceCache(packageId)` → hitung ulang `Package.price` = `baseTotal()`, dipanggil setiap kali field yang mempengaruhi harga berubah (semua `*Mode`/`included*Id` + Komponen Biaya CRUD) — **wajib** dari awal, supaya tidak mengulang bug staleness yang sempat ditemukan di Ziarah (`docs/decisions.md` 2026-07-21).

---

## 6. Fase Eksekusi

1. **Fase 1 — Schema + migrasi** (hapus `PackageItem`, tambah field/tabel di atas)
2. **Fase 2 — `computePackagePrice.ts`** + `refreshPackagePriceCache()`
3. **Fase 3 — API routes admin** (`/api/v1/admin/products/packages/[id]` PUT diperluas, endpoint baru untuk tiap `*-options`, endpoint `costs`, endpoint `breakdown`)
4. **Fase 4 — Admin UI builder** (`app/[locale]/admin/(protected)/products/packages/[id]/page.tsx` — halaman BARU, styling identik pola Ziarah/Flight HPP editor, `ModeSelector` untuk 6 komponen + Komponen Biaya custom + Preview Harga 2-blok)
5. **Fase 5 — Katalog publik** (`(public)/packages/page.tsx` pakai harga hasil cache asli, tampilkan info "opsi tambahan" kalau ada komponen `user_choice`)
6. **Fase 6 — Verifikasi & dokumentasi** (`bun run build` 0 error, browser end-to-end, update `docs/progress.md`/`docs/decisions.md`)

**TIDAK termasuk fase apa pun di atas:** wizard booking, `BookingPackage`, reservasi kuota — menyusul saat booking engine direfactor (`docs/arsitektur-booking.md`).

---

## 7. Verifikasi (2026-07-22)

Semua 6 fase dieksekusi berurutan, tiap fase digerbangi `bun run build` 0 error (dev server direstart setelah tiap build production untuk menghindari korupsi manifest `.next` — masalah lingkungan yang berulang di sesi ini, bukan bug aplikasi).

- **Migrasi** `20260722074403_package_umroh_variable_harga` diverifikasi via shadow database terpisah (`saudinesia_shadow_pkg`, dibuat & di-drop eksplisit) — dikonfirmasi `package_items` (0 baris, aman dihapus) dan `packages` (0 baris) sebelum migrasi jalan, jadi tidak ada data yang hilang.
- **Verifikasi browser end-to-end**: dibuat paket test "Paket Umroh Test 9 Hari" → set Hotel Madinah ke mode `included`, pilih room schedule "Double" (Rp14.200.000/malam) + 3 malam + 2 kamar → klik "Tetapkan" → breakdown Preview Harga menampilkan "Hotel Madinah — ... Rp85.200.000" dan "Harga Jual Paket: Rp85.200.000" (3 × 2 × 14.200.000, benar). Dikonfirmasi juga lewat query DB langsung: `packages.price = 85200000.00`, `includedHotelMadinahPrice = 14200000.00` — cache tersinkron dengan breakdown.
- Dicatat (bukan bug): data seed hotel saat ini **hanya punya Hotel Madinah aktif** (tidak ada Hotel Makkah dengan period+roomType aktif) — dropdown Hotel Makkah kosong karena memang tidak ada data, bukan kesalahan filter kota.
- Data test dibersihkan (`DELETE FROM packages ...`) setelah verifikasi — tabel `packages`/`package_hotel_options`/`package_visa_options`/`package_catering_options`/`product_costs (productType='package')` dikonfirmasi kembali 0 baris.
- Katalog publik (`/packages`) dikonfirmasi menampilkan state kosong dengan benar ("Paket lengkap akan segera tersedia") tanpa error server, setelah data test dihapus.

> **Pembaruan 2026-10-25:** `Package.description` kini **teks kaya** (JSON dokumen Tiptap di kolom `String?` yang sama; teks polos lama tetap sah). Form buat/edit admin memakai `RichTextEditor`; `POST/PUT /admin/products/packages[/id]` memvalidasi lewat `richTextField()`; kartu publik memakai `RichTextView`. Lihat `docs/arsitektur-editor-teks.md` §9.

---

## 8. K1 — Keberangkatan, durasi, kursi, dan halaman detail paket (RENCANA 2026-11-14, DISETUJUI pemilik 2026-11-14 — semua saran K1-1..K1-6)

Sumber: `docs/evaluasi-sistem-2026-11-14.md` K1. Rencana ini mengikuti Fase Eksekusi SOP; belum ada kode yang ditulis.

### 8.1 Masalah

- Pelanggan memilih **tanggal berangkat bebas** dari kalender (`PackageFields.tsx`), dibatasi hanya oleh periode jadwal tiket/hotel bila ada. Ini keputusan lama P3 (`docs/arsitektur-booking-engine-v2.md` §10.2, 2026-10-31) — rencana ini **menggantikannya**.
- Paket tidak punya **durasi**: tanggal pulang = berangkat + Σ malam hotel (`lib/booking/packageItem.ts`), jadi paket tanpa hotel tampil "15-12-2026 – 15-12-2026".
- Paket tidak punya **kursi**: hanya kursi tiket yang ditahan (`packageAdapter`, `lib/quota/adapters/flight.ts`); paket tanpa tiket bisa terjual tanpa batas.
- Tidak ada **halaman detail**: kartu katalog langsung ke checkout. Hotel (nama, bintang, jarak), maskapai, rencana perjalanan, dan "tidak termasuk" tak terlihat.

### 8.2 Recheck dokumen vs kode (SOP langkah 1)

Dokumen ini akurat untuk komponen 3-mode dan Komponen Biaya; selisih yang ditemukan, semuanya sudah dicakup banner di atas atau tak berdampak ke K1:
- §4 masih menulis kolom `price`, `images`, `included*NumRooms`, dan `items PackageItem[]`. Kodenya: harga hanya di `price_points` (harga terpadu Fase 5), foto di `ProductImage` (mode `featured`, satu foto — `lib/media/owners.ts`), `included*Occupancy` (banner 2026-10-31), `PackageItem` sudah dihapus. Ditambah `bookings BookingPackage[]`.
- §6 "booking tidak disentuh" sudah usang: `BookingPackage` (`prisma/schema.prisma` model `BookingPackage`) dibuat di booking engine v2 Fase 4, dengan `departureDate`/`returnDate` `@db.Date`, `flightScheduleId?`, `choices Json`, `quotaConfirmed`, `groupId`.
- Belum tercatat di sini: syarat dokumen paket (`REQUIREMENT_OWNERS` `package`, bawaan paspor/KTP/KK/vaksin), deskripsi teks kaya + `highlights` (daftar teks), penghapusan lewat `lib/admin/productDelete.ts`.
- Titik sentuh item `package` hari ini: `lib/validators/booking.ts` (`departureDate`), `lib/validators/checkout.ts`, `lib/booking/{packageItem,lineItems,create,dates,groups,revise}.ts`, `lib/checkout/options.ts` (`loadPackage`, `packageReturn`), `lib/payments/process.ts`, `lib/quota/adapters/flight.ts` (`packageAdapter`), `lib/documents/requirements.ts`, `lib/admin/productDelete.ts`, `PackageFields.tsx`, editor draf admin (`ItemRows`), dan 9 skrip uji (`test-checkout`, `test-booking-engine-core`, `test-booking-revisions`, `test-booking-groups`, `test-booking-members*`, `test-cost-components`, `test-pilgrim-requirements`).

### 8.3 Keputusan pemilik (DISETUJUI 2026-11-14: K1-1 = b, K1-2 = a, K1-3 = a, K1-4 = a, K1-5 = b, K1-6 = a)

| # | Pertanyaan | Pilihan | Saran |
|---|---|---|---|
| K1-1 | Harga per keberangkatan | (a) satu harga paket untuk semua keberangkatan · (b) harga khusus **opsional** per keberangkatan (kosong = harga paket), mis. Ramadan lebih mahal | **(b)** — musim mengubah harga umroh; disimpan sebagai varian titik harga paket (`variantKey`), jadi tetap lewat mesin harga, snapshot, dan laporan laba yang sama |
| K1-2 | Kursi | (a) kursi per keberangkatan diisi admin; bila paket bertiket, kursi tiket **juga** harus cukup · (b) hanya dari kursi tiket | **(a)** — paket tanpa tiket pun punya batas; tiket tetap dijaga agar tak oversell |
| K1-3 | Hotel & pesawat per keberangkatan | (a) tetap dari template paket; keberangkatan hanya tanggal, kursi, harga, aktif · (b) tiap keberangkatan boleh ganti hotel/jadwal pesawat | **(a)** — beda hotel = paket berbeda (lebih jelas untuk pelanggan); admin diingatkan bila tanggal keberangkatan di luar periode tiket/hotel |
| K1-4 | Durasi | (a) durasi di paket (hari), sama untuk semua keberangkatan; pulang = berangkat + durasi − 1 · (b) durasi per keberangkatan | **(a)** — "Paket 9 Hari" adalah sifat paket |
| K1-5 | Rencana perjalanan | (a) satu teks kaya (`RichTextEditor`, admin menulis "Hari 1 …" sendiri) · (b) terstruktur per hari (hari ke-, judul, keterangan) | **(b)** — mudah dibaca di HP dan seragam antarpaket; tetap teks polos per hari |
| K1-6 | Pesan dari admin (draf) | (a) admin juga memilih dari daftar keberangkatan · (b) admin boleh tanggal bebas | **(a)** — satu sumber kursi dan harga; pengecualian = buat keberangkatan baru |

Ikut dibangun tanpa perlu keputusan: daftar **"Tidak termasuk"** (teks per baris, di samping `highlights` sebagai "Termasuk/Keunggulan"), dan bagian "Termasuk" otomatis dari komponen `included` (hotel, tiket, visa, transport, muthowif, katering).

### 8.4 Rancangan teknis (dengan saran di atas)

**Skema (satu migrasi, fail-closed):**
- `Package`: `durationDays Int?` (wajib > 0 untuk dapat dipesan), `itinerary Json @default("[]")` (`[{ day, title, body }]`, divalidasi Zod, teks polos), `exclusions Json @default("[]")` (daftar teks).
- Model baru `PackageDeparture` — `id`, `packageId` (Cascade dari paket hanya bila tak pernah dipesan; lewat `productDelete`), `departureDate @db.Date`, `totalSeats Int`, `pendingSeats Int @default(0)`, `bookedSeats Int @default(0)`, `isActive Boolean`, `note String?` (internal), `createdAt/updatedAt @db.Timestamptz(3)`; `@@unique([packageId, departureDate])`; CHECK `pendingSeats ≥ 0 AND bookedSeats ≥ 0`. Tanggal pulang **tidak disimpan** — turunan `departureDate + durationDays − 1` lewat satu fungsi murni.
- `BookingPackage.departureId String?` FK Restrict ke `PackageDeparture` (nullable hanya untuk baris lama; jalur pesan baru selalu mengisinya). Migrasi berhenti bila ada draf (`bookings.draft`) berisi item paket — draf tanpa `departureId` tak bisa diterbitkan lagi (DB dev: dicek dulu, dibuang bila ada).
- Harga khusus keberangkatan = titik harga `package` dengan `variantKey = <departureId>` (manual saja, lewat `setManualSell`; tak ada → harga paket). Dibaca hanya lewat `lib/pricing/engine`.

**Satu penulis:** `lib/packages/departures.ts` (buat/ubah/nonaktif/hapus-aman — dihapus bila tak pernah dipesan, selain itu dinonaktifkan; total kursi tak boleh di bawah `pending + booked`) + validator `lib/validators/package.ts`. Dijaga skrip uji baru `scripts/test-package-departures.ts` (penemu sumber: tak ada penulis lain `packageDeparture.*`).

**Mesin pesan:**
- Item `package`: `departureDate` diganti `departureId` (checkout, booking, draf, revisi). `resolvePackageItem` membaca keberangkatan (aktif, belum lewat, paket aktif, `durationDays` terisi) → `departureDate`/`returnDate` turunan; pemeriksaan periode tiket/hotel tetap (SEC-126).
- Kursi: `packageAdapter` + reserve menahan **kursi keberangkatan dan kursi tiket** dalam transaksi yang sama (urutan kunci tetap: keberangkatan → tiket); `confirm`/`release` memakai `quotaConfirmed` per baris seperti sekarang. Habis → `QuotaExhaustedError('quotaPackageDeparture', …)` 409.
- Harga: `compositeLines` paket memakai varian keberangkatan bila ada (baris penyesuaian seperti harga manual sekarang); invoice menulis "berangkat 15 Des 2026 · 9 hari".

**Admin (editor paket, tata letak `EditorShell`):** kotak "Durasi & rencana perjalanan" (durasi, baris per hari, tidak termasuk) dan kotak "Keberangkatan" (tabel `DataTable`: tanggal, pulang turunan, kursi total/terjual/ditahan, harga khusus, status; aksi `RowActions` + `ConfirmDialog`). Peringatan (tidak menolak) bila tanggal di luar periode tiket/hotel atau malam hotel > durasi − 1. Draf admin: kolom paket di `ItemRows` memilih keberangkatan.

**Publik:**
- Halaman detail baru `/{locale}/packages/[id]` — foto, ringkasan (durasi, kota, maskapai bila ada), kartu hotel (nama, bintang, jarak ke Masjid), rencana perjalanan per hari, termasuk / tidak termasuk, syarat dokumen (`RequiredDocuments`), daftar keberangkatan (tanggal, pulang, sisa kursi "tinggal N" bila sedikit, harga per orang) dengan tombol Pesan → checkout terisi. Metadata + `localizedAlternates`, masuk sitemap, teks lewat pesan id/en (`catalog.packages.detail.*`), 404 bila nonaktif. Tak ada HPP/vendor di halaman (penjaga `test-public-home`).
- Kartu katalog → halaman detail (tombol "Lihat detail"), menampilkan durasi + keberangkatan terdekat.
- Checkout: `PackageFields` memilih dari daftar keberangkatan (yang habis/lewat tampil mati), bukan kalender; kunci isian awal baru `departure` (UUID) di `PREFILL_KEYS` → otomatis ikut jalur kembali login (`safeNextPath`).

**Di luar K1 (dicatat):** T2 (checkout paket menampilkan rincian komponen internal) dikerjakan terpisah; hotel/transport paket tetap tidak menahan kuota (gap lama §10.2); muthowif `user_choice` paket tetap 422.

### 8.5 Fase

1. **F1 — Skema + migrasi + penulis keberangkatan** (`lib/packages/departures.ts`, validator, uji migrasi fail-closed di DB pra-migrasi berisi data).
   **As-built F1 (2026-11-14):** migrasi `20261122090000_package_departures` (aditif; CHECK kursi `pending + booked ≤ total` dan tak negatif, durasi 1–60, `itinerary`/`exclusions` array). `Package.durationDays`/`itinerary`/`exclusions`; `PackageDeparture` (FK paket **Restrict** — penghapus paket memanggil `dropDeparturesOf` untuk paket yang belum pernah dipesan); `BookingPackage.departureId` (Restrict). Penulis tunggal `lib/packages/departures.ts` (`listDepartures`, `createDeparture`, `updateDeparture`, `deleteOrDeactivateDeparture`; galat berkode `DepartureError`: `packageNotFound`, `departureNotFound`, `departureDuplicate`, `departurePast`, `departureSeatsBelowSold`, `departureDateLocked`; baris dikunci `FOR UPDATE`; tanggal terkunci setelah dipesan; hapus = nonaktif bila dirujuk, cadangan P2003). Rumus murni `lib/packages/dates.ts` (`packageReturnDate`, `seatsLeft`). Validator `lib/validators/package.ts` (`departureCreate/UpdateSchema`, `packageDetailSchema`, `readItinerary`/`readExclusions`). Uji `scripts/test-package-departures.ts` (masuk `bun run test`) + `test-admin-delete` (FK baru, keberangkatan ikut terhapus). Pemeriksaan fail-closed draf berisi item paket dipindah ke F3 (bentuk item baru berubah di sana).
2. **F2 — Admin editor paket** (durasi, rencana perjalanan, tidak termasuk, keberangkatan + harga khusus; hapus aman).
   **As-built F2 (2026-11-14):** API `GET/POST /api/v1/admin/products/packages/[id]/departures` (daftar + `meta.warnings`) dan `PUT/DELETE …/departures/[departureId]` (dicakup ke paketnya — id keberangkatan paket lain = 404; hapus-aman mengembalikan `data.message` bila dinonaktifkan); peran `requireManager`; galat berkode dipetakan di `lib/packages/http.ts` (`departureFailureResponse`). `PUT` paket menerima `durationDays`/`itinerary`/`exclusions` (bentuk dari `packageDetailFields`) dan menolak rencana yang melewati durasi atas nilai GABUNGAN tersimpan + dikirim. Peringatan editor = fungsi murni `lib/packages/warnings.ts` (`departureWarnings`: durasi kosong, malam hotel `included` > durasi − 1, tak ada keberangkatan aktif, tanggal di luar periode tiket — hanya tanggal berangkat — atau hotel — seluruh berangkat–pulang); HANYA mengingatkan, penolakan tetap di mesin pesan F3. UI: kotak `TripPlanBox` (durasi, rencana per hari, tidak termasuk; tersimpan lewat Simpan perubahan) dan `DeparturesBox` (CRUD modal, sisa kursi, Penuh/Hampir penuh/Sudah lewat, catatan internal, nonaktif/aktifkan, hapus aman) di halaman edit paket. `ListCrudBox` dipindah ke `components/admin/editor/` (dipakai Pengaturan Invoice dan keberangkatan; prop baru `onMeta`/`header`/`addLabel`). **Harga khusus per keberangkatan DIPINDAH ke F4** (lihat F3/F4 di bawah): titik harga paket adalah komposit dengan varian statis (`creatableVariants`), dan harga varian baru bermakna bila mesin pesan membacanya — dikerjakan sesudah mesin pesan memakai keberangkatan.
3. **F3 — Mesin pesan + checkout memilih keberangkatan** (menyerap F4 lama: mengganti `departureDate` → `departureId` di masukan item mematahkan checkout publik bila dipisah, jadi keduanya satu PR). Rincian (disusun 2026-11-14 setelah recheck kode):
   - Validator: item `package` = `departureId` (uuid), `departureDate` dihapus (booking, draf, revisi, checkout `checkoutSchema`). Migrasi fail-closed: berhenti bila ada draf (`bookings.draft`) berisi item paket (DB dev: 0).
   - `resolvePackageItem`: keberangkatan milik paket itu, aktif, belum lewat; paket aktif dan berdurasi (`durationDays` kosong → 422 `itemPackageNoDuration`); `departureDate` = tanggal keberangkatan, `returnDate` = `packageReturnDate` (bukan lagi berangkat + malam hotel); pemeriksaan periode tiket/hotel tetap (SEC-126).
   - Kursi: `reservePackageDeparture`/`confirm`/`release` di `lib/quota/index.ts` (baris dikunci `FOR UPDATE`, habis → `QuotaExhaustedError('quotaPackageDeparture')` 409); urutan tahan: keberangkatan → tiket. `packageAdapter` konfirmasi/lepas keduanya (baris lama tanpa `departureId` hanya tiket).
   - `BookingPackage.departureId` diisi setiap jalur pesan; revisi membaca `departureId` baris lama (baris lama tanpa keberangkatan → 422 `itemPackageDepartureMissing`, data dev saja).
   - Draf admin (`ItemRows`): kolom paket memilih keberangkatan dari katalog admin (`lib/booking/catalog.ts` memuat keberangkatan aktif yang belum lewat + sisa kursi).
   - Checkout (`PackageFields`): daftar keberangkatan (tanggal–pulang, sisa kursi, habis tampil mati) menggantikan kalender; isian awal `departure` di `PREFILL_KEYS`.
   - Invoice: rincian item "tanggal berangkat – pulang · N orang" (sudah dari tanggal item).
   **As-built F3 (2026-11-14):** semua butir di atas dieksekusi. Penyesuaian dari rincian: (a) "aktif" dan "belum lewat" TIDAK diperiksa di `resolvePackageItem` (yang juga dipakai untuk isi LENGKAP saat revisi) melainkan di `reservePackageDepartureQuota` (di dalam kunci `FOR UPDATE`), yang hanya dipanggil untuk item baru/diganti — item lama yang keberangkatannya kemudian lewat/dinonaktifkan tetap ikut revisi bagian lain; (b) kode galat baru `itemPackageDepartureUnavailable`, `itemPackageDeparturePast`, `itemPackageNoDuration`, `itemPackageDepartureMissing` (baris pra-K1 tanpa keberangkatan), `quotaPackageDeparture` (409); (c) pemeriksa tanggal checkout (`checkoutDate`) tak lagi menilai paket — tanggalnya dari server, keberangkatan lewat ditolak mesin (422); (d) kartu keranjang paket hanya menampilkan jumlah orang (keranjang tak menyimpan tanggal tampilan; tanggal tampil di ringkasan pesanan dari pratinjau server); (e) checkout memakai kartu pilihan keberangkatan (tombol, yang penuh mati) — `ChoiceSelect` tak punya opsi mati; draf admin memakai `ChoiceSelect` dengan petunjuk "sisa N kursi / penuh"; (f) `bookableDepartures` (`lib/packages/departures.ts`) satu pembaca untuk katalog admin dan checkout (aktif, belum lewat, paket berdurasi; tanpa catatan internal); keberangkatan di luar periode tiket tidak ditawarkan di checkout. Migrasi `20261123090000_package_item_departure` hanya pemeriksaan fail-closed (tanpa perubahan skema). Security review F3: 0 Critical/High/Medium, 3 Low — SEC-232 (tanggal keberangkatan dibandingkan ulang di dalam kunci saat menahan kursi) dan SEC-233 (deadlock 40P01 diulang → 409, bukan 500) diperbaiki; SEC-234 diterima: baris paket pra-K1 tanpa `departureId` tak bisa dipertahankan saat revisi (harus memilih keberangkatan) — belum ada data produksi.
4. **F4 — Harga khusus per keberangkatan** (dipindah dari F2/F3): varian titik harga `package` ber-`variantKey` = id keberangkatan (manual saja, lewat `setManualSell`; varian boleh dibuat bila keberangkatan milik paket itu), `compositeLines` membaca varian keberangkatan bila ada, harga "mulai dari" katalog = termurah, kolom harga di `DeparturesBox`, varian dibersihkan saat keberangkatan dihapus.
5. **F5 — Halaman detail publik + kartu katalog** (id/en, SEO, sitemap, 375 px; rencana perjalanan hanya hari ≤ durasi).
6. **F6 — Verifikasi menyeluruh & dokumentasi** (browser admin → publik → checkout → booking; suite di DB sekali pakai; build; security review; `docs/progress.md`, `docs/decisions.md` keputusan pengganti P3, CLAUDE.md aturan "keberangkatan paket hanya lewat `lib/packages/departures.ts`").

Setiap fase satu PR, build 0 error + security review sebelum lanjut.
