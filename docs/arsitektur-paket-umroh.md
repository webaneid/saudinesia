# Arsitektur — Modul Paket Umroh (`Package`/`PackageItem`)

> **Status per 2026-07-22: SELESAI & TERVERIFIKASI (§4-§6 — Fase 1-6 semua dieksekusi).** §1-§2 adalah audit as-built kondisi SEBELUM refactor (arsip). §3-§6 adalah rencana yang SUDAH dieksekusi penuh mengikuti "Fase Eksekusi SOP" di `CLAUDE.md` — setiap fase digerbangi `bun run build` 0 error, diverifikasi browser end-to-end (lihat §7).
>
> Cakupan sesi ini **hanya modul PRODUCT** (schema, fungsi harga, admin builder, katalog publik) — **booking engine (wizard, `BookingPackage`, kuota) sengaja TIDAK disentuh**, akan direfactor total terpisah (lihat `docs/arsitektur-booking.md`, rencana pending). Ini instruksi eksplisit user 2026-07-22: "abaikan dulu booking engine ... intinya sekarang focus di product masing2 terlebih dahulu biar cepat."

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
