# Arsitektur — Modul Muthowif

> **Status: SELESAI & TERVERIFIKASI (2026-07-20).** §1-§7 adalah arsip audit as-built (2026-07-08) — sebagian besar skema/API/UI yang dideskripsikan di sana **sudah digantikan** oleh §9 (booking generik + assignment admin, bukan lagi jamaah pilih nama saat booking) dan §10 (integrasi HPP universal — harga layanan sekarang dihitung dari HPP+kurs+margin, bukan diketik manual). §7 sudah diperbarui: Gap #1 (KRITIS), #2 (foto profil), #4, #6 (obsolete), #7 (pesan error spesifik), #8, #9 **DITUTUP**. §9 dan §10 sudah dieksekusi penuh dan diverifikasi — `bun run build` 0 error, browser end-to-end, script test siklus pool→assign→confirm. Lihat `docs/decisions.md` untuk bukti verifikasi lengkap.

---

## 1. Konteks Bisnis

Muthowif adalah pembimbing ibadah (guide) yang disewa per hari untuk mendampingi jamaah. Harga per hari mengikuti 3 season tetap (Regular/Ramadan/Haji) seperti Transport dan Hotel — bukan JSON per-tanggal. Ketersediaan dilacak per hari (`MuthowifAvailability`), dengan kapasitas harian tetap per guide (`dailyCapacity`).

---

## 2. Skema Data Aktual (Prisma)

Sumber: `prisma/schema.prisma:506-533` (Muthowif, MuthowifAvailability), `:535-549` (BookingMuthowif).

```prisma
model Muthowif {
  id            String  @id @default(uuid())
  name          String
  bio           String?
  photoUrl      String?           // lihat Gap #2 — field ini tidak pernah dipakai
  languages     Json    @default("[]")  // string[] ad hoc, tidak ada type formal (lihat Gap #3)
  rating        Decimal @default(5.00) @db.Decimal(3, 2)  // statis, lihat Gap #5
  dailyCapacity Int     @default(50)
  priceRegular  Decimal @db.Decimal(12, 2)
  priceRamadan  Decimal @db.Decimal(12, 2)
  priceHajj     Decimal @db.Decimal(12, 2)
  isActive      Boolean @default(true)   // tidak ada UI toggle, lihat Gap #4

  availability    MuthowifAvailability[]
  bookingMuthowif BookingMuthowif[]
  @@map("muthowif")
}

model MuthowifAvailability {
  id           String   @id @default(uuid())
  muthowifId   String
  date         DateTime @db.Date
  pendingCount Int      @default(0)
  bookedCount  Int      @default(0)   // lihat Gap #1 — kolom ini efektif tidak pernah bertambah

  muthowif Muthowif @relation(fields: [muthowifId], references: [id], onDelete: Cascade)
  @@unique([muthowifId, date])
  @@map("muthowif_availability")
}

model BookingMuthowif {
  id         String   @id @default(uuid())
  bookingId  String
  muthowifId String
  startDate  DateTime @db.Date
  endDate    DateTime @db.Date
  numDays    Int
  numPeople  Int
  totalPrice Decimal  @db.Decimal(14, 2)  // snapshot total, dihitung frontend (lihat §6)

  booking  Booking  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  muthowif Muthowif @relation(fields: [muthowifId], references: [id])
  @@map("booking_muthowif")
}
```

Harga adalah **3 kolom tetap per season** (sama pola dengan Transport `TransportPricing`, beda dengan Visa yang JSON bebas). Kapasitas **tidak** disimpan per baris availability — selalu diturunkan dari `muthowif.dailyCapacity` dikurangi `pendingCount + bookedCount` pada tanggal itu.

---

## 3. API Routes

| Method | Path | Auth guard | File | Catatan |
|---|---|---|---|---|
| GET, POST | `/api/v1/admin/products/muthowif` | `requireManager()` | `.../muthowif/route.ts` | **Hanya create, tidak ada `[id]/route.ts`** — tidak ada PUT/DELETE (lihat Gap #4). POST **tidak divalidasi Zod**, langsung `+b.field` type coercion dari raw JSON |
| GET | `/api/v1/catalog/muthowif` | publik | `.../catalog/muthowif/route.ts` | Query `start_date`/`end_date`/`language` (Zod-validated); hitung `availability` badge (`available`/`limited`/`full`) dari jumlah hari yang penuh dalam rentang tanggal; season via `detectSeason()` |

**Booking creation** (`app/api/v1/bookings/route.ts:58-64`):
```typescript
if (data.muthowif) {
  const start = new Date(data.muthowif.startDate)
  const end   = new Date(data.muthowif.endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    await reserveMuthowifQuota(tx, data.muthowif.muthowifId, new Date(d), data.muthowif.numPeople)
  }
}
```
Reservasi **per hari** dalam rentang `startDate`–`endDate` inklusif, semua di dalam `$transaction(Serializable)` yang sama dengan hotel/transport — jika satu hari saja kapasitasnya kurang, seluruh booking gagal (lihat Gap #7).

**Quota reservation** (`lib/quota/index.ts:60-73`):
```typescript
export async function reserveMuthowifQuota(tx: Tx, muthowifId: string, date: Date, people: number): Promise<void> {
  const avail = await tx.muthowifAvailability.upsert({
    where: { muthowifId_date: { muthowifId, date } },
    create: { muthowifId, date, pendingCount: 0, bookedCount: 0 },
    update: {},
    select: { pendingCount: true, bookedCount: true, muthowif: { select: { dailyCapacity: true } } },
  })
  const available = avail.muthowif.dailyCapacity - avail.pendingCount - avail.bookedCount
  if (available < people) throw new Error('Muthowif capacity insufficient for selected dates')
  await tx.muthowifAvailability.update({
    where: { muthowifId_date: { muthowifId, date } },
    data: { pendingCount: { increment: people } },
  })
}
```

**Cancellation/release** (`lib/cron/autocancelJob.ts:32-42`) memanggil `releaseMuthowifQuota()` per hari, men-decrement `pendingCount`.

---

## 4. Admin UI

`app/[locale]/admin/(protected)/products/muthowif/page.tsx` — Client Component, **create-only**:
- Form: `name`, `languages` (input teks dipisah koma), `bio` (textarea), `dailyCapacity`, `priceRegular`/`priceRamadan`/`priceHajj`
- **Tidak ada field untuk** `photoUrl`, `rating`, `isActive` di form
- List: tabel read-only (name, rating, dailyCapacity, priceRegular) — tidak ada tombol edit/hapus

`app/[locale]/admin/(protected)/quotas/page.tsx` — section muthowif hanya menampilkan `name` + `dailyCapacity` per kartu, **tidak** menampilkan pending/booked/available per tanggal (beda dengan section hotel yang punya tabel detail dengan warning warna).

---

## 5. Katalog Publik & Wizard

`app/[locale]/(public)/muthowif/page.tsx` (list) dan `[id]/page.tsx` (detail) — keduanya Server Component dengan direct Prisma query, sort by rating desc, harga dihitung dari `detectSeason()`. **Tidak menampilkan foto** (pakai ikon `UserRound` generik meski `photoUrl` ada di data) dan **tidak menampilkan detail ketersediaan tanggal** di halaman detail.

`app/[locale]/(pilgrim)/bookings/new/muthowif/page.tsx` — Step 4 wizard, **opsional/bisa skip** (tombol berubah jadi "Lewati Pilih Layanan Tambahan" jika tidak ada guide dipilih). Fetch `/api/v1/catalog/muthowif?start_date=...&end_date=...` sesuai tanggal draft. Pilih satu guide (toggle select/deselect), total dihitung live (`pricePerDay × numDays × numPeople`). Field `availability` dari API (`available`/`limited`/`full`) **di-fetch tapi tidak pernah dirender** ke user (lihat Gap #6).

Tipe draft: `lib/booking/draft.ts:42-50` (`MuthowifSelection`), total dihitung di `computeTotal()` (`:109-118`) — **dihitung di frontend**, dikirim sebagai `totalPrice` snapshot, **tidak dihitung ulang di server** saat create booking (potensi manipulasi harga sisi klien — bukan pola berbeda dari modul lain, tapi dicatat di sini karena tidak ada validasi ulang harga server-side untuk muthowif).

Validator: `lib/validators/booking.ts:34-41` — `muthowif` object opsional (`z.object({...}).optional()`), field `totalPrice: z.number().positive()` diterima apa adanya dari klien.

`components/booking/MuthowifPicker.tsx` — stub `return null`, tidak dipakai di mana pun (dead code sisa refactor, sama pola dengan `TransportPicker.tsx` yang sudah ditemukan di modul Transport).

---

## 6. Perhitungan Harga

`BookingMuthowif.totalPrice` = `pricePerDay × numDays × numPeople`, dihitung di `PriceSidebar.tsx:30-35` dan `lib/booking/draft.ts` — konsisten di seluruh flow, tapi **hanya di frontend**, tidak divalidasi ulang di `POST /api/v1/bookings`.

---

## 7. Gap / Ketidaksesuaian Aktif (per audit 2026-07-08, direvisi 2026-07-20)

### ~~Gap #1 — KRITIS: `confirmMuthowifQuota()` tidak ada, quota tidak pernah pindah pending → booked~~ — DITUTUP 2026-07-20

Ditutup sebagai bagian dari eksekusi §9 (booking generik + assignment admin). `confirmMuthowifQuota()` (individual) dan `confirmPoolMuthowifQuota()` (pool) sekarang ada di `lib/quota/index.ts`, dipanggil dari `app/api/v1/admin/payments/[id]/confirm/route.ts` yang sudah menyertakan `muthowif: true` di `include`. Diverifikasi lewat script test end-to-end: reserve pool saat booking dibuat → assign individual oleh admin → confirm pool+individual saat payment confirm — konsisten di setiap tahap. Lihat `docs/decisions.md` 2026-07-20 untuk detail verifikasi. Detail historis gap asli dipertahankan di bawah untuk konteks.

<details>
<summary>Detail gap asli (arsip, sudah tidak akurat — quota sekarang 2 lapis: pool + individual, lihat §9)</summary>

### Gap #1 — KRITIS: `confirmMuthowifQuota()` tidak ada, quota tidak pernah pindah pending → booked

**Diverifikasi langsung** (`app/api/v1/admin/payments/[id]/confirm/route.ts:19-33`):
```typescript
const payment = await prisma.payment.findUnique({
  where: { id },
  include: { booking: { include: { hotels: true, transports: true, user: true } } },
  //                                                    ↑ TIDAK ADA `muthowif: true`
})
// ...
for (const h of booking.hotels)     await confirmHotelQuota(tx, h.hotelQuotaId, h.numRooms)
for (const t of booking.transports) await confirmTransportQuota(tx, t.transportQuotaId, t.numPassengers)
// TIDAK ADA loop untuk booking.muthowif — dan confirmMuthowifQuota() memang tidak ada di lib/quota/index.ts
```

`lib/quota/index.ts` hanya berisi `reserveMuthowifQuota()` dan `releaseMuthowifQuota()` — **tidak ada `confirmMuthowifQuota()`**, berbeda dengan Hotel (`confirmHotelQuota`) dan Transport (`confirmTransportQuota`) yang polanya identik dan lengkap.

**Dampak nyata:** saat admin konfirmasi pembayaran booking yang mengandung muthowif, `MuthowifAvailability.pendingCount` untuk tanggal-tanggal itu **tidak pernah di-decrement dan `bookedCount` tidak pernah bertambah**. Kapasitas tetap tampak seperti masih "pending" selamanya — secara teknis ini tidak menyebabkan overbooking (karena `pendingCount` sudah dikunci sejak reservasi), tapi:
- Jika booking di-cancel/expire setelah confirmed, cron `autocancelJob` akan tetap men-decrement `pendingCount` (karena hanya tahu `releaseMuthowifQuota`) — padahal booking sudah lunas dan seharusnya statusnya `bookedCount`, bukan dirilis kembali ke pool tersedia.
- Dashboard admin/quota tidak bisa membedakan mana muthowif yang sudah lunas (`bookedCount`) vs baru menunggu bayar (`pendingCount`) — datanya bercampur selamanya di `pendingCount`.

**Perbaikan yang dibutuhkan:** tambah `confirmMuthowifQuota(tx, muthowifId, date, people)` (decrement `pendingCount`, increment `bookedCount`, per tanggal dalam rentang) di `lib/quota/index.ts`, panggil dari payment confirm route setelah menambahkan `muthowif: true` ke `include`.

</details>

### Gap lain (non-kritis, UX/admin convenience) — status per 2026-07-20

| # | Gap | Status |
|---|-----|--------|
| ~~2~~ | ~~`photoUrl` ada di schema & API tapi tidak pernah diisi admin maupun dirender di UI manapun~~ | **DITUTUP 2026-07-20** — field direname `photoUrl`→`photoKey` (menyimpan object key MinIO, bukan URL, sesuai konvensi `CLAUDE.md`). Upload/hapus foto lewat `admin/products/muthowif/[id]/photo/route.ts`, UI upload di halaman edit admin, dirender di katalog publik (list/detail) dan homepage featured section (presigned URL, fallback ikon `UserRound` kalau kosong). |
| 3 | `languages: Json` tidak punya type formal | **Masih terbuka** — tidak diminta, di luar scope §9 |
| ~~4~~ | ~~Tidak ada PUT/DELETE untuk admin Muthowif, tidak ada toggle `isActive`~~ | **DITUTUP 2026-07-20** — `admin/products/muthowif/[id]/route.ts` (GET/PUT) + halaman edit ditambahkan sebagai bagian §9 (dibutuhkan supaya admin bisa kelola roster yang jadi basis kapasitas pool) |
| 5 | `rating` statis sejak seed, tidak ada mekanisme update | **Masih terbuka** — tidak diminta |
| ~~6~~ | ~~Badge `availability` per-orang tidak pernah dirender~~ | **Obsolete, bukan lagi gap** — konsepnya sudah tidak berlaku, jamaah tidak lagi lihat ketersediaan per-orang sama sekali (§9, showcase-only) |
| ~~7~~ | ~~Reservasi "all-or-nothing" per rentang tanggal tidak dikomunikasikan spesifik hari mana yang penuh~~ | **DITUTUP 2026-07-20** — `reservePoolMuthowifQuota()` (`lib/quota/index.ts`) sekarang menyertakan tanggal spesifik + sisa kapasitas di pesan error, sudah otomatis diteruskan ke user lewat mekanisme forward-error yang sudah ada (`app/api/v1/bookings/route.ts` catch block → payment page). Reservasi tetap all-or-nothing (tidak diminta diubah), cuma pesannya sekarang spesifik. |
| ~~8~~ | ~~Admin quotas page tidak ada breakdown pending/booked/available~~ | **DITUTUP 2026-07-20** — diganti tabel pool per-tanggal (`admin/quotas/page.tsx`), bentuk baru sesuai model pool (§9) |
| ~~9~~ | ~~Dead code `components/booking/MuthowifPicker.tsx`~~ | **DITUTUP 2026-07-20** — dikonfirmasi zero import, file dihapus |

---

## 8. Referensi Silang

- Status milestone: `docs/progress.md` → M3 (catalog), M4 (wizard step 4)
- `docs/architecture.md` bagian Muthowif — arsip desain awal, tidak diverifikasi ulang secara detail (skema dasarnya masih mirip, tapi tidak dijadikan rujukan implementasi)
- Pola dokumen ini mengikuti template `docs/arsitektur-visa.md` dan `docs/arsitektur-transportasi.md`

---

## 9. RENCANA — Booking Generik + Assignment Admin (belum dieksekusi)

> Ditulis 2026-07-20. User mengidentifikasi bahwa model marketplace saat ini (jamaah browse & pilih 1 muthowif by name saat booking) tidak cocok dengan positioning Saudinesia sebagai **curated operator** (lihat `CLAUDE.md` baris 1) — bukan marketplace tempat jamaah pilih orang. Model baru: jamaah cukup pesan "layanan muthowif", Saudinesia (admin) yang menentukan siapa yang bertugas setelah booking masuk.

### 9.1 Keputusan Struktural (dikonfirmasi user via AskUserQuestion, 2026-07-20)

| Keputusan | Pilihan |
|---|---|
| Kapan muthowif spesifik ditentukan | **Admin assign manual setelah booking dibuat** — bukan saat booking (client pilih), bukan auto-assign algoritmik. Ini keputusan manusia/kurasi, sesuai "kita yang siapkan yang layak" |
| Opsi pilih manual oleh jamaah | **Tidak ada sama sekali** — wizard tidak menawarkan pilih nama, bahkan sebagai opsi. Roster muthowif di katalog publik murni showcase/marketing, terpisah dari alur booking |
| Skema harga | **Satu harga layanan flat** (bukan per-orang) — harga milik "layanan muthowif" itu sendiri, bukan milik masing-masing profil. Field harga di `Muthowif` dihapus |

### 9.2 Konsekuensi Model Kapasitas

Karena muthowif spesifik belum diketahui saat booking dibuat, kapasitas **tidak bisa lagi dicek per-orang** (`MuthowifAvailability` per `muthowifId`) di titik reservasi. Perlu dua lapis:

1. **Pool-level** (baru) — total kapasitas gabungan semua muthowif **aktif** pada tanggal tertentu (`SUM(Muthowif.dailyCapacity WHERE isActive)`, dihitung live, tidak disimpan). Dicek & direservasi saat **booking dibuat** — ini yang menjamin Saudinesia tidak overbook secara agregat.
2. **Individual-level** (`MuthowifAvailability`, sudah ada) — dipertahankan, tapi sekarang cuma dipakai saat **admin assign** seseorang ke booking tertentu, supaya 1 muthowif tidak ter-assign ke banyak grup melebihi kapasitas hariannya sendiri.

Trade-off yang diterima: kalau roster menyusut (admin nonaktifkan guide) setelah ada reservasi pool berdasarkan total lama, kapasitas pool bisa terlihat "over" di dashboard — ini sinyal peringatan operasional yang wajar, bukan bug yang perlu ditambal dengan snapshot/freeze kapasitas.

### 9.3 Skema Baru (Prisma)

```prisma
model Muthowif {
  id            String  @id @default(uuid())
  name          String
  bio           String?
  photoUrl      String?
  languages     Json    @default("[]")
  rating        Decimal @default(5.00) @db.Decimal(3, 2)
  dailyCapacity Int     @default(50)
  isActive      Boolean @default(true)
  // priceRegular/Ramadan/Hajj DIHAPUS — harga sekarang di MuthowifServicePrice (§9.3), bukan per-orang

  availability    MuthowifAvailability[]
  bookingMuthowif BookingMuthowif[]
  @@map("muthowif")
}

model MuthowifServicePrice {
  id           String   @id @default(uuid())
  priceRegular Decimal  @db.Decimal(12, 2)
  priceRamadan Decimal  @db.Decimal(12, 2)
  priceHajj    Decimal  @db.Decimal(12, 2)
  updatedAt    DateTime @updatedAt
  @@map("muthowif_service_price")
}
// Singleton — selalu 1 baris, pola sama getOrCreateGlobalRule() di PricingRule
// (app/api/v1/admin/system/settings/pricing-rule/route.ts)

model MuthowifPoolAvailability {
  id           String   @id @default(uuid())
  date         DateTime @db.Date
  pendingCount Int      @default(0)
  bookedCount  Int      @default(0)
  @@unique([date])
  @@map("muthowif_pool_availability")
}
// Kapasitas TIDAK disimpan di sini — dihitung live dari SUM(Muthowif.dailyCapacity WHERE isActive)
// setiap kali reserve/confirm/release dipanggil (§9.2).

model MuthowifAvailability {
  // TIDAK BERUBAH strukturnya — tapi sekarang cuma ditulis dari alur assignment (§9.4),
  // bukan dari booking creation lagi.
}

model BookingMuthowif {
  id         String    @id @default(uuid())
  bookingId  String
  muthowifId String?   // nullable — null = belum di-assign admin
  startDate  DateTime  @db.Date
  endDate    DateTime  @db.Date
  numDays    Int
  numPeople  Int
  totalPrice Decimal   @db.Decimal(14, 2)
  assignedAt DateTime? // baru

  booking  Booking   @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  muthowif Muthowif? @relation(fields: [muthowifId], references: [id])
  @@map("booking_muthowif")
}
```

### 9.4 Fungsi Kuota (`lib/quota/index.ts`)

- `reservePoolMuthowifQuota(tx, date, people)` / `releasePoolMuthowifQuota` / `confirmPoolMuthowifQuota` (**baru**) — pool-level, kapasitas = SUM live seperti §9.2.
- `reserveMuthowifQuota` / `releaseMuthowifQuota` (**dipertahankan**, individual-level) — sekarang dipanggil dari alur assignment (§9.5), bukan dari booking creation.
- `confirmMuthowifQuota` (**baru**, individual-level) — menutup nama literal Gap #1 di level individu.
- `lib/muthowif/assign.ts` (**baru**) — `assignMuthowifToBooking(tx, bookingMuthowifId, muthowifId)`: validasi + reservasi kapasitas individual per hari dalam rentang `startDate`-`endDate`; kalau booking sudah `confirmed` (lunas), langsung panggil `confirmMuthowifQuota` juga di transaksi yang sama (supaya tidak nyangkut di pending selamanya untuk booking yang sudah dibayar sebelum di-assign); set `muthowifId` + `assignedAt`.

### 9.5 Integrasi Booking Lifecycle

- **Booking creation** (`app/api/v1/bookings/route.ts`) — reserve **pool** quota per hari dalam rentang (bukan individual), buat `BookingMuthowif` dengan `muthowifId: null`. `totalPrice` dihitung **server-side** dari `MuthowifServicePrice` + `detectSeason()` (menutup gap harga client-trusted yang dicatat di §6 — sekalian, karena sumber harga sudah direstrukturisasi di fase ini).
- **Payment confirm** (`app/api/v1/admin/payments/[id]/confirm/route.ts`) — tambah `muthowif: true` ke `include` (**menutup Gap #1 KRITIS secara literal**), loop per hari: `confirmPoolMuthowifQuota` selalu; kalau `muthowifId` sudah ke-assign duluan, `confirmMuthowifQuota` (individual) juga.
- **Auto-cancel cron** (`lib/cron/autocancelJob.ts:32-42`) — ganti `releaseMuthowifQuota(tx, bm.muthowifId, date, bm.numPeople)` jadi `releasePoolMuthowifQuota`; kalau `bm.muthowifId` sudah ke-assign, `releaseMuthowifQuota` (individual) juga dipanggil.
- **Self-cancel jamaah** — TIDAK disentuh di fase ini. Gap lama (`docs/arsitektur-umroh.md` §7 Gap #2: self-cancel tidak pernah release kuota apa pun) tetap terbuka, di luar scope — tidak diminta user.

### 9.6 API Routes

| Method | Path | Perubahan |
|---|---|---|
| GET, PUT | `/api/v1/admin/products/muthowif/service-price` | **Baru** — kelola `MuthowifServicePrice` singleton, pola sama `pricing-rule/route.ts` |
| GET, POST | `/api/v1/admin/products/muthowif` | POST: hapus field harga dari payload, tambah validasi Zod (dulu `+b.field` mentah) |
| GET, PUT | `/api/v1/admin/products/muthowif/[id]` | **Baru** — edit roster (name/bio/languages/dailyCapacity/isActive). Tidak ada DELETE (dipakai histori `BookingMuthowif`, nonaktifkan bukan hapus, sama pola modul lain) |
| POST | `/api/v1/admin/bookings/[id]/muthowif/assign` | **Baru** — body `{ muthowifId }`, jalankan `assignMuthowifToBooking()` |
| GET | `/api/v1/catalog/muthowif` | Disederhanakan jadi showcase-only — hapus `pricePerDay`/`availability` per-guide, hapus param `start_date`/`end_date` (tidak relevan lagi untuk browsing) |
| POST | `/api/v1/bookings` | Reserve pool quota + hitung `totalPrice` server-side (§9.5) |

### 9.7 Admin UI

- `admin/products/muthowif/page.tsx` — tambah card "Harga Layanan Muthowif" (3 input season, pola sama panel `PricingRule`) di atas list; list dapat link edit per baris ke halaman `[id]/page.tsx` baru (name/bio/languages/dailyCapacity/isActive — **tanpa** upload foto MinIO, `photoUrl` tetap gap terbuka, di luar scope fase ini).
- `admin/bookings/[id]/page.tsx` — tambah card "Muthowif" (pola sama card Hotel yang sudah ada di file ini): kalau `booking.muthowif` ada dan `muthowifId` null → tampilkan form assign (dropdown roster aktif + tombol, client component baru `MuthowifAssignPanel.tsx` pola sama `PaymentActions.tsx`); kalau sudah ke-assign → tampilkan nama + `assignedAt`.
- `admin/quotas/page.tsx` — section Muthowif diganti dari daftar flat per-guide jadi tabel pool per-tanggal (pending/booked/kapasitas-live/tersedia), pola mirip section Hotel yang sudah ada — menutup Gap #8 dengan bentuk baru yang sesuai model pool.

### 9.8 Publik & Wizard

- `(public)/muthowif/page.tsx`, `[id]/page.tsx`, `(public)/page.tsx` (featured section) — jadi showcase murni: nama, bio, foto (masih `UserRound` generik — §9.7 tidak menutup Gap #2), bahasa, rating, kapasitas harian. **Hapus** harga per-kartu; ganti dengan satu blok harga layanan (fetch `MuthowifServicePrice` sekali, tampil sebagai info umum "Harga layanan mulai Rp X/hari" di header section, bukan per-profil).
- `bookings/new/muthowif/page.tsx` — dirombak total: bukan lagi grid pilih 1 dari N guide, tapi form sederhana "Tambahkan layanan muthowif?" (toggle) + `numPeople` (default `totalPilgrims`) + tanggal (default rentang `departureDate`-`returnDate`) + harga live dari `MuthowifServicePrice`+season. Tidak ada roster ditampilkan di sini (roster showcase cukup di katalog publik, wizard tetap minimal sesuai "yang penting orang order").
- `lib/booking/draft.ts` — `MuthowifSelection`: hapus `muthowifId`, `name`; jadi `{ startDate, endDate, numDays, numPeople, pricePerDay }`.
- `lib/validators/booking.ts` — `muthowif` object: hapus `muthowifId` dan `totalPrice` (server hitung ulang, §9.5).
- `components/booking/PriceSidebar.tsx` — label ganti dari `draft.muthowif.name` jadi teks statis "Layanan Muthowif".

### 9.9 Blast Radius (grep 2026-07-20)

```
muthowifId / .muthowif. / priceRegular pada Muthowif:
  app/[locale]/(pilgrim)/bookings/new/muthowif/page.tsx
  app/[locale]/(pilgrim)/bookings/new/payment/page.tsx
  app/[locale]/(public)/muthowif/[id]/page.tsx
  app/[locale]/(public)/muthowif/page.tsx
  app/[locale]/(public)/page.tsx              (featured section — m.priceRegular, tidak lolos grep pertama)
  app/[locale]/admin/(protected)/quotas/page.tsx
  app/[locale]/admin/(protected)/bookings/[id]/page.tsx   (fetch muthowif, belum pernah dirender)
  app/api/v1/admin/products/muthowif/route.ts
  app/api/v1/bookings/route.ts
  app/api/v1/catalog/muthowif/route.ts
  app/api/v1/admin/payments/[id]/confirm/route.ts
  components/booking/PriceSidebar.tsx
  lib/booking/draft.ts
  lib/cron/autocancelJob.ts
  lib/quota/index.ts
  lib/validators/booking.ts
```

~15 file — sebanding Transport §9. Refactor pada modul existing dengan konsumen berantai (schema → quota → booking creation → payment confirm → cron → admin UI → publik → wizard), jadi Fase 0-6 di bawah dieksekusi sebagai satu rangkaian berkelanjutan (deviasi Fase Eksekusi SOP yang sama seperti Hotel §10/Transport §9), verifikasi menyeluruh di Fase 6.

### 9.10 Fase Eksekusi — SELESAI & TERVERIFIKASI (2026-07-20)

1. **Fase 0 — Schema + migrasi** ✓ — §9.3 diterapkan, migrasi `20260720000000_muthowif_pool_assignment_model` dengan shadow DB terverifikasi terpisah. `priceRegular/Ramadan/Hajj` di `Muthowif` dihapus, `MuthowifServicePrice` diseed 1 baris (Rp 300rb/520rb/750rb, representatif dari rata-rata harga per-orang lama). Row count semua tabel diverifikasi sama sebelum/sesudah (0 booking nyata terdampak).
2. **Fase 1 — Fungsi kuota** ✓ — `reservePoolMuthowifQuota`/`releasePoolMuthowifQuota`/`confirmPoolMuthowifQuota`, `confirmMuthowifQuota` (individual), `lib/muthowif/assign.ts` (`assignMuthowifToBooking`, auto-confirm individual kalau booking sudah lunas saat assignment terjadi).
3. **Fase 2 — API routes** ✓ — `service-price` (GET/PUT), `muthowif/[id]` (GET/PUT, baru), `muthowif` POST (Zod, harga dihapus), `bookings/[id]/muthowif/assign` (GET roster + POST assign, baru), `catalog/muthowif` (showcase-only + `meta.pricePerDay`/`season`).
4. **Fase 3 — Booking lifecycle** ✓ — booking creation (pool reserve + `totalPrice` server-side dari `MuthowifServicePrice`), payment confirm (`muthowif: true` ditambah ke include, confirm pool+individual — **Gap #1 KRITIS ditutup**), auto-cancel cron (release pool+individual).
5. **Fase 4 — Admin UI** ✓ — panel harga layanan di list page, halaman edit roster (`[id]/page.tsx`, toggle `isActive`), `MuthowifAssignPanel.tsx` di booking detail admin, tabel pool 30-hari di quotas page.
6. **Fase 5 — Publik & wizard** ✓ — showcase pages (list/detail/homepage, harga flat sekali tampil bukan per-kartu), wizard jadi toggle sederhana (bukan pilih 1 dari N), `draft.ts`/`validator`/`PriceSidebar` disesuaikan, dead code `MuthowifPicker.tsx` dihapus.
7. **Fase 6 — Verifikasi & dokumentasi** ✓ — `bun run build` 0 error. Browser end-to-end: admin list (panel harga terisi dari DB) → edit page → katalog publik (showcase, harga flat sekali tampil) → wizard (toggle sinkron ke `PriceSidebar` dengan label generik "Layanan Muthowif", bukan nama). Script test siklus penuh (`verify_muthowif_tmp.ts`, dijalankan lalu dihapus): booking creation reserve POOL (bukan individual, `muthowifId` tetap `null`) → admin assign (reserve individual, masih pending karena belum lunas) → payment confirm (pool DAN individual pending→booked bersamaan) — semua tahap konsisten. `docs/progress.md`+`docs/decisions.md`+`CLAUDE.md`+§7 diperbarui (Gap #1/#4/#6/#8/#9 DITUTUP).

---

## 10. Integrasi HPP Universal — SELESAI & TERVERIFIKASI (2026-07-20)

> Ditulis & dieksekusi 2026-07-20. User: "tidak ada harga HPP untuk muthowif" — `MuthowifServicePrice` (§9) tadinya harga jual yang diketik admin LANGSUNG (3 kolom season), tanpa dasar HPP/vendor/kurs sama sekali. Berbeda dari Visa/Flight/Hotel/Transport yang semua sudah `computeSellPrice()` (HPP + kurs + margin). Muthowif jadi modul ke-5 yang diintegrasikan ke `docs/arsitektur-harga.md`.

### 10.1 Keputusan Struktural (dikonfirmasi user via AskUserQuestion, 2026-07-20)

| Keputusan | Pilihan |
|---|---|
| Struktur season vs flat | **Satu harga flat, season dihapus** — konsisten dengan Transport (§9.1: "harga vendor riil tidak dipecah per musim"). `computeSellPrice()` tidak punya konsep season (cuma tier per hari), jadi 3 kolom `priceRegular/Ramadan/Hajj` diganti 1 kolom `price` (cache), 1 komponen HPP |

### 10.2 Skema Baru (Prisma)

```prisma
model MuthowifServicePrice {
  id        String   @id @default(uuid())
  price     Decimal  @db.Decimal(12, 2) @default(0) // cache computeSellPrice(), diisi lewat endpoint cost
  updatedAt DateTime @updatedAt

  @@map("muthowif_service_price")
}
// DIHAPUS: priceRegular, priceRamadan, priceHajj — diganti 1 kolom price flat
```

Tetap singleton (selalu 1 baris) — `productId` untuk `ProductCost`/`PreferredVendor` adalah `MuthowifServicePrice.id` milik baris singleton itu sendiri (bukan per-muthowif, karena harga bukan atribut individu — lihat §9.1).

### 10.3 Integrasi Harga

Muthowif paling mirip **Flight** — 1 komponen HPP flat, tidak day-based (jasa pembimbingan bukan sesuatu yang harganya berjenjang per lama hari, sama alasan Flight tidak day-based).

- `costComponent`: `"layanan"` (konstanta `COMPONENT_LAYANAN`), tier flat `[{minDays:0, maxDays:9999, cost}]`.
- `productType`: `'muthowif'`, `productId`: `MuthowifServicePrice.id`.
- `lib/pricing/refreshMuthowifServicePriceCache.ts` (baru) — pola identik `refreshFlightScheduleCache.ts`, `PROBE_DAY = 1`, target `prisma.muthowifServicePrice.update({ data: { price: result.sellPrice } })`.
- Didaftarkan ke cron kurs (`lib/cron/exchangeRateJob.ts`) — `refreshAllMuthowifServicePriceCaches(currencies)`.

**Vendor "Saudinesia" (bukan vendor pihak ketiga sungguhan)** — dikoreksi user setelah eksekusi awal: Muthowif beda dari Visa/Flight/Hotel/Transport karena tidak punya vendor eksternal sungguhan (personal/internal — Saudinesia menetapkan sendiri "harga pasaran" lalu mark-up, bukan beli dari vendor luar). `ProductCost.vendorId` tetap wajib diisi (skema generik dipakai 4 modul lain, tidak diubah demi satu kasus khusus), jadi solusinya: satu vendor tetap bernama **"Saudinesia"** (kategori `'internal'`, dibuat otomatis server-side lewat `getOrCreateSaudinesiaVendor()` di `.../service-price/cost/route.ts`, bukan dipilih admin). Dikonfirmasi via AskUserQuestion: vendor tetap **ditampilkan** di UI (read-only, bukan disembunyikan total) supaya jelas asal datanya kalau diaudit nanti; currency **tetap bisa dipilih** (tidak dikunci ke Rupiah, walau di praktik kemungkinan besar selalu IDR).

### 10.4 API Routes

| Method | Path | Perubahan |
|---|---|---|
| GET | `/api/v1/admin/products/muthowif/service-price` | Disederhanakan — cuma baca `price` ter-cache, **PUT dihapus** (harga tidak lagi diisi manual, cuma lewat HPP) |
| GET, PUT | `/api/v1/admin/products/muthowif/service-price/cost` | **Baru** — HPP editor (currency, hargaLayanan — **tanpa** `vendorId` dari client, vendor "Saudinesia" di-resolve/dibuat otomatis server-side), pola identik `flight/schedules/[id]/cost/route.ts` tapi tanpa pilihan vendor, panggil `refreshMuthowifServicePriceCache()` setelah save |
| GET | `/api/v1/admin/products/muthowif/service-price/simulate` | **Baru** — preview live HPP/harga jual, pola identik `flight/simulate/route.ts` |
| GET | `/api/v1/catalog/muthowif` | Hapus `detectSeason()` dari meta, langsung baca `servicePrice.price` |

### 10.5 Booking Creation

`app/api/v1/bookings/route.ts` — hapus `detectSeason()`+`priceKey` lookup untuk muthowif (import `detectSeason` jadi tidak terpakai di file ini, dihapus), langsung `Number(servicePrice.price)`.

### 10.6 Admin UI

`admin/products/muthowif/page.tsx` — panel "Harga Layanan Muthowif" (3 input season + 1 tombol simpan langsung) diganti total jadi cost editor (currency + harga layanan + preview live HPP/harga jual via endpoint simulate, tombol "Simpan Harga"), pola sama panel cost Flight/Transport — tapi cuma 1 panel (bukan per-row per-vehicle) karena `MuthowifServicePrice` singleton, **dan tanpa dropdown/quick-add vendor** — field vendor cuma teks read-only "Saudinesia" (§10.3), admin tidak pernah memilih atau membuat vendor untuk komponen ini.

### 10.7 Publik & Wizard

`(public)/muthowif/page.tsx`, `[id]/page.tsx`, `(public)/page.tsx` — ganti `Number(servicePrice.priceRegular)` jadi `Number(servicePrice.price)`. Wizard (`bookings/new/muthowif/page.tsx`) dan `catalog/muthowif` meta sudah abstrak dari sumber harga (`meta.pricePerDay`) — tidak perlu ubah wizard, cukup route catalog yang berubah caranya menghitung `pricePerDay`.

### 10.8 Blast Radius (grep 2026-07-20)

```
MuthowifServicePrice / servicePrice.priceRegular:
  app/api/v1/admin/products/muthowif/service-price/route.ts
  app/api/v1/catalog/muthowif/route.ts
  app/api/v1/bookings/route.ts
  app/[locale]/(public)/muthowif/page.tsx
  app/[locale]/(public)/muthowif/[id]/page.tsx
  app/[locale]/(public)/page.tsx
  app/[locale]/admin/(protected)/products/muthowif/page.tsx
```

~7 file inti + 2 file baru (cost, simulate route) + `refreshMuthowifServicePriceCache.ts` + `exchangeRateJob.ts`. Skala kecil (lebih kecil dari §9) — dieksekusi sebagai satu rangkaian berkelanjutan, verifikasi menyeluruh di akhir (deviasi Fase Eksekusi SOP yang sama seperti modul-modul sebelumnya).

### 10.9 Fase Eksekusi — SELESAI & TERVERIFIKASI (2026-07-20)

1. **Fase 0 — Schema + migrasi** ✓ — migrasi `20260720180000_muthowif_service_price_flat`, shadow DB terverifikasi terpisah. Backfill `price` dari `priceRegular` lama (Rp 300.000) supaya tidak kosong selama transisi.
2. **Fase 1 — Cache refresh** ✓ — `refreshMuthowifServicePriceCache.ts` (pola identik Flight) + didaftarkan ke cron kurs (`lib/cron/exchangeRateJob.ts`).
3. **Fase 2 — API routes** ✓ — `service-price` disederhanakan jadi GET-only (baca cache), `service-price/cost` (baru, HPP editor), `service-price/simulate` (baru, preview live), `catalog/muthowif` hapus `detectSeason()` dari meta.
4. **Fase 3 — Booking creation** ✓ — `app/api/v1/bookings/route.ts` hapus `detectSeason()`+lookup season untuk muthowif, langsung `Number(servicePrice.price)`; import `detectSeason` yang jadi tidak terpakai ikut dihapus.
5. **Fase 4 — Admin UI** ✓ — panel 3-input season di `admin/products/muthowif/page.tsx` diganti total jadi cost editor (vendor quick-add kategori `'muthowif'` + currency + harga layanan + preview live HPP/harga jual).
6. **Fase 5 — Publik** ✓ — `(public)/muthowif/page.tsx`, `[id]/page.tsx`, `(public)/page.tsx` — `servicePrice.priceRegular` → `servicePrice.price`.
7. **Fase 6 — Verifikasi & dokumentasi** ✓ — `bun run build` sempat merah (`prisma/seed.ts` masih pakai `priceRegular` lama di seed `MuthowifServicePrice`, diperbaiki jadi `price`), lalu 0 error. Browser end-to-end: admin isi HPP (vendor "Yayasan Pembimbing Haji Makkah", IDR 350.000) → preview live benar (HPP Rp 350.000 tanpa konversi kurs, Harga Jual Rp 400.000 margin 20% dibulatkan) → simpan → `MuthowifServicePrice.price` di DB ter-update ke Rp 400.000 → katalog publik `/muthowif` langsung menampilkan harga baru. `docs/progress.md`+`docs/decisions.md`+`CLAUDE.md` diperbarui.
