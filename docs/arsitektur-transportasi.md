# Arsitektur — Modul Transportasi

> **Status: SELESAI & TERVERIFIKASI (2026-07-20).** §1-§6 adalah arsip audit as-built pra-upgrade (2026-07-08, di-recheck 2026-07-19) — skema/API/UI yang dideskripsikan di sana **sudah digantikan** oleh §9 (harga per rute×kendaraan, terintegrasi `docs/arsitektur-harga.md`). §7 (Gap) sudah diperbarui: Gap #1 (pickupDetail/dropoffDetail kosong), Gap #4 (KRITIS, harga client-trusted), dan Gap #5 (error handling) **DITUTUP**. §9 adalah rencana yang sudah dieksekusi penuh (Fase 0-6) dan diverifikasi — `bun run build` 0 error, browser end-to-end (admin cost editor → katalog publik), dan script test Gap #4. Lihat `docs/decisions.md` untuk bukti verifikasi lengkap.
>
> Riwayat keputusan yang melahirkan struktur v3 (sebelum upgrade §9) ada di `docs/decisions.md` entri **2026-05-22 — Transport v3: Harga di TransportPricing (Trip × Vehicle), bukan di Vehicle**.

---

## 1. Konteks Bisnis

Transport adalah layanan berbayar Saudinesia. Harga **bukan** sifat kendaraan saja — harga adalah fungsi dari **kombinasi trip (paket perjalanan) × kendaraan**. Contoh: Sedan untuk Airport Transfer bisa Rp 1jt, tapi Sedan untuk City Tour bisa Rp 3jt — kendaraan sama, trip beda, harga beda.

Tiga entitas independen: `TransportVehicle` (spesifikasi fisik, tanpa harga), `TransportTrip` (paket perjalanan, tanpa harga), `TransportPricing` (harga untuk kombinasi trip+kendaraan tertentu, per season, dengan opsi charter dan/atau per-kursi).

---

## 2. Skema Data Aktual (Prisma)

Sumber: `prisma/schema.prisma:134-200` (Vehicle/Trip/Pricing/Quota), `:517-533` (BookingTransport).

```prisma
model TransportVehicle {
  id          String   @id @default(uuid())
  name        String
  vehicleType String
  capacity    Int
  fleetCount  Int      @default(1)
  description String?
  images      Json     @default("[]")
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  pricing TransportPricing[]
  @@map("transport_vehicles")
}
// TIDAK ADA field harga di sini — sudah sepenuhnya dipindah ke TransportPricing (sesuai rencana v3)

model TransportTrip {
  id              String   @id @default(uuid())
  name            String
  category        String?  // bebas admin: "airport" | "city_tour" | "intercity" | dll
  description     String?
  originHint      String?  // hint untuk user saat booking, mis. "Nama bandara & nomor terminal"
  destinationHint String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  pricing TransportPricing[]
  @@map("transport_trips")
}
// TransportRoute (model lama) SUDAH TIDAK ADA — dikonfirmasi hilang dari schema

model TransportPricing {
  id             String   @id @default(uuid())
  tripId         String
  vehicleId      String
  perSeatEnabled Boolean  @default(false)
  charterRegular Decimal? @db.Decimal(12, 2)
  charterRamadan Decimal? @db.Decimal(12, 2)
  charterHajj    Decimal? @db.Decimal(12, 2)
  perSeatRegular Decimal? @db.Decimal(12, 2)
  perSeatRamadan Decimal? @db.Decimal(12, 2)
  perSeatHajj    Decimal? @db.Decimal(12, 2)

  trip    TransportTrip    @relation(fields: [tripId], references: [id])
  vehicle TransportVehicle @relation(fields: [vehicleId], references: [id])
  quotas  TransportQuota[]

  @@unique([tripId, vehicleId])  // satu kombinasi trip+vehicle = satu pricing row
  @@map("transport_pricing")
}

model TransportQuota {
  id           String   @id @default(uuid())
  pricingId    String   // BUKAN lagi vehicleId + routeId terpisah
  travelDate   DateTime @db.Date
  totalSeats   Int
  pendingSeats Int      @default(0)
  bookedSeats  Int      @default(0)

  pricing           TransportPricing   @relation(fields: [pricingId], references: [id])
  bookingTransports BookingTransport[]

  @@unique([pricingId, travelDate])
  @@map("transport_quotas")
}

model BookingTransport {
  id               String   @id @default(uuid())
  bookingId        String
  transportQuotaId String
  travelDate       DateTime @db.Date
  numPassengers    Int      @default(1)
  isCharter        Boolean  @default(false)
  unitPrice        Decimal  @db.Decimal(12, 2)  // snapshot harga saat booking
  totalPrice       Decimal  @db.Decimal(14, 2)
  pickupDetail     String?
  dropoffDetail    String?

  booking        Booking        @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  transportQuota TransportQuota @relation(fields: [transportQuotaId], references: [id])
  @@map("booking_transports")
}
```

Skema **cocok 100% dengan rencana v3** — tidak ada gap antara `docs/decisions.md` dan implementasi di layer ini.

---

## 3. API Routes (aktual, terverifikasi per file)

| Method | Path | Auth guard | File |
|---|---|---|---|
| GET, POST | `/api/v1/admin/products/transport/vehicles` | `requireManager()` | `.../vehicles/route.ts` |
| GET, PUT | `/api/v1/admin/products/transport/vehicles/[id]` | `requireManager()` | `.../vehicles/[id]/route.ts` — **tidak ada DELETE**, disengaja: kendaraan dipakai `TransportPricing`, nonaktifkan via `isActive` bukan hapus |
| GET, POST, DELETE | `/api/v1/admin/products/transport/vehicles/[id]/images` | `requireManager()` | Galeri foto via MinIO, key `transport/{vehicleId}/images/{filename}` |
| GET, POST | `/api/v1/admin/products/transport/trips` | `requireManager()` | `.../trips/route.ts` |
| GET, PUT, DELETE | `/api/v1/admin/products/transport/trips/[id]` | `requireManager()` | Delete cascade ke `TransportPricing` |
| GET, POST | `/api/v1/admin/products/transport/pricing` | `requireManager()` | Cek duplikat `(tripId, vehicleId)` sebelum insert → 409 jika sudah ada |
| PUT, DELETE | `/api/v1/admin/products/transport/pricing/[id]` | `requireManager()` | **Tidak ada GET single** — tidak masalah karena trip edit page load via `/trips/[id]` yang sudah include pricing |
| GET | `/api/v1/catalog/transport` | publik | Query `TransportQuota` → `include pricing → include trip, vehicle`; filter `category` opsional + `travelDate`; hitung harga via `detectSeason()` lalu akses dinamis `pricing[\`charter${suffix}\`]` / `pricing[\`perSeat${suffix}\`]`; grouping `byTrip` disiapkan di response |

Booking creation (`app/api/v1/bookings/route.ts`):
- Validator `lib/validators/booking.ts:24-32` — array `transports[]`, tiap item: `transportQuotaId`, `numPassengers`, `isCharter`, `unitPrice`, `totalPrice`, `pickupDetail?`, `dropoffDetail?`
- Di dalam `$transaction(Serializable)`: `reserveTransportQuota(tx, quotaId, seats)` (`lib/quota/index.ts:33-44`) — cek `totalSeats - pendingSeats - bookedSeats >= seats`, throw jika kurang, lalu `increment pendingSeats`
- `tx.bookingTransport.create({ ... unitPrice, totalPrice, pickupDetail, dropoffDetail })` — snapshot harga tersimpan

---

## 4. Season Pricing

`lib/utils/season.ts` — `detectSeason(date)` query tabel `Season` (`startDate <= date <= endDate`), fallback `'regular'`. Tidak seperti Visa yang pakai kolom terpisah per kondisi, harga transport disimpan **6 kolom tetap** di satu row `TransportPricing` (`charterRegular/Ramadan/Hajj`, `perSeatRegular/Ramadan/Hajj`) — bukan row terpisah per season. API catalog mengakses kolom yang sesuai secara dinamis berdasarkan season yang terdeteksi untuk `travelDate` yang diminta.

---

## 5. Admin UI

`app/[locale]/admin/(protected)/products/transport/page.tsx` — **2 tab**:
- **Tab Kendaraan** — form tambah kendaraan (nama, tipe, kapasitas, armada) — tanpa field harga, dengan catatan eksplisit di UI bahwa harga diatur di halaman Trip
- **Tab Trip & Harga** — form tambah trip (nama, kategori, originHint, destinationHint) + tabel trip dengan link ke halaman edit per-trip

`app/[locale]/admin/(protected)/products/transport/trips/[id]/page.tsx` — halaman edit trip + **pricing builder**:
- Edit metadata trip
- Dropdown tambah kendaraan (hanya kendaraan yang belum punya pricing row untuk trip ini — dicegah dari sisi UI dengan filter `usedVehicleIds`, dan dari sisi API dengan constraint unik + cek 409)
- Per kendaraan: 3 input harga charter (Regular/Ramadan/Haji), toggle per-kursi, 3 input harga per-kursi (muncul hanya jika toggle aktif), tombol hapus pricing row
- Danger zone: hapus trip (cascade ke semua pricing-nya)

---

## 6. Katalog Publik & Wizard

`app/[locale]/(public)/transport/page.tsx` — group by `category` (default `"Lainnya"` jika null), tiap trip menampilkan kartu per kendaraan dengan foto (presigned URL), harga charter, dan harga per-kursi (hanya jika `perSeatEnabled && perSeatPrice > 0`), indikator season aktif di bawah.

`app/[locale]/(pilgrim)/bookings/new/transport/page.tsx` — fetch `/api/v1/catalog/transport?date=<departureDate>`, kelompokkan by `tripId` lalu by `tripCategory`. User bisa pilih **satu kendaraan per trip**, dan bisa memilih banyak trip berbeda (ini yang dimaksud "multi-route" di `docs/progress.md`) — charter atau per-kursi, tergantung ketersediaan dan `perSeatEnabled`.

---

## 7. Gap / Ketidaksesuaian Aktif (audit 2026-07-08, di-recheck 2026-07-19)

Berbeda dengan Visa, modul Transport v3 **hampir tidak ada gap struktural** — skema, API, dan alur data cocok penuh dengan rencana. Recheck 2026-07-19 (sebelum upgrade) menemukan 2 gap baru yang tidak pernah tercatat sebelumnya — salah satunya kritis:

| # | Gap | Lokasi | Dampak |
|---|-----|--------|--------|
| ~~1~~ | ~~`pickupDetail`/`dropoffDetail` selalu dikirim sebagai string kosong `''` dari wizard~~ | — | **DITUTUP 2026-07-20** — `app/[locale]/(pilgrim)/bookings/new/transport/page.tsx` sekarang punya 2 input teks (titik jemput/antar) per trip yang dipilih, muncul begitu jamaah pilih kendaraan, sinkron ke draft dan terkirim apa adanya lewat validator+booking creation (field ini sudah ada di skema & payload, cuma UI input-nya yang hilang). |
| ~~2~~ | ~~Stub mati: `app/api/v1/admin/transport/route.ts` dan `components/booking/TransportPicker.tsx`~~ | — | **DITUTUP** — dikonfirmasi 2026-07-19, kedua file **sudah tidak ada** di codebase (`ls` gagal, "No such file or directory"). Kapan/oleh siapa dihapus tidak tercatat, tapi hasil akhirnya bersih. |
| 3 | Tidak ada `DELETE` untuk vehicle dan tidak ada `GET` single untuk pricing | `.../vehicles/[id]/route.ts`, `.../pricing/[id]/route.ts` | Disengaja/tidak masalah — vehicle dinonaktifkan bukan dihapus (masih dipakai pricing), pricing tunggal tidak dibutuhkan karena selalu diambil bersama trip |
| ~~4~~ | ~~🔴 KRITIS — `unitPrice`/`totalPrice` booking transport dipercaya MENTAH dari body request client~~ | — | **DITUTUP 2026-07-19** — bagian dari upgrade §9. `unitPrice`/`totalPrice`/`isCharter` dihapus total dari `transportSelectionSchema` (`lib/validators/booking.ts`); `app/api/v1/bookings/route.ts` sekarang fetch `TransportQuota.pricing.price` server-side di dalam `$transaction()`. Diverifikasi lewat script test langsung: client kirim `unitPrice:1` (field yang sudah tidak ada di schema, sekadar dibuktikan diabaikan), harga tersimpan tetap `TransportPricing.price` asli. Lihat `docs/decisions.md` 2026-07-19 "Modul Transportasi: Upgrade §9 Selesai & Terverifikasi". |
| ~~5~~ | ~~Semua route admin Transport pakai `catch{...403}` polos~~ | — | **DITUTUP 2026-07-19** — semua route (`vehicles`, `vehicles/[id]`, `trips`, `trips/[id]`, `pricing`, `pricing/[id]`, `pricing/[id]/cost` baru, `simulate` baru) sekarang `catch (e)` dengan `console.error` + pembedaan 403 (Unauthorized/Forbidden) vs 500 (error lain), pola sama Visa/Flight/Hotel. |

Item #1 masih terbuka (di luar scope upgrade §9 — user tidak memintanya diperbaiki di sini). Item #4 dan #5 tertutup sebagai efek samping struktural dari upgrade §9, sama pola dengan Hotel §10/§11.

---

## 8. Referensi Silang

- Keputusan arsitektur: `docs/decisions.md` → **2026-05-22 — Transport v3: Harga di TransportPricing (Trip × Vehicle), bukan di Vehicle**
- Status milestone: `docs/progress.md` → **M10 Transport v3**
- `docs/architecture.md` bagian Transport (skema lama `transport_routes`, endpoint `/api/admin/*`) **sudah tidak akurat** — arsip desain awal saja.
- Pola dokumen ini mengikuti template `docs/arsitektur-visa.md`.
- `docs/arsitektur-hotel.md` §8 Gap #1 & §10 — preseden persis untuk Gap #4 di atas (harga booking client-trusted), sudah ditutup di Hotel dengan pola: entitas harga (`HotelRoomSchedule.price`) di-fetch ulang server-side saat `POST /api/v1/bookings`, field harga dihapus dari Zod schema client. Kalau Transport diupgrade dengan pola serupa (Vendor/ProductCost/computeSellPrice()), Gap #4 tertutup otomatis sebagai efek samping struktural — sama seperti yang terjadi di Hotel.
- `docs/arsitektur-visa.md` §7 Gap #6 (DITUTUP 2026-07-18) — preseden pola error-handling `catch{...403}` polos yang jadi Gap #5 di atas, belum pernah diterapkan ke Transport.

---

## 9. RENCANA — Upgrade Harga Rute × Kendaraan (belum dieksekusi)

> Ditulis 2026-07-19 sesuai permintaan user: harga transport mengikuti logika yang sama dengan Tiket Pesawat — setiap **rute** (origin → destination) punya beberapa **jenis kendaraan**, tiap kombinasi rute×kendaraan punya **satu harga** (bukan matrix charter/per-kursi/season), dan tiap harga punya HPP sendiri lewat infrastruktur `docs/arsitektur-harga.md`. Contoh nyata dari user: rute Bandara→Hotel naik Sedan = Rp 20rb, rute Hotel→Wisata naik Bus = Rp 230rb, rute Bandara→Hotel naik Bus = Rp 2jt — kombinasi rute×kendaraan yang sama bisa muncul beberapa kali dengan kendaraan berbeda, harga berbeda.

### 9.1 Keputusan Struktural (dikonfirmasi user via AskUserQuestion, 2026-07-19)

| Keputusan | Pilihan | Rasional |
|---|---|---|
| Struktur rute | **Wajib terstruktur**: `TransportTrip.origin`/`destination` jadi field wajib (bukan lagi `originHint`/`destinationHint` opsional) | Meniru `FlightRoute` — rute adalah entitas jelas, bukan sekadar hint teks bebas |
| Harga musiman (Regular/Ramadan/Hajj) | **Dihapus total** dari `TransportPricing` | User: harga vendor transport riil tidak dipecah per musim seperti itu — beda dari asumsi awal v3 |
| Charter vs Per-Kursi | **Dihapus total** — satu harga flat per kombinasi rute×kendaraan | Menyederhanakan; klarifikasi lebih lanjut di §9.2 di bawah soal makna harga flat ini |
| Vendor/HPP scope | **Per kombinasi rute×kendaraan** (bukan per rute) | Kendaraan berbeda plausibel dari operator/vendor berbeda meski rute sama |

### 9.2 Makna "harga flat" — analisis dari 3 contoh user

Ketiga contoh harga dari user (Sedan Bandara→Hotel Rp 20rb, Bus Hotel→Wisata Rp 230rb, Bus Bandara→Hotel Rp 2jt) semuanya adalah **harga sewa kendaraan per trip**, bukan harga per kepala penumpang — Rp 2jt untuk 1 bus jelas bukan per-orang. Ini persis semantik "charter" yang sudah ada di model lama, cuma sekarang jadi **satu-satunya** mode (opsi per-kursi dihapus, bukan dipilih).

Konsekuensi konkret:
- `TransportPricing.price` = harga flat sewa 1 unit kendaraan untuk rute ini (cache dari `computeSellPrice()`, sama pola `FlightSchedule.price`/`HotelRoomSchedule.price`).
- `BookingTransport.totalPrice = unitPrice` (TIDAK dikalikan `numPassengers`) — beda dari asumsi lama yang mengalikan untuk mode per-kursi.
- `numPassengers` tetap dipertahankan sebagai jumlah kursi yang direservasi dari `TransportQuota` (kuota tetap dalam satuan kursi/kapasitas, tidak berubah — lihat §9.3) — field ini murni untuk validasi kapasitas, bukan pengali harga.
- `BookingTransport.isCharter` **dihapus** — sudah tidak ada mode lain untuk dibedakan.

### 9.3 Skema Baru (Prisma)

```prisma
model TransportTrip {
  id          String   @id @default(uuid())
  name        String
  category    String?
  description String?
  origin      String   // WAJIB — sebelumnya originHint opsional
  destination String   // WAJIB — sebelumnya destinationHint opsional
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  pricing TransportPricing[]
  @@map("transport_trips")
}

model TransportVehicle {
  // TIDAK BERUBAH
}

model TransportPricing {
  id       String   @id @default(uuid())
  tripId   String
  vehicleId String
  price    Decimal  @db.Decimal(12, 2) @default(0)  // cache computeSellPrice(), diisi lewat endpoint cost
  isActive Boolean  @default(true)
  createdAt DateTime @default(now())

  trip    TransportTrip    @relation(fields: [tripId], references: [id])
  vehicle TransportVehicle @relation(fields: [vehicleId], references: [id])
  quotas  TransportQuota[]

  @@unique([tripId, vehicleId])
  @@map("transport_pricing")
}
// DIHAPUS: perSeatEnabled, charterRegular/Ramadan/Hajj, perSeatRegular/Ramadan/Hajj

model TransportQuota {
  // TIDAK BERUBAH — tetap per (pricingId, travelDate), satuan kursi/kapasitas.
  // Tidak ada alasan mengubah granularitas kuota, cuma harga yang disederhanakan.
}

model BookingTransport {
  id               String   @id @default(uuid())
  bookingId        String
  transportQuotaId String
  travelDate       DateTime @db.Date
  numPassengers    Int      @default(1)
  unitPrice        Decimal  @db.Decimal(12, 2)
  totalPrice       Decimal  @db.Decimal(14, 2)
  pickupDetail     String?
  dropoffDetail    String?

  booking        Booking        @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  transportQuota TransportQuota @relation(fields: [transportQuotaId], references: [id])
  @@map("booking_transports")
}
// DIHAPUS: isCharter
```

### 9.4 Integrasi Harga (`docs/arsitektur-harga.md`)

Transport jadi modul ke-4 yang pakai infrastruktur universal (setelah Visa, Flight, Hotel) — pola paling mirip **Flight** (bukan Hotel): satu komponen HPP flat, tidak day-based, tidak per-periode.

- `costComponent`: `"kendaraan"` (konstanta `COMPONENT_KENDARAAN`), tier flat `[{minDays:0, maxDays:9999, cost}]` — persis pola `COMPONENT_TIKET` Flight (`lib/pricing/refreshFlightScheduleCache.ts`, `PROBE_DAY = 1`).
- `productType`: `'transport'`, `productId`: `TransportPricing.id`.
- `Vendor.category`: tambah nilai `'transport'` ke quick-add UI (pola sama `'syarikah'`/`'maskapai'`/`'hotel'`, field sudah generik `String?` di schema, tidak butuh migrasi).
- `PreferredVendor`: unique `[productType, productId, costComponent]` sudah generik, tidak butuh perubahan skema.
- Cache refresh: `lib/pricing/refreshTransportPricingCache.ts` (baru) — isi identik `refreshFlightScheduleCache.ts`, target `prisma.transportPricing.update({ data: { price: result.sellPrice } })`.

### 9.5 API Routes (rencana)

| Method | Path | Perubahan dari sekarang |
|---|---|---|
| GET, POST | `/api/v1/admin/products/transport/vehicles` | Tidak berubah |
| GET, PUT | `/api/v1/admin/products/transport/vehicles/[id]` | Tidak berubah |
| GET, POST | `/api/v1/admin/products/transport/trips` | Zod: `origin`/`destination` wajib (ganti `originHint`/`destinationHint`); tambah `try/catch` + `console.error` proper (tutup Gap #5) |
| GET, PUT, DELETE | `/api/v1/admin/products/transport/trips/[id]` | Sama seperti di atas |
| GET, POST | `/api/v1/admin/products/transport/pricing` | POST bikin row dengan `price: 0` (placeholder, pola `FlightSchedule`) — bukan 6 kolom harga manual lagi; Zod cuma `tripId`+`vehicleId` |
| GET, PUT, DELETE | `/api/v1/admin/products/transport/pricing/[id]` | Tambah `GET` single (dibutuhkan halaman cost editor); Zod PUT cuma `isActive` |
| GET, PUT | `/api/v1/admin/products/transport/pricing/[id]/cost` | **BARU** — HPP editor (vendorId, currency, hargaKendaraan), pola identik `flight/schedules/[id]/cost/route.ts`, panggil `refreshTransportPricingCache()` setelah save |
| GET | `/api/v1/admin/products/transport/simulate` | **BARU** — preview live HPP/harga jual dari angka yang sedang diketik, pola identik `flight/simulate/route.ts` |
| GET | `/api/v1/catalog/transport` | Hapus logika `detectSeason()`/akses dinamis `charter${suffix}`/`perSeat${suffix}` — langsung baca `pricing.price` |

Semua route admin di atas ikut menutup Gap #5 (error handling polos) sebagai efek samping rewrite — pola sama seperti Hotel §10/§11.

### 9.6 Booking Creation — Menutup Gap #4 (KRITIS)

Pola identik penutupan Gap #1 Hotel (`docs/arsitektur-hotel.md` §8, §10.5):

- `lib/validators/booking.ts` — `transportSelectionSchema` (nested di `transports[]`) kehilangan field `unitPrice`, `totalPrice`, `isCharter`. Sisa: `transportQuotaId`, `numPassengers`, `pickupDetail?`, `dropoffDetail?`.
- `app/api/v1/bookings/route.ts` — di dalam `$transaction()`, sebelum `reserveTransportQuota()`, fetch `tx.transportQuota.findUniqueOrThrow({ where:{id}, include:{ pricing:true } })`, pakai `quota.pricing.price` sebagai `unitPrice`, `totalPrice = unitPrice` (flat, lihat §9.2) — client tidak lagi bisa mengirim harga sendiri.

### 9.7 Admin UI (rencana)

- `products/transport/page.tsx` Tab "Trip & Harga": form tambah trip — ganti 2 input hint (`originHint`/`destinationHint`) jadi 2 input wajib (`origin`/`destination`), mirip form `FlightRoute`.
- `products/transport/trips/[id]/page.tsx`: pricing builder per kendaraan disederhanakan drastis — ganti 6 input harga (charter×3 + perSeat×3) + toggle jadi 1 baris per kendaraan: badge status HPP (ada/belum) + tombol buka panel cost editor (vendor + currency + harga kendaraan + preview live HPP/harga jual via endpoint simulate), pola sama panel cost Flight di halaman edit schedule.

### 9.8 Publik & Wizard (rencana)

- `app/[locale]/(public)/transport/page.tsx`: hapus tampilan dual harga (charter/per-kursi), tampilkan 1 harga per kartu kendaraan; hapus indikator season aktif (tidak relevan lagi).
- `app/[locale]/(pilgrim)/bookings/new/transport/page.tsx`: hapus 2 tombol (`selectCharter`/`selectPerSeat`) jadi 1 tombol "Pilih" per kendaraan; hapus logika `isCharter`/`perSeatEnabled`; `numPassengers` tetap terisi `draft.totalPilgrims` (dipakai validasi kuota kursi, lihat §9.2), `totalPrice = unitPrice` flat (bukan dikali `totalPilgrims`).
- `lib/booking/draft.ts` — `TransportSelection`: hapus `isCharter`; ganti `originHint`/`destinationHint: string | null` jadi `origin`/`destination: string` (selalu terisi, tidak nullable lagi).
- `payment/page.tsx` (ringkasan sebelum bayar): hapus badge "Charter"/"Per Kursi".

### 9.9 Blast Radius (grep sebelum eksekusi, 2026-07-19)

```
charterRegular/Ramadan/Hajj, perSeatRegular/Ramadan/Hajj, charterPrice, perSeatPrice, perSeatEnabled:
  app/[locale]/admin/(protected)/products/transport/trips/[id]/page.tsx
  app/[locale]/(pilgrim)/bookings/new/transport/page.tsx
  app/[locale]/(public)/transport/page.tsx
  app/api/v1/catalog/transport/route.ts
  app/api/v1/admin/products/transport/pricing/route.ts
  app/api/v1/admin/products/transport/pricing/[id]/route.ts

isCharter:
  app/[locale]/(pilgrim)/bookings/new/transport/page.tsx
  app/[locale]/(pilgrim)/bookings/new/payment/page.tsx
  app/api/v1/bookings/route.ts
  lib/booking/draft.ts
  lib/validators/booking.ts

originHint / destinationHint:
  app/[locale]/admin/(protected)/products/transport/page.tsx
  app/[locale]/admin/(protected)/products/transport/trips/[id]/page.tsx
  app/[locale]/(pilgrim)/bookings/new/transport/page.tsx
  app/[locale]/(public)/transport/page.tsx
  app/api/v1/catalog/transport/route.ts
  app/api/v1/admin/products/transport/trips/route.ts
  app/api/v1/admin/products/transport/trips/[id]/route.ts
  lib/booking/draft.ts
```

Total ~11 file unik kena dampak (irisan cukup besar antar 3 daftar di atas). Skala sebanding Hotel §10 (bukan §11) — refactor total pada modul existing dengan HPP baru + penyederhanaan struktur sekaligus, jadi realistis dieksekusi sebagai **satu pass berkelanjutan sampai `bun run build` hijau** (dengan deviasi Fase Eksekusi SOP yang sama seperti Hotel §10, didokumentasikan di `docs/decisions.md`), bukan dipaksa berhenti di tiap file.

`TransportQuota` dan `lib/quota/index.ts` (`reserve/confirm/releaseTransportQuota`) **tidak masuk blast radius** — tidak direferensikan oleh field yang dihapus, dan tidak ada alasan bisnis untuk mengubahnya (lihat §9.3).

### 9.10 Fase Eksekusi — SELESAI & TERVERIFIKASI (2026-07-19)

1. **Fase 0 — Schema + migrasi** ✓ — §9.3 diterapkan, migrasi non-interaktif dengan shadow DB terverifikasi terpisah (`saudinesia_shadow`, dicek `if [ "$REAL" = "$SHADOW" ]` sebelum dipakai). Field lama (`originHint`, `destinationHint`, `perSeatEnabled`, `charterRegular/Ramadan/Hajj`, `perSeatRegular/Ramadan/Hajj` di `TransportPricing`; `isCharter` di `BookingTransport`) **dihapus**. Migrasi `20260719163317_transport_route_vehicle_pricing` — backfill `origin`/`destination` dari hint lama (2 trip City Tour tanpa hint diisi manual), `price` di-backfill dari `charterRegular` lama supaya katalog tidak kosong selama transisi. Row count semua tabel diverifikasi sama persis sebelum/sesudah (0 booking nyata terdampak — `bookings`/`booking_transports` = 0 baris).
2. **Fase 1** ✓ — `lib/pricing/refreshTransportPricingCache.ts` (pola identik Flight) + didaftarkan ke cron kurs (`lib/cron/exchangeRateJob.ts`).
3. **Fase 2** ✓ — `trips/route.ts`+`trips/[id]/route.ts` (origin/destination wajib + error handling proper), `pricing/route.ts` (create placeholder price:0), `pricing/[id]/cost/route.ts` (baru, pola identik Flight cost), `simulate/route.ts` (baru), `catalog/transport/route.ts` (hapus season logic, langsung `pricing.price`). `vehicles/route.ts`+`vehicles/[id]/route.ts` ikut dirapikan error handling-nya (Gap #5).
4. **Fase 3** ✓ — `lib/validators/booking.ts` (`unitPrice`/`totalPrice`/`isCharter` dihapus dari schema), `app/api/v1/bookings/route.ts` (fetch `TransportQuota.pricing.price` server-side di dalam `$transaction()`, `totalPrice = unitPrice` flat).
5. **Fase 4** ✓ — form trip (origin/destination wajib menggantikan hint opsional), pricing builder per kendaraan diganti total jadi cost editor (vendor quick-add category `'transport'` + currency + harga + preview live HPP/harga jual).
6. **Fase 5** ✓ — katalog publik (`(public)/transport/page.tsx`), wizard (`bookings/new/transport/page.tsx` — 1 tombol per kendaraan menggantikan 2 tombol charter/per-kursi), `lib/booking/draft.ts` (`TransportSelection` type), ringkasan payment (`bookings/new/payment/page.tsx`).
7. **Fase 6** ✓ — `bun run build` 0 error. Verifikasi browser end-to-end: admin cost editor (quick-add vendor "Syarikah Al-Rajhi Transport", kategori `transport`, harga IDR 5.000.000 → HPP Rp 5.000.000 tanpa konversi kurs karena IDR, Harga Jual Rp 6.000.000 margin 20% dibulatkan) → `TransportPricing.price` ter-update di DB → katalog publik `/transport` langsung menampilkan Rp 6.000.000. Script test Gap #4 (`verify_gap4_tmp.ts`, dijalankan lalu dihapus): simulasi client kirim `unitPrice:1` pada quota dengan `TransportPricing.price` asli Rp 4.500.000 — harga yang dipakai server tetap Rp 4.500.000, membuktikan server sepenuhnya mengabaikan harga client.

Deviasi Fase Eksekusi SOP diterapkan (sama seperti Hotel §10): Fase 0-5 dieksekusi sebagai satu rangkaian berkelanjutan tanpa `bun run build` hijau di tiap fase individual, karena refactor pada modul existing dengan konsumen berantai (schema → API → UI admin → UI publik → wizard → booking creation) membuat stub/redo paksa per-fase tidak realistis. Verifikasi end-to-end menyeluruh dilakukan di Fase 6, konsisten dengan tujuan asli SOP (verifikasi sebelum lanjut, bukan menumpuk perubahan tak-terverifikasi).
