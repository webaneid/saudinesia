# Arsitektur — Modul Hotel

> **Status: §1-9 ARSIP — AUDIT AS-BUILT (2026-07-19, kondisi SEBELUM refactor) — §10 & §11 SELESAI & TERVERIFIKASI (2026-07-19, refactor total sudah dieksekusi 2x berurutan).** §1-9 di bawah mendokumentasikan kondisi kode SAAT AUDIT DITULIS — **sudah tidak akurat lagi buat kode aktual**, dipertahankan sebagai arsip historis ("sebelum vs sesudah"), JANGAN dijadikan referensi struktur terkini. §10 (skema `RoomType`+`HotelRoomSchedule` menggantikan `HotelRoom`+`HotelQuota`, terintegrasi arsitektur harga universal, Gap #1 KRITIS & #2 tertutup) lalu §11 (periode jadi entitas `HotelPricePeriod` terpisah, admin bisa isi banyak tipe kamar sekaligus per periode — ditemukan lewat pemakaian nyata user, rate sheet vendor selalu berbentuk matriks periode×tipe kamar) adalah source of truth AKTUAL sekarang. **Baca §11 dulu, rujuk §10 untuk konteks integrasi harga yang tidak berubah** — §1-9 cuma relevan sebagai referensi historis dan daftar gap yang jadi alasan refactor dikerjakan. §8 Gap #3 (`HotelService` tanpa jalur admin) **DITUTUP 2026-07-20** — lihat catatan di §8 dan `docs/decisions.md` untuk detail.

---

## 1. Konteks Bisnis

Hotel adalah salah satu komponen utama trip Umroh/Haji — jamaah menginap di Makkah (dekat Masjidil Haram) dan opsional di Madinah (dekat Masjid Nabawi). Modul ini menangani: katalog hotel per kota, tipe kamar dengan kapasitas & harga, kuota kamar per periode tanggal, dan pemilihan hotel di wizard booking.

**Karakteristik bisnis:**
- **Harga per kamar bervariasi menurut musim** — Regular, Ramadan, Haji (3 musim tetap, dideteksi otomatis dari tanggal lewat `lib/utils/season.ts` `detectSeason()`) — bukan per rentang tanggal bebas seperti kuota Flight, dan bukan per komponen HPP+kurs+margin seperti Visa/Flight. Housing ini **satu-satunya pola harga di antara 3 pola yang sekarang hidup berdampingan di codebase**: (a) HPP+kurs+margin (Visa, Flight — `docs/arsitektur-harga.md`), (b) manual per-musim tanpa vendor (Hotel, Transport), (c) manual flat tanpa musim (belum ada contoh, Katering/Tour kemungkinan begini — di luar scope audit ini).
- **Kuota per periode tanggal, per tipe kamar** — mirip pola `FlightSchedule` (kuota melekat ke rentang tanggal, bukan tanggal individual), beda dari `TransportQuota` (per tanggal spesifik). Satu `HotelRoom` bisa punya banyak `HotelQuota` (periode berbeda-beda), tapi TIDAK ada constraint yang mencegah periode-periode itu tumpang tindih (lihat §8).
- **Tidak terhubung ke `Vendor`** — beda dari Visa (syarikah) dan Flight (maskapai) yang sudah pakai `Vendor`/`ProductCost`/`computeSellPrice()` (`docs/arsitektur-harga.md`), Hotel tidak punya konsep "vendor/operator" sama sekali di level data — harga diketik admin langsung per kamar per musim, tanpa jejak "dari mana asal biaya ini" atau margin eksplisit.

---

## 2. Skema Data Aktual (Prisma)

### 2.1 `Hotel` (`prisma/schema.prisma:71-85`)

```prisma
model Hotel {
  id               String  @id @default(uuid())
  name             String
  city             String   // free text — TAPI lihat §8, katalog publik hardcode filter ke 'makkah'/'madinah' saja
  stars            Int?
  distanceToHaramM Int?
  description      String?
  images           Json    @default("[]")  // array of MinIO object keys, sama pola produk lain
  isActive         Boolean @default(true)

  rooms    HotelRoom[]
  services HotelService[]

  @@map("hotels")
}
```

### 2.2 `HotelRoom` (`prisma/schema.prisma:87-102`)

```prisma
model HotelRoom {
  id           String  @id @default(uuid())
  hotelId      String
  roomType     String   // free text, tapi UI cuma tawarkan 4 opsi tetap: single/double/triple/quad
  capacity     Int
  amenities    Json    @default("[]")  // field ADA di schema, TIDAK PERNAH diisi/ditampilkan di manapun (lihat §8)
  priceRegular Decimal @db.Decimal(12, 2)
  priceRamadan Decimal @db.Decimal(12, 2)
  priceHajj    Decimal @db.Decimal(12, 2)

  hotel         Hotel          @relation(fields: [hotelId], references: [id], onDelete: Cascade)
  quotas        HotelQuota[]
  bookingHotels BookingHotel[]

  @@map("hotel_rooms")
}
```

**3 kolom harga flat, diketik admin langsung** — bukan `Decimal` hasil kalkulasi, bukan cache dari fungsi manapun. Tidak ada `Vendor`, tidak ada `ProductCost`, tidak ada margin eksplisit tercatat di data (margin implisit ada di kepala admin saat mengetik angka).

### 2.3 `HotelQuota` (`prisma/schema.prisma:104-117`)

```prisma
model HotelQuota {
  id           String   @id @default(uuid())
  hotelRoomId  String
  periodStart  DateTime @db.Date
  periodEnd    DateTime @db.Date
  totalQuota   Int
  pendingQuota Int      @default(0)
  bookedQuota  Int      @default(0)

  hotelRoom     HotelRoom      @relation(fields: [hotelRoomId], references: [id], onDelete: Cascade)
  bookingHotels BookingHotel[]

  @@map("hotel_quotas")
}
```

Pola sama `FlightSchedule` (kuota per rentang periode, bukan per tanggal individual) — **tapi tidak ada `@@unique`/constraint apa pun** yang mencegah 2 baris `HotelQuota` untuk `hotelRoomId` yang sama punya `periodStart`/`periodEnd` yang tumpang tindih. Lihat §8 soal dampaknya ke resolusi kuota di halaman detail publik.

### 2.4 `HotelService` (`prisma/schema.prisma:119-132`)

```prisma
model HotelService {
  id          String  @id @default(uuid())
  hotelId     String
  serviceName String
  serviceType String?
  price       Decimal @db.Decimal(12, 2)
  description String?
  isActive    Boolean @default(true)

  hotel           Hotel            @relation(fields: [hotelId], references: [id], onDelete: Cascade)
  bookingServices BookingService[]

  @@map("hotel_services")
}
```

**Model ini schema-nya lengkap, tapi TIDAK PERNAH BISA DIISI** — lihat §8, temuan penting.

### 2.5 `BookingHotel` (snapshot saat booking, `prisma/schema.prisma:559-577`)

```prisma
model BookingHotel {
  id            String   @id @default(uuid())
  bookingId     String
  hotelQuotaId  String
  hotelRoomId   String
  checkIn       DateTime @db.Date
  checkOut      DateTime @db.Date
  nights        Int
  numRooms      Int      @default(1)
  numGuests     Int
  pricePerNight Decimal  @db.Decimal(12, 2)   // snapshot — TAPI lihat §8, nilainya dipercaya mentah dari client
  totalPrice    Decimal  @db.Decimal(14, 2)

  booking    Booking    @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  hotelQuota HotelQuota @relation(fields: [hotelQuotaId], references: [id])
  hotelRoom  HotelRoom  @relation(fields: [hotelRoomId], references: [id])

  @@map("booking_hotels")
}
```

### 2.6 `BookingService` (`prisma/schema.prisma:643-655`)

```prisma
model BookingService {
  id             String    @id @default(uuid())
  bookingId      String
  hotelServiceId String
  serviceDate    DateTime? @db.Date
  quantity       Int       @default(1)
  totalPrice     Decimal   @db.Decimal(14, 2)

  booking      Booking      @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  hotelService HotelService @relation(fields: [hotelServiceId], references: [id])

  @@map("booking_services")
}
```

Konsisten dengan §2.4 — model booking ini juga tidak pernah punya jalur pembuatan record nyata (tidak ada UI/API yang membuat `HotelService`, jadi tidak akan pernah ada `BookingService` juga).

---

## 3. Kuota (`lib/quota/index.ts:6-31`)

```typescript
export async function reserveHotelQuota(tx: Tx, hotelQuotaId: string, rooms: number): Promise<void> {
  const quota = await tx.hotelQuota.findUniqueOrThrow({ where: { id: hotelQuotaId }, select: {...} })
  const available = quota.totalQuota - quota.pendingQuota - quota.bookedQuota
  if (available < rooms) throw new Error(`Hotel quota insufficient: need ${rooms}, have ${available}`)
  await tx.hotelQuota.update({ where: { id: hotelQuotaId }, data: { pendingQuota: { increment: rooms } } })
}
export async function confirmHotelQuota(tx: Tx, hotelQuotaId: string, rooms: number): Promise<void> { ... }
export async function releaseHotelQuota(tx: Tx, hotelQuotaId: string, rooms: number): Promise<void> { ... }
```

Ketiga fungsi **ada dan benar** (beda dari kasus `confirmMuthowifQuota()` yang memang tidak pernah dibuat). Dipanggil dari:
- `reserveHotelQuota` → `app/api/v1/bookings/route.ts:55,58` (saat booking dibuat)
- `confirmHotelQuota` → `app/api/v1/admin/payments/[id]/confirm/route.ts:32` (saat admin konfirmasi pembayaran)
- `releaseHotelQuota` → `lib/cron/autocancelJob.ts:27` (cron auto-cancel booking yang tidak dibayar)

**Tidak dipanggil dari mana pun untuk self-cancel jamaah** — ini bukan temuan baru, sudah tercatat sebagai Gap #2 di `docs/arsitektur-umroh.md` §7 ("self-cancel jamaah tidak pernah melepas kuota hotel/transport/muthowif — kuota bocor permanen"), cross-cutting booking-core, bukan spesifik Hotel — dicatat ulang di sini cuma sebagai referensi silang, perbaikannya ada di scope dokumen itu.

---

## 4. API Routes (aktual, terverifikasi per file)

| Method | Path | Auth | Validasi | Catatan |
|---|---|---|---|---|
| GET | `admin/products/hotels/route.ts` | `requireManager()` | — | List hotel + `_count.rooms` |
| POST | `admin/products/hotels/route.ts` | `requireManager()` | **Tidak ada Zod**, akses `body.x` langsung | Create hotel |
| GET | `admin/products/hotels/[id]/route.ts` | `requireManager()` | — | Detail hotel + rooms |
| PUT | `admin/products/hotels/[id]/route.ts` | `requireManager()` | **Tidak ada Zod, `data: body` mentah** | Lihat §8 — mass-assignment |
| POST | `admin/products/hotels/[id]/rooms/route.ts` | `requireManager()` | **Tidak ada Zod** | Create room — **tidak ada PUT/DELETE** |
| POST | `admin/products/hotels/[id]/quotas/route.ts` | `requireManager()` | **Tidak ada Zod**, `[id]` URL tidak dipakai validasi | Create quota — **tidak ada PUT/DELETE** |
| GET/POST/DELETE | `admin/products/hotels/[id]/images/route.ts` | `requireManager()` | MIME + size manual (bukan Zod, tapi ada) | Paling rapi di antara semua route Hotel — 404 checks, error message jelas |
| GET | `catalog/hotels/route.ts` | publik | **Zod lengkap** (`querySchema`) | Satu-satunya route Hotel dengan validasi + error handling proper (differentiated try/catch, `console.error`) |

**Semua route admin (kecuali `images`) pakai pola `catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }`** — collapse semua error (termasuk error database/500 asli) jadi 403, tanpa `console.error`. Pola persis yang sudah ditemukan & ditutup di Visa (`docs/arsitektur-visa.md` §7 Gap #6, 2026-07-18) — di Hotel belum pernah disentuh.

---

## 5. Season Pricing

Bukan fungsi terpisah — logic-nya inline di tiap konsumen, bukan helper bersama:

```typescript
const priceKey = `price${season.charAt(0).toUpperCase() + season.slice(1)}` as
  'priceRegular' | 'priceRamadan' | 'priceHajj'
```

Pola string-templating ini **diulang persis sama di 3 tempat berbeda** — `app/api/v1/catalog/hotels/route.ts:39-40`, `app/[locale]/(public)/hotels/page.tsx:34-35`, `app/[locale]/(public)/hotels/[id]/page.tsx:32-33` — bukan diekstrak jadi satu helper `getSeasonPrice(room, season)`. Sama pola string-templating juga dipakai `docs/arsitektur-transportasi.md` (`charter${suffix}`) — jadi ini konvensi yang sudah dipakai lintas modul, bukan kesalahan unik Hotel, tapi tetap terduplikasi 3x di modul ini sendiri.

`detectSeason()` (`lib/utils/season.ts`) dipanggil dengan tanggal yang beda-beda tergantung konteks: `catalog/hotels` pakai `checkIn` dari query param (kalau ada), 2 halaman publik pakai `new Date()` (hari ini, bukan tanggal check-in yang dicari user) — jadi harga yang tampil di listing/detail hotel publik adalah harga musim **hari ini**, bukan musim saat tanggal menginap yang sebenarnya. Beda dari halaman wizard (`bookings/new/hotel/page.tsx`) yang benar memakai `draft.departureDate`/`draft.returnDate` lewat `catalog/hotels` API. Jadi harga yang dilihat calon pemesan di halaman katalog publik **bisa beda** dari harga yang akhirnya dia dapat di wizard kalau musim berubah di antara keduanya (mis. lihat katalog bulan reguler, booking untuk tanggal Ramadan).

---

## 6. Admin UI

**`app/[locale]/admin/(protected)/products/hotels/page.tsx`** — listing (tabel: Nama/Kota/Jarak/Kamar/Status) + form inline "Tambah Hotel" (nama/kota/bintang/jarak/deskripsi, tanpa harga — harga diisi di halaman edit). Redirect ke halaman edit setelah simpan (pola "Simpan & Lanjut" sama seperti Flight).

**`app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx`** — halaman edit: `ProductMediaGallery` (upload foto), section "Tipe Kamar" (form tambah tipe + 3 input harga musim), per tipe kamar ada form "Set Quota Kamar" (periode + total kamar). **Tidak ada UI untuk**: edit/hapus tipe kamar yang sudah ada, lihat daftar kuota yang sudah di-set sebelumnya (form quota selalu kosong, tidak menampilkan riwayat), kelola `HotelService`.

Href navigasi di kedua halaman **hardcode locale `"id"`** (`href="/id/admin/products/hotels"`) — bukan `${locale}` dinamis seperti pola Flight/Visa.

---

## 7. Katalog Publik & Wizard

- **`app/[locale]/(public)/hotels/page.tsx`** — grid kartu (filter kota/bintang via query string, `Link` bukan client-state), cover photo presigned URL, harga "mulai dari" berdasar `rooms[0]` yang di-`orderBy: priceRegular asc` (lihat §8 soal mismatch season).
- **`app/[locale]/(public)/hotels/[id]/page.tsx`** — detail: galeri foto adaptif (1/2/3+ foto beda layout), tipe kamar + badge ketersediaan, section "Layanan Hotel" (selalu kosong, lihat §8).
- **Wizard** (`app/[locale]/(pilgrim)/bookings/new/hotel/page.tsx`) — step terpisah (bukan lewat komponen `HotelPicker.tsx`, lihat §8), fetch `catalog/hotels` dengan tanggal draft booking yang benar, pilih hotel Makkah (wajib) + Madinah (opsional), per hotel pilih tipe kamar, expand/collapse card, sinkron ke `useDraft()` real-time buat `PriceSidebar`.
- **Validator** (`lib/validators/booking.ts:4-12`): `hotelSelectionSchema` — `hotelRoomId`, `hotelQuotaId`, `checkIn`, `checkOut`, `nights`, `numRooms`, **`pricePerNight: z.number().positive()`** — lihat §8, ini yang jadi temuan paling serius.

---

## 8. Gap / Ketidaksesuaian Aktif (per audit 2026-07-19)

Diurutkan dari yang paling serius.

### Gap #1 — 🔴 KRITIS: Harga booking hotel dipercaya mentah dari client, tidak pernah di-re-validasi server

**Lokasi:** `app/api/v1/bookings/route.ts:86-106`, `lib/validators/booking.ts:4-12`.

`hotelSelectionSchema` menerima `pricePerNight` sebagai input dari body request wizard — lalu langsung dipakai apa adanya untuk `BookingHotel.pricePerNight`/`totalPrice`:

```typescript
// app/api/v1/bookings/route.ts
if (data.hotelMakkah) {
  const h = data.hotelMakkah
  // ...
  pricePerNight: h.pricePerNight,                    // ← dari client, TIDAK di-cross-check
  totalPrice: h.pricePerNight * h.nights * h.numRooms, // ← dihitung dari angka client
}
```

Server **tidak pernah** query ulang `HotelRoom.priceRegular/Ramadan/Hajj` untuk memverifikasi `pricePerNight` yang dikirim client cocok dengan harga aktual di database pada musim yang berlaku. Secara teknis, pengguna yang memodifikasi request (lewat DevTools/proxy, bukan lewat UI wizard normal) bisa mengirim `pricePerNight` berapa pun (mis. Rp 1) dan server akan menyimpannya sebagai harga final booking. **Ini bukan cuma soal konsistensi data — ini celah harga bisa dimanipulasi.**

Pola yang sama (`unitPrice: z.number().positive()`) juga ada di `transportSelectionSchema` — kemungkinan besar bug sistemik booking-core, bukan unik Hotel, tapi di luar scope audit ini untuk dikonfirmasi tuntas ke Transport. Dicatat di sini karena berdampak langsung ke `BookingHotel`.

**Beda dari pola Visa/Flight:** modul-modul yang sudah pakai arsitektur harga (`computeSellPrice()`) TIDAK exposed ke masalah ini, karena harga jual selalu dihitung ulang server-side dari `ProductCost`, tidak pernah dipercaya dari input client. Hotel (dan Transport) belum punya proteksi setara ini.

### Gap #2 — 🔴 `PUT /api/v1/admin/products/hotels/[id]` menerima body mentah tanpa validasi (mass-assignment)

**Lokasi:** `app/api/v1/admin/products/hotels/[id]/route.ts:15-23`.

```typescript
const body = await req.json()
const hotel = await prisma.hotel.update({ where: { id }, data: body })
```

Tidak ada Zod, tidak ada field allowlist — field apa pun yang dikirim client (termasuk field yang seharusnya tidak boleh diubah lewat endpoint ini) akan diteruskan mentah ke Prisma. Saat ini dampaknya terbatas (`Hotel` cuma punya field sederhana, tidak ada relasi yang bisa di-nested-write lewat body JSON biasa), tapi ini pola yang salah dari sisi prinsip — beda dari semua endpoint Visa/Flight yang sudah pakai `updateSchema.safeParse()` dengan field eksplisit.

### ~~Gap #3~~ — DITUTUP 2026-07-20: `HotelService`/"Layanan Hotel" sekarang punya jalur admin lengkap

~~Public detail page (`app/[locale]/(public)/hotels/[id]/page.tsx:161-177`) query & render `hotel.services`, tapi **tidak ada API route dan tidak ada admin UI** untuk membuat `HotelService`.~~ Ditutup: `app/api/v1/admin/products/hotels/[id]/services/route.ts` (GET/POST) + `[serviceId]/route.ts` (PUT/DELETE, soft-delete via `isActive` kalau sudah pernah dipakai booking) ditambahkan, plus section "Layanan Hotel" (CRUD lengkap: nama, tipe, harga, deskripsi, toggle aktif) di halaman edit hotel admin (`app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx`). Section publik sekarang bisa benar-benar terisi. Catatan: integrasi ke wizard booking (`BookingService`, model sudah ada di schema tapi tidak pernah dipakai kode manapun) **tetap di luar scope** — hanya jalur admin-mengisi-data yang diminta, bukan alur beli layanan ini saat booking.

### Gap #4 — 🟡 Tipe kamar & kuota: create-only, tidak ada edit/delete

Tidak ada `PUT`/`DELETE` untuk `HotelRoom` maupun `HotelQuota`. Begitu tipe kamar dibuat (termasuk salah ketik harga/kapasitas) atau kuota periode di-set, satu-satunya cara memperbaikinya adalah akses database langsung — tidak ada jalur admin normal. Form "Set Quota Kamar" di halaman edit juga tidak menampilkan kuota yang sudah ada sebelumnya (form selalu kosong), jadi admin tidak punya visibilitas periode mana saja yang sudah punya kuota — berisiko membuat periode tumpang tindih tanpa sadar (tidak ada constraint DB yang mencegah ini juga, lihat §2.3).

### Gap #5 — 🟡 `HotelPicker.tsx` adalah dead code

**Lokasi:** `components/booking/HotelPicker.tsx` — isinya cuma `export function HotelPicker() { return null }`, tidak diimpor di mana pun. Logic hotel-picking nyata ada inline di `app/[locale]/(pilgrim)/bookings/new/hotel/page.tsx` (halaman step wizard tersendiri, bukan komponen ini). Pola yang identik dengan `MuthowifPicker.tsx` yang sudah tercatat sebagai dead code di `docs/arsitektur-muthowif.md` §7 — cuma belum pernah dibersihkan.

### Gap #6 — 🟡 Semua route admin (kecuali `images`) collapse semua error ke 403

Sama pola dengan Visa Gap #6 (sudah ditutup di sana 2026-07-18) — `catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }` polos, tanpa membedakan `Unauthorized`/`Forbidden` asli dari error lain (mis. Prisma constraint violation), dan tanpa `console.error` — kalau ada bug 500 di endpoint Hotel, log server tidak akan pernah mencatatnya, cuma terlihat sebagai "403 Forbidden" yang membingungkan buat debug.

### Gap #7 — 🟢 Ketidakkonsistenan resolusi musim & kuota antar halaman publik

- Katalog publik (`page.tsx`, `[id]/page.tsx`) pakai `detectSeason(new Date())` — harga musim **hari ini**, bukan musim tanggal check-in yang relevan buat pemesan. Wizard (yang query lewat `catalog/hotels` API dengan `check_in`/`check_out` dari draft booking) sudah benar. Jadi ada potensi harga yang dilihat di katalog beda dari harga final di wizard kalau musim berubah.
- `[id]/page.tsx` (detail) resolve kuota lewat `quotas: { orderBy: periodStart desc, take: 1 }` — ambil periode TERBARU tanpa cek apakah hari ini benar-benar jatuh di periode itu. `catalog/hotels/route.ts` sudah benar (filter `periodStart <= checkIn && periodEnd >= checkOut`). Kalau ada hotel dengan multiple periode kuota, halaman detail bisa menampilkan status ketersediaan dari periode yang salah.
- Listing publik (`page.tsx`) urutkan "kamar termurah" pakai `orderBy: { priceRegular: 'asc' }` — bukan berdasar `priceKey` musim aktif. Kalau musim aktif bukan Regular, kamar yang ditandai "termurah" bisa saja bukan yang benar-benar termurah di musim itu.

### Gap #8 — 🟢 Filter kota katalog publik hardcode 2 nilai, schema `Hotel.city` bebas teks

`catalog/hotels` `querySchema.city: z.enum(['makkah', 'madinah'])` — tapi `Hotel.city` di Prisma adalah `String` bebas. Kalau nanti ada hotel di kota lain (mis. Jeddah buat transit), filter publik tidak akan pernah bisa menargetkannya secara eksplisit (hotelnya tetap muncul di listing tanpa filter, cuma tidak bisa di-filter per kota itu).

### Gap #9 — 🟢 (Referensi silang, bukan temuan baru) Self-cancel tidak melepas kuota hotel

Sudah tercatat di `docs/arsitektur-umroh.md` §7 Gap #2 — cross-cutting booking-core, bukan spesifik Hotel. Dicatat di sini cuma sebagai pointer, perbaikan ada di scope dokumen itu.

### Ringkasan status "harga terhubung ke arsitektur HPP universal?"

**Tidak.** Ini bukan gap dalam arti "sesuatu yang rusak", tapi status faktual: Hotel dibangun sebelum `docs/arsitektur-harga.md` ada, jadi masih pakai pola manual 3-harga-per-musim tanpa `Vendor`/`ProductCost`/`computeSellPrice()`. Kalau mau disatukan dengan pola Visa/Flight, itu perlu rencana migrasi tersendiri (skema baru, keputusan bagaimana "3 harga per musim" dipetakan ke `costTiers`, keputusan `Vendor.category` misalnya `'hotel_operator'` — field `category` sudah didesain generik untuk ini di `docs/arsitektur-harga.md` §18) — **belum ditulis rencananya, menunggu arahan setelah dokumen ini dibaca.**

---

## 9. Referensi Silang

- `docs/arsitektur-harga.md` §18 — field `Vendor.category` sudah didesain generik, disebutkan eksplisit siap dipakai Hotel nanti tanpa migrasi skema ulang
- `docs/arsitektur-tiket-pesawat.md` — preseden modul yang dibangun langsung di atas arsitektur harga universal sejak awal (kontras dengan Hotel yang dibangun sebelum arsitektur itu ada)
- `docs/arsitektur-muthowif.md` §7 — preseden dead code komponen picker (`MuthowifPicker.tsx`), pola sama `HotelPicker.tsx` (Gap #5 di atas)
- `docs/arsitektur-visa.md` §7 Gap #6 (DITUTUP 2026-07-18) — preseden perbaikan pola error-handling `catch{...403}` polos, belum diterapkan ke Hotel (Gap #6 di atas)
- `docs/arsitektur-umroh.md` §7 Gap #2 — self-cancel tidak melepas kuota hotel/transport/muthowif (Gap #9 di atas, cross-cutting)
- `docs/arsitektur-transportasi.md` — modul dengan pola harga manual per-musim yang sama (belum diintegrasikan ke arsitektur harga universal juga), dan kemungkinan berbagi Gap #1 (`unitPrice` client-trusted) — perlu audit terpisah untuk konfirmasi
- `docs/architecture.md` — desain awal skema Hotel (`CREATE TABLE hotels/hotel_rooms/hotel_quotas/hotel_services`), sekarang **digantikan dokumen ini** sebagai source of truth untuk modul Hotel

---

## 10. Refactor Total ke Arsitektur Harga Universal (2026-07-19)

> **Status: SELESAI & TERVERIFIKASI.** Ditulis mengikuti Fase Eksekusi SOP `CLAUDE.md` poin 1, setelah 4 keputusan struktural dikonfirmasi eksplisit lewat `AskUserQuestion` (§10.1). Data lama (`HotelRoom`/`HotelQuota` — 20 kamar + 20 kuota) **sengaja tidak dipertahankan/dimigrasikan** — user eksplisit konfirmasi "belum masuk tahap produksi, semua hal boleh diubah"; dikonfirmasi aman dihapus karena `booking_hotels: 0` (tidak ada booking nyata yang mereferensikannya) sebelum migrasi dijalankan. **Deviasi dari rencana fase tertulis di §10.8 — dicatat eksplisit, lihat `docs/decisions.md` 2026-07-19 "Deviasi Fase Eksekusi".**

### 10.1 Keputusan Struktural (dikonfirmasi user, 2026-07-19)

1. **Vendor Hotel = pihak ketiga terpisah**, dipilih manual per jadwal kamar — persis pola Maskapai Flight. `Vendor.category: 'hotel'` (field generik yang sudah ada sejak `docs/arsitektur-harga.md` §18, tidak butuh migrasi skema lagi). **Bukan** representasi hotel itu sendiri — satu hotel bisa saja pakai vendor manapun yang admin pilih, tidak otomatis 1:1.
2. **3 musim tetap (Regular/Ramadan/Hajj) dihapus total**, diganti satu entitas "Jadwal Kamar" per (hotel × tipe kamar × periode tanggal bebas) yang menyatukan kuota + HPP + harga cache dalam satu baris — persis pola `FlightSchedule`. Alasan bisnis dari user: data hotel riil yang dipegang tidak mengikuti pembagian reguler/ramadan/haji, melainkan periode per bulan bebas sesuai kontrak dengan hotel/vendor.
3. **Fasilitas hotel di level Hotel saja** (bukan per tipe kamar) — daftar fasilitas di-hardcode sebagai konstanta TypeScript (checkbox di UI), bukan tabel database terpisah — konsisten pola `CURRENCIES`/`COMMON_DOC_TYPES` yang sudah dipakai di codebase ini untuk daftar opsi tetap.
4. **`computeSellPrice()` digeneralisasi sekarang** — override harga jual manual (`docs/arsitektur-harga.md` §15) dipindah dari hardcode `costComponent === 'individu'` jadi mencari tier `sellPriceOverride` di komponen manapun yang preferred untuk produk itu. **Berlaku juga untuk Visa & Flight** (fungsi dipakai bersama) — dikerjakan di Fase 0, diverifikasi regresi ke Visa (yang sudah punya data override nyata) SEBELUM lanjut ke skema Hotel, supaya kalau ada masalah, terisolasi dan gampang di-revert tanpa menyentuh Hotel sama sekali.

**Requirement fitur dari user (verbatim, diterjemahkan jadi skema di §10.2-10.4):**
1. Featured photo — foto sampul eksplisit, bukan cuma `images[0]` implisit
2. Nama Hotel — tetap
3. Kota Hotel (Madinah/Makkah) — tetap
4. Jarak ke Haram — tetap
5. Fasilitas hotel (checkbox: WiFi, sarapan, dll — lihat §10.2 daftar lengkap)
6. Harga — HARUS lewat komponen harga universal (`Vendor`/`ProductCost`/`computeSellPrice()`), punya periode tanggal, tergantung tipe kamar (minimal Single/Double/Triple/Quad/Quint — di-seed langsung, admin tinggal pilih, bisa ditambah tipe baru), tiap harga per tipe kamar per periode punya HPP sendiri

### 10.2 Skema Baru

**`RoomType`** (baru — master data tipe kamar, di-seed, extensible admin):

```prisma
model RoomType {
  id              String   @id @default(uuid())
  name            String   @unique   // "Single", "Double", "Triple", "Quad", "Quint" — bebas teks, admin bisa tambah lewat quick-add
  defaultCapacity Int                // dipakai validasi numGuests di wizard, bukan dipaksa (informasional)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  schedules HotelRoomSchedule[]

  @@map("room_types")
}
```

Seed awal (`prisma/seed.ts`): `Single` (1), `Double` (2), `Triple` (3), `Quad` (4), `Quint` (5) — `upsert` by `name` supaya idempoten kalau seed dijalankan ulang.

**`Hotel`** (diubah — tambah `featuredImageKey`, `facilities`; `rooms`/`services` relation diganti):

```prisma
model Hotel {
  id               String   @id @default(uuid())
  name             String
  city             String
  stars            Int?
  distanceToHaramM Int?
  description      String?
  images           Json     @default("[]")   // galeri — MinIO keys, TIDAK berubah
  featuredImageKey String?                    // BARU — foto sampul eksplisit, harus salah satu dari `images`
  facilities       Json     @default("[]")   // BARU — array kode fasilitas (lihat konstanta §10.3), checkbox UI
  isActive         Boolean  @default(true)

  schedules HotelRoomSchedule[]   // ganti dari `rooms HotelRoom[]`
  services  HotelService[]        // TIDAK disentuh sesi ini — di luar scope (lihat §10.7)

  @@map("hotels")
}
```

**`HotelRoomSchedule`** (baru — MENGGANTIKAN `HotelRoom` + `HotelQuota` sepenuhnya, satu baris = 1 hotel + 1 tipe kamar + 1 periode):

```prisma
model HotelRoomSchedule {
  id           String   @id @default(uuid())
  hotelId      String
  roomTypeId   String
  periodStart  DateTime @db.Date
  periodEnd    DateTime @db.Date
  price        Decimal  @db.Decimal(12, 2)   // CACHE hasil computeSellPrice() — TIDAK diisi manual, pola sama FlightSchedule.price
  totalQuota   Int      @default(0)
  pendingQuota Int      @default(0)
  bookedQuota  Int      @default(0)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  hotel         Hotel          @relation(fields: [hotelId], references: [id], onDelete: Cascade)
  roomType      RoomType       @relation(fields: [roomTypeId], references: [id])
  bookingHotels BookingHotel[]

  @@map("hotel_room_schedules")
}
```

Tidak ada `@@unique`/exclusion constraint DB buat cegah periode tumpang tindih (Prisma tidak native-support date-range exclusion constraint tanpa `$queryRaw` — di luar scope, konsisten prinsip "jangan `$queryRaw` kecuali benar-benar perlu") — **validasi overlap dilakukan di level API** (cek sebelum create/update, tolak 409 kalau tumpang tindih untuk `hotelId`+`roomTypeId` yang sama) — ini menutup sebagian Gap #7 lama (admin sekarang dikasih tahu eksplisit kalau mau bikin periode bentrok, bukan cuma "form kosong tanpa riwayat").

**`BookingHotel`** (diubah — 1 FK `hotelRoomScheduleId` menggantikan `hotelRoomId`+`hotelQuotaId` terpisah):

```prisma
model BookingHotel {
  id                  String   @id @default(uuid())
  bookingId           String
  hotelRoomScheduleId String
  checkIn             DateTime @db.Date
  checkOut            DateTime @db.Date
  nights              Int
  numRooms            Int      @default(1)
  numGuests           Int
  pricePerNight       Decimal  @db.Decimal(12, 2)   // snapshot — SEKARANG di-set SERVER-SIDE dari HotelRoomSchedule.price
  totalPrice          Decimal  @db.Decimal(14, 2)

  booking           Booking           @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  hotelRoomSchedule HotelRoomSchedule @relation(fields: [hotelRoomScheduleId], references: [id])

  @@map("booking_hotels")
}
```

**Efek samping penting: ini menutup Gap #1 (KRITIS) dari audit §8** — karena `pricePerNight` sekarang HARUS diambil server-side dari `HotelRoomSchedule.price` (via `hotelRoomScheduleId` yang dikirim client), bukan dipercaya dari `pricePerNight` yang dikirim client langsung. `hotelSelectionSchema` (`lib/validators/booking.ts`) tidak lagi punya field `pricePerNight` — client cuma kirim `hotelRoomScheduleId`, server yang hitung total.

**Model yang DIHAPUS:** `HotelRoom`, `HotelQuota` (fungsinya sepenuhnya digantikan `HotelRoomSchedule`).

**Model yang TIDAK disentuh:** `HotelService`, `BookingService` — di luar scope requirement user (§10.7).

### 10.3 Fasilitas Hotel (konstanta, checkbox UI)

`lib/constants/hotelFacilities.ts` (baru) — daftar standar fasilitas hotel Umroh/Haji:

```typescript
export const HOTEL_FACILITIES = [
  { code: 'wifi',           label: 'WiFi Gratis' },
  { code: 'breakfast',      label: 'Sarapan' },
  { code: 'ac',             label: 'AC' },
  { code: 'tv',             label: 'TV' },
  { code: 'pool',           label: 'Kolam Renang' },
  { code: 'gym',            label: 'Pusat Kebugaran' },
  { code: 'parking',        label: 'Parkir' },
  { code: 'room_service',   label: 'Layanan Kamar 24 Jam' },
  { code: 'prayer_room',    label: 'Ruang Sholat' },
  { code: 'airport_shuttle',label: 'Antar-Jemput Bandara' },
  { code: 'laundry',        label: 'Laundry' },
  { code: 'elevator',       label: 'Lift' },
  { code: 'restaurant',     label: 'Restoran' },
  { code: 'front_desk_24h', label: 'Resepsionis 24 Jam' },
  { code: 'family_room',    label: 'Kamar Keluarga' },
] as const
```

`Hotel.facilities` menyimpan array `code` yang dicentang (mis. `["wifi","breakfast","prayer_room"]`). UI checkbox, bukan free-text — mencegah typo/variasi penulisan yang sama dengan Requirements builder Visa (yang pakai datalist bebas teks) — beda kasus karena fasilitas ini murni tampilan checkbox tanpa kebutuhan teks bebas.

### 10.4 Integrasi Harga

Reuse penuh (0 perubahan kode, sama klaim yang sudah dibuktikan 2x di Visa & Flight): `Vendor`, `ExchangeRate`, `ProductCost`, `PricingRule`, `PreferredVendor`, `computeSellPrice()` (setelah generalisasi Fase 0), `simulateSellPrice()`.

**Adapter tipis baru**: `lib/pricing/refreshHotelRoomScheduleCache.ts` — pola identik `refreshFlightScheduleCache.ts` (probe day = 1, tidak bermakna, tier HPP flat `[{minDays:0,maxDays:9999,cost}]`).

**`costComponent` untuk Hotel:** `"kamar"` (bebas teks, konsisten prinsip anti-hardcode). Satu komponen — user tidak minta komponen kedua seperti BRN versi Visa.

### 10.5 API Routes (Rencana)

| Method | Path | Auth | Catatan |
|---|---|---|---|
| GET, POST | `admin/products/hotels/room-types` | `requireManager()` | List + quick-add tipe kamar baru |
| GET, POST | `admin/products/hotels/route.ts` | `requireManager()` | **Ditulis ulang**: Zod schema, tambah `facilities`/`featuredImageKey` |
| GET, PUT | `admin/products/hotels/[id]/route.ts` | `requireManager()` | **Ditulis ulang**: Zod (menutup Gap #2 mass-assignment) |
| GET, POST | `admin/products/hotels/[id]/schedules` | `requireManager()` | List + create `HotelRoomSchedule` — `price` TIDAK diterima dari body; validasi overlap periode (409 kalau bentrok) |
| GET, PUT, DELETE | `admin/products/hotels/[id]/schedules/[scheduleId]` | `requireManager()` | Update non-harga; DELETE = soft kalau ada `BookingHotel` |
| GET, PUT | `admin/products/hotels/[id]/schedules/[scheduleId]/cost` | `requireSuperAdmin()` | Kelola 1 komponen HPP "kamar" — pola identik endpoint `cost` Flight |
| GET | `admin/products/hotels/simulate` | `requireSuperAdmin()` | Live preview, reuse `simulateSellPrice('hotel', ...)` |
| GET, POST, DELETE | `admin/products/hotels/[id]/images` | `requireManager()` | **Tidak berubah** — sudah rapi (lihat §4 lama) |
| GET | `catalog/hotels` | publik | **Ditulis ulang**: query `HotelRoomSchedule` filter `periodStart<=checkIn && periodEnd>=checkOut`, bukan lagi `detectSeason()` |

Semua route baru/ditulis-ulang wajib checklist safe-coding §9 lama (Zod di semua handler, guard di dalam handler, kuota di `$transaction()`, error 401/403 vs 500 dibedakan dengan `console.error`, tidak ada `price`/`pricePerNight` diterima mentah dari client) — menutup Gap #1/#2/#6 dari audit lama sebagai bagian dari rewrite, bukan tugas terpisah.

### 10.6 Admin UI, Publik, & Wizard (Rencana)

- **`admin/products/hotels/page.tsx`** — listing (Nama/Kota/Jarak/Jumlah Jadwal Aktif/Status), form tambah hotel (nama/kota/bintang/jarak/deskripsi/**checkbox fasilitas**), redirect ke edit setelah simpan.
- **`admin/products/hotels/[id]/page.tsx`** — edit: `ProductMediaGallery` (foto, + tombol "Jadikan Sampul" per foto → set `featuredImageKey`), checkbox fasilitas, section "Jadwal Kamar" (mirip listing Flight: pilih `RoomType` dari dropdown + quick-add, periode tanggal, total kuota → redirect ke sub-halaman HPP sama pola "Simpan & Lanjut" Flight) + panel HPP (vendor kategori `'hotel'` + quick-add, mata uang, harga kamar, live preview debounce).
- **Publik** (`(public)/hotels/page.tsx`, `[id]/page.tsx`) — hapus total ketergantungan `detectSeason()`, resolve harga & kuota dari `HotelRoomSchedule` yang periodenya mencakup tanggal check-in/check-out yang dicari (default: hari ini s/d +1 hari kalau user belum pilih tanggal, sama pola `catalog/hotels` lama).
- **Wizard** (`bookings/new/hotel/page.tsx`) — sesuaikan shape data (`roomTypeId`/`scheduleId` menggantikan `roomId`/`quotaId`), **hapus `pricePerNight` dari payload yang dikirim ke `POST /api/v1/bookings`** — cukup kirim `hotelRoomScheduleId`+`nights`+`numRooms`, server yang hitung `totalPrice` dari `HotelRoomSchedule.price` saat itu.
- **Hapus** `components/booking/HotelPicker.tsx` (dead code, Gap #5 lama) sekalian selagi menyentuh area ini.

### 10.7 Yang TIDAK Dikerjakan Sesi Ini

- **`HotelService`/"Layanan Hotel"** — TIDAK disentuh, tetap gap yang sama (Gap #3 lama) — di luar 6 poin requirement user, jangan melebar scope (`CLAUDE.md` Fase Eksekusi SOP poin 0).
- **Self-cancel tidak melepas kuota** — cross-cutting booking-core, di luar scope Hotel, tetap tercatat di `docs/arsitektur-umroh.md` §7 Gap #2.
- **Audit Transport untuk pola `unitPrice` client-trusted yang sama** — dicurigai sejak audit lama (§8 Gap #1 catatan), belum dikonfirmasi, di luar scope Hotel.
- **DB-level exclusion constraint untuk cegah overlap periode** — validasi cuma di level API (§10.2), bukan di database — cukup untuk sekarang, dicatat sebagai batasan yang diketahui.

### 10.8 Fase Eksekusi — SEMUA SELESAI (2026-07-19)

> **Deviasi dari rencana tertulis, dicatat eksplisit** (`docs/decisions.md` 2026-07-19 "Deviasi Fase Eksekusi"): rencana asli di bawah ini menyusun 7 fase terpisah dengan `bun run build` 0 error di antara tiap fase. Realitanya, begitu skema Fase 1 diubah (`HotelRoom`/`HotelQuota` dihapus), **build langsung merah di ±18 file konsumen** (API routes, halaman admin/publik/wizard, cron, quota functions) — bukan cuma "Hotel" tapi semua yang mereferensikan tipe Prisma lama. SOP `CLAUDE.md` menuntut 0 error sebelum lanjut fase berikutnya, tapi mustahil balik ke 0 error tanpa ikut memperbaiki konsumen-konsumen itu — yang sebagian besar justru scope Fase 2-5. Diputuskan (bukan dilanggar diam-diam): selesaikan seluruh rantai perbaikan sekaligus sampai build hijau kembali, lalu baru checkpoint build+dokumentasi di akhir — bukan iterasi 7x cek build terpisah. Tidak ada fase yang dilewati/disingkat isinya, cuma urutan checkpoint-nya yang berbeda dari rencana tertulis.

1. **Fase 0 — Generalisasi `computeSellPrice()` override** (§10.1 poin 4): ubah pencarian `sellPriceOverride` dari hardcode `costComponent==='individu'` jadi cari di komponen manapun yang preferred. Verifikasi: `bun run build` 0 error + `computeSellPrice()` terhadap semua `VisaProduct`/`FlightSchedule` aktif nyata → identik persis sebelum/sesudah; test fungsional komponen bernama `"kamar"` dengan `sellPriceOverride` → terbaca benar. Dokumentasi: `docs/arsitektur-harga.md` §20.
2. **Fase 1 — Schema**: `RoomType` (baru, seed 5: Single/Double/Triple/Quad/Quint), `Hotel` (+`featuredImageKey`/`facilities`), `HotelRoomSchedule` (baru, gantikan `HotelRoom`+`HotelQuota`), `BookingHotel` (FK diganti `hotelRoomScheduleId`). Migrasi `20260719160050_hotel_refactor_room_schedule` — shadow DB **diverifikasi eksplisit terpisah** sebelum dipakai (`if [ "$DATABASE_URL" = "$SHADOW_URL" ]`, pelajaran dari insiden nyaris sebelumnya di sesi yang sama). Row count 7 tabel non-Hotel diverifikasi identik sebelum/sesudah; `hotel_rooms`/`hotel_quotas` (20+20 baris, `booking_hotels:0`) dihapus sesuai izin eksplisit user.
3. **Fase 2 — Integrasi Harga**: `lib/pricing/refreshHotelRoomScheduleCache.ts` (adapter, pola identik Flight), endpoint `.../schedules/[scheduleId]/cost` (GET/PUT, `requireSuperAdmin()`) + `.../simulate` (GET), hook `refreshAllHotelRoomScheduleCaches()` ke `exchangeRateJob.ts`.
4. **Fase 3 — Admin UI**: `products/hotels/page.tsx` (listing + form tambah dengan checkbox fasilitas), `products/hotels/[id]/page.tsx` (info dasar + fasilitas + foto sampul via thumbnail-picker dari galeri existing + section "Jadwal Kamar" — tiap baris expandable inline untuk isi HPP dengan quick-add `RoomType` & quick-add `Vendor` category `'hotel'`, live preview debounce). Route API `hotels`/`[id]`/`[id]/schedules`/`[id]/schedules/[scheduleId]` ditulis ulang total dengan Zod (menutup Gap #2) + validasi overlap periode (409) + soft-delete kalau ada booking.
5. **Fase 4 — Publik**: `catalog/hotels/route.ts`, `(public)/hotels/page.tsx`, `(public)/hotels/[id]/page.tsx`, `(public)/page.tsx` (featured hotels) — semua di-rewrite resolve harga/kuota dari `HotelRoomSchedule` yang periodenya mencakup `checkIn`/`checkOut` (atau hari ini untuk listing tanpa filter tanggal), `detectSeason()` dihapus total dari jalur Hotel. Detail page tambah section Fasilitas.
6. **Fase 5 — Wizard & Booking (tutup Gap #1 KRITIS)**: `hotelSelectionSchema` (`lib/validators/booking.ts`) — `pricePerNight` **dihapus dari input client**, cukup `hotelRoomScheduleId`. `app/api/v1/bookings/route.ts` — fetch `HotelRoomSchedule` server-side, `pricePerNight`/`totalPrice` dihitung dari situ, TIDAK PERNAH dari body client. `bookings/new/hotel/page.tsx` disesuaikan ke shape baru (`scheduleId`/`roomTypeName`). Dead code `components/booking/HotelPicker.tsx` dihapus (Gap #5 lama). Fungsi kuota (`reserveHotelQuota`/`confirmHotelQuota`/`releaseHotelQuota` di `lib/quota/index.ts`) diarahkan ke `HotelRoomSchedule`.
7. **Fase 6 — Dokumentasi final**: dokumen ini, `docs/progress.md`, `docs/decisions.md`, `CLAUDE.md` diupdate.

**Verifikasi end-to-end (browser + script langsung, data uji dibersihkan setelahnya):**
- Admin: buka hotel nyata ("Anwar Al Madinah Mövenpick Hotel") → centang fasilitas WiFi+Sarapan → simpan → reload → tetap tercentang (dikonfirmasi lewat DOM langsung).
- Admin: "Tambah Jadwal" → pilih tipe kamar "Single" (dari 5 tipe seeded) → periode 1-31 Jan 2027 → 15 kamar → simpan → auto-expand ke panel HPP.
- Admin: quick-add vendor "Grand Hotel Supplier TEST" dari panel HPP jadwal → dikonfirmasi `category:'hotel'` tersimpan otomatis di database.
- Admin: isi Harga Kamar 450 USD → live preview HPP Rp 8.202.521 / Harga Jual Rp 9.850.000 (debounce 500ms) → simpan → `HotelRoomSchedule.price` di database **persis Rp 9.850.000**, `ProductCost` (`costComponent:"kamar"`) tersimpan benar.
- Publik: `GET /api/v1/catalog/hotels?check_in=2027-01-05&check_out=2027-01-10` → hotel yang punya jadwal tampil dengan `pricePerNight:9850000`, `facilities:["wifi","breakfast"]`, `availability:"limited"`; 4 hotel lain (belum ada jadwal untuk periode itu) tampil `schedules:[]`, `availability:"full"` — bukan error, behavior yang benar.
- Admin: Dashboard Kuota (`/admin/quotas`) menampilkan baris "Anwar Al Madinah Mövenpick Hotel — Single — 15 total — 0 pending — 0 booked — 15 sisa" dengan benar.
- **Keamanan (Gap #1)**: script verifikasi langsung mensimulasikan persis logic `bookings/route.ts` dengan `maliciousClientPrice=1` yang SENGAJA tidak pernah dipakai di path manapun — hasil `pricePerNight` yang tersimpan **selalu** `HotelRoomSchedule.price` asli (Rp 9.850.000), tidak pernah angka client. Terbukti juga secara statis: `hotelSelectionSchema` tidak lagi punya field `pricePerNight` sama sekali (TypeScript akan gagal compile kalau ada kode yang mencoba membacanya dari situ) — build sukses 0 error membuktikan tidak ada jalur kode yang bergantung ke harga client.
- Semua data uji (jadwal, vendor, ProductCost, PreferredVendor) dibersihkan dari database setelah verifikasi — data nyata (5 hotel, fasilitas WiFi+Sarapan yang sengaja dipertahankan sebagai contoh nyata bekerja) tetap ada.

`bun run build` — 0 error (checkpoint akhir, setelah seluruh rantai konsumen diperbaiki).

---

## 11. Periode Sebagai Entitas Terpisah, Input Massal per Periode — SELESAI & TERVERIFIKASI (2026-07-19)

> **Status: SELESAI & TERVERIFIKASI.** Ditemukan user lewat pemakaian nyata: rate sheet vendor hotel asli berbentuk matriks (1 periode tanggal × banyak tipe kamar sekaligus, lihat gambar rate sheet yang dilampirkan user). Struktur §10 (`HotelRoomSchedule` menyimpan `periodStart`/`periodEnd` sendiri per baris) sudah BENAR secara relasional (banyak-ke-banyak periode↔tipe kamar tetap bisa direpresentasikan), tapi UI-nya memaksa admin isi satu tipe-kamar-satu-periode setiap kali — tidak sesuai cara vendor hotel kasih quote (1 rate sheet = banyak tipe kamar dalam 1 form). 3 keputusan dikonfirmasi via `AskUserQuestion` sebelum rencana ini ditulis. Blast radius dicek dulu sebelum eksekusi (pelajaran §10.8) — terbukti terkontrol, cuma 2 checkpoint dibutuhkan.

### 11.1 Keputusan (dikonfirmasi user, 2026-07-19)

1. **Vendor & mata uang per periode** (bukan per tipe kamar) — satu rate sheet = satu vendor/kontrak, admin pilih vendor+currency SEKALI per periode, lalu isi angka harga tiap tipe kamar dalam satu form.
2. **Meal plan (Full Board dst.) masuk ke checkbox Fasilitas** yang sudah ada (`lib/constants/hotelFacilities.ts`) — BUKAN dimensi harga terpisah. Tidak ada perubahan struktur harga untuk ini, cukup tambah beberapa kode fasilitas (`full_board`, `half_board`, `room_only`) ke daftar checkbox existing.
3. **1 baris data nyata yang sudah ada** (Saja Al Madinah Hotel, Single, 26 Jul–31 Okt 2026, Rp 13.550.000) **dihapus**, user akan input ulang manual lewat UI baru setelah selesai — bukan dimigrasikan otomatis.

### 11.2 Skema Baru — `HotelPricePeriod` sebagai Entitas Terpisah

**Masalah struktural yang ditutup**: di §10, `periodStart`/`periodEnd` diulang di SETIAP baris `HotelRoomSchedule` (1 per tipe kamar) — kalau admin input 4 tipe kamar untuk periode yang "sama", tidak ada jaminan struktural ke-4 baris itu benar-benar punya tanggal identik (rawan mismatch kalau diedit terpisah). Solusi: periode jadi entitas sendiri, direferensikan banyak `HotelRoomSchedule` sekaligus.

```prisma
model HotelPricePeriod {
  id          String   @id @default(uuid())
  hotelId     String
  periodStart DateTime @db.Date
  periodEnd   DateTime @db.Date
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  hotel     Hotel               @relation(fields: [hotelId], references: [id], onDelete: Cascade)
  schedules HotelRoomSchedule[]

  @@map("hotel_price_periods")
}

model HotelRoomSchedule {
  id           String   @id @default(uuid())
  periodId     String
  roomTypeId   String
  price        Decimal  @db.Decimal(12, 2) // cache computeSellPrice(), tidak berubah dari §10
  totalQuota   Int      @default(0)
  pendingQuota Int      @default(0)
  bookedQuota  Int      @default(0)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  period        HotelPricePeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  roomType      RoomType         @relation(fields: [roomTypeId], references: [id])
  bookingHotels BookingHotel[]

  @@unique([periodId, roomTypeId]) // BARU — cegah 2 baris tipe kamar sama dalam 1 periode yang sama
  @@map("hotel_room_schedules")
}
```

`Hotel.schedules` (relasi lama ke `HotelRoomSchedule[]`) diganti `Hotel.pricePeriods: HotelPricePeriod[]`. **`BookingHotel` TIDAK BERUBAH** — masih FK ke `HotelRoomSchedule.id` langsung, tidak peduli struktur periode di baliknya (blast radius rendah, lihat §11.4).

**Vendor per periode TANPA field redundan**: `vendorId`/`currency` TIDAK disimpan di `HotelPricePeriod` — tetap lewat `ProductCost`/`PreferredVendor` per `HotelRoomSchedule.id` seperti §10 (konsisten arsitektur harga universal, `computeSellPrice()` TIDAK disentuh lagi). "Satu vendor per periode" ditegakkan di level API (endpoint bulk-save selalu tulis vendor+currency yang sama ke semua `ProductCost` tipe kamar dalam satu periode), bukan di level skema — lihat §11.3.

### 11.3 API — Endpoint Bulk per Periode

| Method | Path | Auth | Catatan |
|---|---|---|---|
| GET, POST | `admin/products/hotels/[id]/periods` | `requireManager()` | List periode (+ schedules nested) / create periode baru (tanggal saja, harga menyusul) |
| GET, PUT, DELETE | `admin/products/hotels/[id]/periods/[periodId]` | `requireManager()` | Edit tanggal periode; DELETE = soft kalau ada schedule dengan booking |
| GET, PUT | `admin/products/hotels/[id]/periods/[periodId]/prices` | `requireSuperAdmin()` | **Endpoint baru inti** — GET kembalikan vendor/currency (dari `ProductCost` tipe kamar pertama di periode itu) + harga per tipe kamar; PUT terima `{vendorId, currency, rooms: [{roomTypeId, cost, totalQuota}]}` → upsert `HotelRoomSchedule`+`ProductCost`+`PreferredVendor` per tipe kamar yang dikirim (vendor+currency SAMA untuk semua), refresh cache tiap schedule yang berubah. Tipe kamar yang TIDAK dikirim di `rooms` — baris lamanya (kalau ada) dibiarkan, tidak otomatis dihapus (safer default). |

**Dihapus** (digantikan endpoint di atas): `admin/products/hotels/[id]/schedules/route.ts`, `.../schedules/[scheduleId]/route.ts`, `.../schedules/[scheduleId]/cost/route.ts`. Endpoint `admin/products/hotels/simulate` (§10.5) **tetap dipakai apa adanya** — dipanggil per tipe kamar dari frontend saat live preview (tidak perlu endpoint simulate-massal baru).

### 11.4 Blast Radius (dicek dulu sebelum nulis rencana — pelajaran §10.8)

Karena `catalog/hotels` API akan tetap mengembalikan bentuk `schedules: [...]` yang SAMA persis seperti §10 (di-flatten dari `pricePeriods.flatMap(p => p.schedules)` di server, bukan di-expose sebagai nested periode ke publik), **konsumen berikut TIDAK PERLU diubah sama sekali**: `lib/quota/index.ts`, `lib/validators/booking.ts`, `app/api/v1/bookings/route.ts`, `app/api/v1/admin/payments/[id]/confirm/route.ts`, `lib/cron/autocancelJob.ts`, `lib/booking/draft.ts`, `bookings/new/hotel/page.tsx`, `bookings/new/payment/page.tsx`, halaman detail booking admin/pilgrim (kecuali mau tambah tampilan tanggal periode — opsional, bukan wajib).

**Yang WAJIB diubah** (baca `.schedules`/`periodStart`/`periodEnd` di level `Hotel` langsung, atau route yang dihapus §11.3): `app/api/v1/catalog/hotels/route.ts`, `app/[locale]/(public)/hotels/page.tsx`, `app/[locale]/(public)/hotels/[id]/page.tsx`, `app/[locale]/(public)/page.tsx`, `app/api/v1/admin/products/hotels/[id]/route.ts` (include), `app/api/v1/admin/products/hotels/route.ts` (`_count`), `app/[locale]/admin/(protected)/products/hotels/page.tsx` (label count), `app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx` (rebuild total section Jadwal→Periode), `app/[locale]/admin/(protected)/quotas/page.tsx` + `app/api/v1/admin/quotas/route.ts` (tambah `include: {period:true}`).

### 11.5 Fasilitas — Tambah Kode Meal Plan

`lib/constants/hotelFacilities.ts` — tambah 3 kode: `full_board` ("Full Board"), `half_board` ("Half Board"), `room_only` ("Tanpa Sarapan/Room Only"). Checkbox UI tidak berubah strukturnya, cuma daftar opsi bertambah.

### 11.6 Admin UI — Grid Input per Periode

Section "Jadwal Kamar" (§10.6) diganti "Periode & Harga Kamar":
- List periode existing (baris: tanggal, jumlah tipe kamar terisi, harga termurah–termahal) — klik untuk expand.
- "+ Tambah Periode" — form tanggal SAJA (tanpa tipe kamar/harga) → simpan → auto-expand ke grid harga.
- Grid harga (per periode yang expand): vendor+currency picker SEKALI di atas (+ quick-add, sama pola §10.6) → tabel baris = tiap `RoomType` aktif (Single/Double/Triple/Quad/Quint/dst.), kolom = Harga Kamar (input) / Total Kuota (input) / HPP (live) / Harga Jual (live) — preview per baris pakai endpoint `simulate` yang sudah ada, debounce 500ms per baris. Satu tombol "Simpan Semua Harga" mengirim SATU request bulk (§11.3) untuk semua baris yang terisi sekaligus — bukan N request terpisah.

### 11.7 Fase Eksekusi — SELESAI

Blast radius dicek dulu (§11.4) sebelum ditulis rencana — terbukti akurat: `lib/quota/index.ts`, `lib/validators/booking.ts`, `app/api/v1/bookings/route.ts`, wizard hotel/payment, dll. **benar-benar tidak disentuh sama sekali** di refactor ini. Yang meleset dari prediksi: 3 file booking-detail (`app/[locale]/admin/(protected)/bookings/[id]/page.tsx`, `app/[locale]/(pilgrim)/bookings/[id]/page.tsx`, `app/api/v1/bookings/[id]/route.ts`) — sisa peninggalan §10 yang meng-include `hotelRoomSchedule.hotel` langsung (relasi itu sekarang lewat `period.hotel`), ketahuan dari `bun run build`, diperbaiki cepat, tidak perlu deviasi fase seperti §10.8.

1. **Checkpoint 1 — Schema + API** (2026-07-19): migrasi `20260719170340_hotel_price_period` (`HotelPricePeriod` baru, `HotelRoomSchedule` restructured + `@@unique([periodId,roomTypeId])`, 1 baris data lama dihapus sesuai §11.1 poin 3), 3 route baru (`periods`, `periods/[periodId]`, `periods/[periodId]/prices`), 3 route lama dihapus, `catalog/hotels`+3 halaman publik+quota dashboard (page+API)+admin hotel GET/listing disesuaikan ke `pricePeriods` (di-flatten ke bentuk `schedules` yang sama di level response publik, supaya konsumen luar tidak berubah). Verifikasi: shadow DB diverifikasi eksplisit terpisah sebelum dipakai, row count 7 tabel non-Hotel identik sebelum/sesudah, `bun run build` 0 error setelah perbaikan 3 file booking-detail yang meleset dari estimasi awal.
2. **Checkpoint 2 — Admin UI** (2026-07-19): rebuild total section "Periode & Harga Kamar" (§11.6) — grid per periode, vendor+currency sekali di atas, tabel 1 baris per `RoomType` (bukan per periode seperti §10) dengan live preview per baris, satu tombol simpan bulk.
   - **Diverifikasi lewat browser di hotel nyata** ("Anwar Al Madinah Mövenpick Hotel"): buat periode 1 Jul–15 Agu 2027 → grid otomatis tampilkan 5 tipe kamar seeded (Single/Double/Triple/Quad/Quint) sekaligus dalam satu form → pilih vendor "Mas Adam" (vendor nyata milik user) sekali → isi harga Single 440, Double 490, Triple 535, Quad 520 (mata uang USD) → live preview HPP/Harga Jual muncul benar per baris (debounce 500ms per baris, dipanggil paralel) → klik "Simpan Semua Harga" sekali → **dikonfirmasi ke database**: 4 baris `HotelRoomSchedule` tersimpan dengan harga BERBEDA (Rp 9.600.000/10.700.000/11.700.000/11.350.000) tapi `vendorId`+`currency` SAMA persis di ke-4 `ProductCost`-nya — membuktikan "satu vendor per periode" (§11.1 poin 1) bekerja sesuai desain.
   - Ringkasan periode (collapsed view) tampil benar: "1 Jul 2027 – 15 Agu 2027, 4 tipe kamar terisi, Rp 9.600.000 – Rp 11.700.000".
   - `GET /api/v1/catalog/hotels?check_in=2027-07-10&check_out=2027-07-15` — hotel yang punya periode itu tampil dengan 4 `schedules` (harga & kuota per tipe kamar benar), hotel lain tanpa periode tampil `schedules:[]` — bentuk response API publik **identik** dengan §10, tidak ada breaking change ke konsumen.
   - Dashboard Kuota admin (`/admin/quotas`) tampil 4 baris terpisah (Single/Double/Triple/Quad) dengan total kuota benar (20/15/10/8).
   - Data uji (periode, 4 schedule, `ProductCost`, `PreferredVendor`) dibersihkan; vendor "Mas Adam" dan checkbox fasilitas WiFi+Sarapan (data nyata milik user) dipertahankan.
   - `bun run build` — 0 error (checkpoint akhir).

### 11.8 Yang TIDAK Dikerjakan

- Meal plan sebagai dimensi harga terpisah (periode×tipe kamar×meal) — sengaja jadi checkbox fasilitas saja (§11.1 poin 2), bukan struktur harga baru.
- Endpoint simulate-massal baru — reuse endpoint per-tipe-kamar existing dari §10.5, dipanggil berkali-kali di frontend (pola sama Visa row-preview).
- DB-level exclusion constraint untuk overlap periode antar `HotelPricePeriod` — sama seperti §10, validasi cukup di app-level kalau dibutuhkan nanti.

### 11.9 Tabel Rate Sheet di Halaman Publik (2026-07-19)

User minta tampilan publik yang sama bentuknya dengan rate sheet vendor (periode × tipe kamar dalam satu tabel), supaya pengunjung tahu harga di berbagai periode sebelum pilih tanggal booking — bukan cuma harga hari ini.

**`app/[locale]/(public)/hotels/[id]/page.tsx`** — section "Tipe Kamar" (cards, cuma tampilkan periode yang mencakup hari ini) diganti total "Harga per Periode": query diubah dari filter `periodStart<=today<=periodEnd` jadi ambil **semua** `pricePeriods` aktif (`orderBy: periodStart asc`), kolom tabel = union semua `RoomType` yang pernah dipakai hotel itu (diurutkan `defaultCapacity`). Desktop: tabel asli (Dari/Sampai/kolom per tipe kamar). Mobile: kartu per periode dengan grid 2 kolom tipe kamar (pola responsive sama seperti katalog Flight — `hidden md:block`/`md:hidden`, satu data source, dua presentasi).

Diverifikasi langsung di data nyata milik user ("Anwar Al Madinah Mövenpick Hotel", 2 periode × 4 tipe kamar yang sudah diinput user sendiri lewat §11.6) — tabel desktop tampil persis format rate sheet yang dilampirkan user (kolom SINGLE/DOUBLE/TRIPLE/QUAD, 2 baris periode dengan harga masing-masing benar), kartu mobile tampil rapi, tidak ada console error. Tidak ada data yang diubah — murni penyesuaian tampilan.

> **Pembaruan 2026-10-23:** `Hotel.description` kini **teks kaya** (JSON dokumen Tiptap dalam kolom `String?` yang sama, tanpa migrasi; teks polos lama tetap sah). Form admin (`hotels/[id]` dan buat di `hotels/page.tsx`) memakai `RichTextEditor`; `POST/PUT /admin/products/hotels[/id]` memvalidasi lewat `richTextField()` (`'' → null`); detail publik memakai `RichTextView`. Lihat `docs/arsitektur-editor-teks.md` §8.

