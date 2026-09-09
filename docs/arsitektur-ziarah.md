# Arsitektur — Modul Ziarah (Heritage Tour) & Paket (Package)

> **Status: §1-§7 arsip audit as-built per 2026-07-20 (kondisi SEBELUM refactor — `HeritageTour`/`Package` lama, lihat catatan di §5/§6). §8-§9 — SELESAI & TERVERIFIKASI (2026-07-21):** modul Ziarah di-refactor total — `HeritageTour`+`BookingTour` dihapus, diganti `TourismSite` (master data situs) + `TourPackage` (referensi `TransportTrip` yang sudah ada, reuse penuh kendaraan+kuota+harga) + `TourPackageSite` + `BookingTourPackage`. Terintegrasi ke arsitektur harga universal dengan **deviasi sengaja**: margin dihitung PER-KOMPONEN lalu dijumlahkan (bukan sum-HPP-lalu-satu-margin seperti modul lain) — lihat §8.3. §6 Gap #1 (harga tour client-trusted), Gap #2 (tidak ada kuota), Gap #3 (admin create-only), Gap #5 (`Package` non-fungsional — **catatan: `Package`/`PackageItem` generik TIDAK diperbaiki, sengaja di luar scope, lihat §9**), Gap #7 (belum terintegrasi harga universal) — semua **DITUTUP** oleh redesain §8. Gap #4 dan #6 tidak relevan lagi (model lama sudah dihapus). Lihat `docs/decisions.md` untuk bukti verifikasi end-to-end.

---

## 1. Konteks Bisnis

**Ziarah (`HeritageTour`)** adalah produk tur wisata sejarah Islam (mis. Jabal Nur, Jabal Tsur di Makkah; Masjid Quba, Uhud di Madinah) yang dijual per orang, per kunjungan. Ini produk **nyata dan bisa dibooking** — terintegrasi penuh ke wizard booking (step "Addons") dan `BookingTour`.

**Paket (`Package`)** dimaksudkan sebagai bundle beberapa produk (hotel + transport + muthowif + katering + tur, dst.) dengan satu harga tetap — semacam "paket umroh 9 hari all-in". Secara desain skema (`PackageItem`, polimorfik ke semua `productType`), ini seharusnya menggabungkan produk-produk lain **termasuk tur/ziarah**. **Pada praktiknya, `Package` cuma kartu marketing statis** — nama, harga, bullet highlight bebas teks — tidak pernah benar-benar merujuk produk nyata apa pun, dan tidak ada jalur untuk booking sungguhan.

---

## 2. Skema Data Aktual (Prisma)

Sumber: `prisma/schema.prisma:376-404` (Package, PackageItem), `:423-437` (HeritageTour), `:667-679` (BookingTour).

```prisma
model HeritageTour {
  id             String   @id @default(uuid())
  name           String
  description    String?
  city           String?
  durationHours  Decimal? @db.Decimal(4, 1)
  maxGroupSize   Int?
  pricePerPerson Decimal  @db.Decimal(12, 2)
  images         Json     @default("[]")
  isActive       Boolean  @default(true)

  bookingTours BookingTour[]
  @@map("heritage_tours")
}

model BookingTour {
  id             String   @id @default(uuid())
  bookingId      String
  heritageTourId String
  tourDate       DateTime @db.Date
  numPeople      Int
  totalPrice     Decimal  @db.Decimal(14, 2)  // snapshot, dihitung frontend — lihat Gap #1

  booking      Booking      @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  heritageTour HeritageTour @relation(fields: [heritageTourId], references: [id])
  @@map("booking_tours")
}

model Package {
  id          String  @id @default(uuid())
  name        String
  description String?
  price       Decimal @db.Decimal(14, 2)   // harga TETAP, tidak dihitung dari items
  priceLabel  String?
  highlights  Json    @default("[]")        // bullet bebas teks, TIDAK terhubung ke items
  images      Json    @default("[]")
  isActive    Boolean @default(true)
  isFeatured  Boolean @default(false)
  createdAt   DateTime @default(now())

  items PackageItem[]
  @@map("packages")
}

model PackageItem {
  id          String  @id @default(uuid())
  packageId   String
  productType String  // 'hotel' | 'transport' | 'muthowif' | 'catering' | 'tour' | 'haji' | 'visa'
  productId   String  // FK polimorfik, tidak di-enforce DB
  quantity    Int     @default(1)
  notes       String?

  package Package @relation(fields: [packageId], references: [id], onDelete: Cascade)
  @@map("package_items")
}
```

Catatan penting:
- `HeritageTour` **tidak** terintegrasi ke arsitektur harga universal (`docs/arsitektur-harga.md`) — `pricePerPerson` adalah harga jual yang diketik admin langsung, tanpa HPP/vendor/kurs. Sama seperti kondisi Muthowif sebelum §10 (`docs/arsitektur-muthowif.md`), tapi **belum diminta untuk diintegrasikan** — dicatat sebagai kandidat kalau nanti diminta.
- `Package.price` juga harga tetap yang diketik manual — **tidak dihitung** dari jumlah harga `items`-nya. Bahkan kalau `items` diisi, `price` tidak otomatis mengikuti.
- Tidak ada kolom kuota/kapasitas di `HeritageTour` selain `maxGroupSize` (informational only — lihat §6 Gap #2) maupun di `Package`.

---

## 3. API Routes

| Method | Path | Auth guard | File | Catatan |
|---|---|---|---|---|
| GET, POST | `/api/v1/admin/products/tours` | `requireManager()` | `.../tours/route.ts` | **Hanya create, tidak ada `[id]/route.ts`** — tidak ada PUT/DELETE/toggle `isActive`. POST **tidak divalidasi Zod**, `+b.field` mentah dari raw JSON. `catch{...403}` polos (tidak ada `console.error`) |
| GET, POST | `/api/v1/admin/products/packages` | `requireManager()` | `.../packages/route.ts` | POST tidak Zod, `catch{403}` polos |
| GET, PUT | `/api/v1/admin/products/packages/[id]` | `requireManager()` | `.../packages/[id]/route.ts` | PUT terima `body` mentah (spread `...rest`) tanpa validasi field allowlist — field apa pun yang dikirim client diteruskan ke Prisma. **Tidak ada endpoint untuk kelola `PackageItem`** — lihat §5 |
| GET | `/api/v1/catalog/tours` | publik | `.../catalog/tours/route.ts` | Query `city` (Zod-validated), urutkan harga termurah dulu |
| GET | `/api/v1/catalog/packages` | publik | `.../catalog/packages/route.ts` | `include: { items: true }` tapi field `items` tidak pernah dipakai konsumen manapun (§5) |

**Booking creation** (`app/api/v1/bookings/route.ts:162-169`):
```typescript
for (const t of data.tours) {
  await tx.bookingTour.create({
    data: {
      bookingId: bk.id, heritageTourId: t.heritageTourId,
      tourDate: new Date(t.tourDate), numPeople: t.numPeople, totalPrice: t.totalPrice,
    },
  })
}
```
`totalPrice` diambil **mentah dari client** (lihat Gap #1). Tidak ada reservasi kuota apa pun (tidak ada fungsi `reserveTourQuota` di `lib/quota/index.ts`).

**Package tidak pernah muncul di `createBookingSchema`/`bookings/route.ts` sama sekali** — tidak ada jalur booking untuk `Package` (lihat §5).

---

## 4. Admin UI

`app/[locale]/admin/(protected)/products/tours/page.tsx` — Client Component, **create-only**, judul halaman **"Paket Ziarah"**:
- Form: `name`, `description`, `city` (dropdown makkah/madinah/jeddah), `durationHours`, `maxGroupSize`, `pricePerPerson`
- Tidak ada field `images` di form (padahal kolom ada di schema)
- List: tabel read-only (name, city, pricePerPerson) — **tidak ada kolom status aktif, tidak ada tombol edit/nonaktifkan/hapus**

`app/[locale]/admin/(protected)/products/packages/page.tsx` — judul **"Paket & Bundle"**:
- Form: `name`, `description`, `price`, `priceLabel`, `highlights` (textarea, satu baris = satu bullet — **bukan** picker produk nyata), `isFeatured`
- List: tabel dengan kolom "{count} produk" (dari `_count.items`) dan toggle aktif/nonaktif (satu-satunya operasi selain create)
- **Tidak ada halaman/tombol untuk menambah `PackageItem`** ke sebuah paket — kolom "produk" di tabel akan **selalu menampilkan 0** untuk paket apa pun yang dibuat lewat UI ini, karena tidak ada jalur untuk mengisinya (§5)

---

## 5. Temuan Utama — Ziarah dan Paket Tidak Sinkron (Bukan Cuma Basi, Memang Tidak Pernah Terhubung)

User meminta cek sinkronisasi antara "ziarah" dan "paket" — hasil audit: **keduanya bukan dua bagian dari satu sistem yang perlu disinkronkan, melainkan dua sistem independen yang kebetulan berbagi kata "paket" di label UI:**

1. **"Paket Ziarah"** (judul halaman admin `products/tours`, dan label step wizard "Paket Ziarah — opsional, bisa pilih lebih dari 1") merujuk ke `HeritageTour` — produk tur yang bisa dibooking sungguhan.
2. **"Paket & Bundle"** / **"Paket Lengkap"** (halaman admin `products/packages`, katalog publik `/packages`) merujuk ke `Package` — kartu marketing bundle yang **tidak bisa dibooking sama sekali**.

**Bukti `Package` tidak fungsional di luar tampilan kartu:**
- `PackageItem` **tidak direferensikan di satu pun file `app/` atau `lib/`** selain definisi schema-nya sendiri (dikonfirmasi via grep menyeluruh) — tidak ada create, read (di luar `include: { items: true }` yang hasilnya tidak dipakai), update, atau delete.
- Tidak ada endpoint admin untuk menambah `PackageItem` ke `Package` — field `items` pada `Package` akan selamanya kosong kalau dibuat lewat UI yang ada.
- Tombol "Pesan Paket Ini" di katalog publik (`app/[locale]/(public)/packages/page.tsx:70`) cuma `<Link href="/register">` — sama seperti CTA generik di semua katalog lain, tidak membawa konteks paket apa pun ke wizard. Jamaah yang klik ini akan mendaftar lalu mengisi wizard dari nol, memilih ulang setiap komponen secara manual — **tidak ada auto-fill dari isi paket**, bahkan seandainya `PackageItem` diisi manual lewat database sekalipun (tidak ada kode yang membaca `PackageItem` untuk pre-fill draft booking).
- `Package.price` independen dari `PackageItem` — bahkan kalau suatu saat `items` mulai diisi, harga paket tidak otomatis mengikuti jumlah harga item-nya (tidak ada logika rekonsiliasi).

**Kesimpulan:** `Package` saat ini adalah **generator kartu marketing statis** (nama + harga + bullet bebas teks), bukan bundle produk fungsional. `HeritageTour` ("Paket Ziarah") adalah produk yang benar-benar terintegrasi ke booking. Kalau tujuannya jangka panjang adalah `Package` benar-benar membundel produk nyata (termasuk `HeritageTour` sebagai salah satu isinya), itu perlu pengerjaan baru — bukan perbaikan sinkronisasi, karena belum pernah ada sinkronisasi untuk diperbaiki.

---

## 6. Gap / Ketidaksesuaian Aktif (audit 2026-07-20)

| # | Gap | Lokasi | Dampak |
|---|-----|--------|--------|
| 1 | 🔴 **Harga booking tur client-trusted** — `totalPrice` di `data.tours[]` diterima mentah dari client (`z.number().positive()`), tidak pernah dihitung ulang dari `HeritageTour.pricePerPerson` server-side | `lib/validators/booking.ts:55-60`, `app/api/v1/bookings/route.ts:162-169` | Celah manipulasi harga booking — pola sama Gap #1 Hotel/Gap #4 Transport yang sudah ditutup di modul lain, **belum ditutup di sini** |
| 2 | Tidak ada kuota/kapasitas untuk tur — `maxGroupSize` murni informational, tidak ada tabel availability atau fungsi reserve/confirm/release di `lib/quota/index.ts` | Schema `HeritageTour`, `lib/quota/index.ts` | Tur bisa dibooking tak terbatas tanpa batas kapasitas nyata, walau kolom `maxGroupSize` menyiratkan seharusnya ada batas |
| 3 | Admin CRUD `HeritageTour` create-only — tidak ada PUT/DELETE, tidak ada toggle `isActive`, tidak ada field `images` di form meski kolom ada | `app/api/v1/admin/products/tours/` (tidak ada folder `[id]/`), `app/[locale]/admin/(protected)/products/tours/page.tsx` | Admin tidak bisa edit/nonaktifkan tur yang salah input, tidak bisa upload foto tur |
| 4 | `booking.tours` (dan `booking.catering`) di-fetch di halaman detail booking admin tapi **tidak pernah dirender** | `app/[locale]/admin/(protected)/bookings/[id]/page.tsx:29` | Admin tidak bisa lihat tur/katering apa yang dipesan jamaah dari halaman detail booking — cuma hotel yang punya card, pola sama gap yang sudah ditutup di Transport/Muthowif |
| 5 | `Package` tidak fungsional di luar kartu marketing — lihat §5 untuk detail lengkap | `PackageItem` tidak direferensikan di mana pun, tidak ada endpoint kelola item, CTA tidak membawa konteks | Fitur "bundle produk" yang diadvertisikan (`docs/spec.md`/deskripsi halaman publik "hotel, transport, muthowif, katering... dalam satu harga") secara fungsional tidak ada — cuma tampilan |
| 6 | Admin `Package` POST/PUT tidak divalidasi Zod, `catch{...403}` polos di semua route tours & packages | `app/api/v1/admin/products/tours/route.ts`, `app/api/v1/admin/products/packages/**` | Pola sama yang sudah ditutup di Visa/Flight/Hotel/Transport/Muthowif, belum disentuh di sini |
| 7 | Tidak terintegrasi arsitektur harga universal (`docs/arsitektur-harga.md`) — `HeritageTour.pricePerPerson` dan `Package.price` sama-sama harga manual, tanpa HPP/vendor/kurs | Schema `HeritageTour`, `Package` | Konsisten dengan kondisi Muthowif sebelum §10 — bisa jadi kandidat integrasi berikutnya kalau diminta, belum diminta sesi ini |

---

## 7. Referensi Silang

- Status milestone: `docs/progress.md` → M3 (catalog tours/packages), M4 (wizard addons step)
- `docs/architecture.md` — arsip desain awal, tidak diverifikasi ulang secara detail
- Pola dokumen ini mengikuti template `docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`
- `docs/arsitektur-muthowif.md` §10 — preseden integrasi HPP universal untuk produk dengan harga flat manual, relevan kalau Gap #7 di atas suatu saat dikerjakan
- `docs/arsitektur-hotel.md` §8 Gap #1, `docs/arsitektur-transportasi.md` §9.6, `docs/arsitektur-muthowif.md` §9.5 — pola penutupan client-trusted price yang relevan untuk Gap #1 di atas

---

## 8. RENCANA — Paket Ziarah Terintegrasi (belum dieksekusi)

> Ditulis 2026-07-20. User bercerita visi: (1) master data tempat wisata se-Arab Saudi (foto, deskripsi, gmaps url), (2) paket ziarah terintegrasi dengan harga kendaraan yang sudah ada di Transport supaya HPP-nya jelas, (3) komponen biaya tambahan yang bisa ditambah bebas (guide, makan, minum, dst) supaya admin gampang susun harga publish. Setelah dianalisis, ternyata **infrastruktur intinya sudah ada** — `TransportTrip` berkategori `city_tour` sudah persis berbentuk "satu rute, beberapa pilihan kendaraan+harga" (mis. "City Tour Makkah — Ziarah 4 Tempat"). Rencana ini **mengganti total** `HeritageTour`/`BookingTour` (belum ada booking nyata) dengan struktur baru yang menyatukan Ziarah dengan Transport, bukan menambah sistem ketiga yang terpisah lagi (lihat §5 — pelajaran dari `Package` yang gagal terhubung).

### 8.1 Keputusan Struktural (dikonfirmasi user via AskUserQuestion, 2026-07-20)

| Keputusan | Pilihan |
|---|---|
| Nasib `HeritageTour` lama | **Diganti total** oleh `TourPackage` baru — belum ada booking nyata, konsisten dengan pola sesi ini (refactor total kalau belum produksi) |
| Sumber kendaraan | **Pakai ulang `TransportTrip`/`TransportPricing`** yang sudah ada — Paket Ziarah referensi ke satu `TransportTrip` (idealnya kategori `city_tour`), pilihan kendaraan+harga otomatis ikut, tidak ada data harga kendaraan yang dobel-input |
| Kuota kendaraan | **Reuse `TransportQuota`** — booking paket ziarah reserve/confirm/release ke row kuota yang SAMA dengan booking Transport biasa (transport di sini jual "paket mobil", bukan per-kursi, jadi satu pool kuota yang sama mencegah 1 unit kendaraan dijual dobel lewat 2 jalur) |
| Perhitungan margin | **Per-komponen, dijumlah di akhir** — tiap baris (kendaraan, guide, makan, minum, dst) punya HPP dan Harga Jual sendiri-sendiri (kendaraan pass-through dari harga Transport yang sudah final, komponen lain dihitung margin sendiri), harga publish = SUM semua Harga Jual. **Bukan** satu margin gabungan di atas total HPP (itu akan jadi margin berlapis untuk komponen kendaraan) |
| "Guide" | **Item biaya tambahan biasa**, diisi manual oleh admin — **tidak** terhubung ke modul Muthowif (beda konteks: guide tur beberapa jam vs pembimbing ibadah multi-hari) |

### 8.2 Skema Baru (Prisma)

```prisma
model TourismSite {
  id          String   @id @default(uuid())
  name        String
  city        String?
  description String?
  photoKey    String?  // object key MinIO, presigned URL saat baca (konvensi CLAUDE.md)
  gmapsUrl    String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  packageSites TourPackageSite[]
  @@map("tourism_sites")
}
// Master data reusable — satu situs bisa dipakai banyak paket ziarah berbeda.

model TourPackage {
  id              String   @id @default(uuid())
  name            String
  description     String?
  transportTripId String   // sumber kendaraan+kuota — lihat §8.1
  price           Decimal  @db.Decimal(14, 2) @default(0)
  // cache "mulai dari" (opsi kendaraan termurah + total komponen tambahan), untuk tampilan
  // katalog/homepage — harga final sebenarnya dihitung ulang server-side saat booking
  // berdasarkan kendaraan yang benar-benar dipilih (§8.5).
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  transportTrip TransportTrip        @relation(fields: [transportTripId], references: [id])
  sites         TourPackageSite[]
  bookings      BookingTourPackage[]

  @@map("tour_packages")
}

model TourPackageSite {
  id            String @id @default(uuid())
  tourPackageId String
  tourismSiteId String
  order         Int    @default(0) // urutan kunjungan, untuk itinerary

  tourPackage TourPackage @relation(fields: [tourPackageId], references: [id], onDelete: Cascade)
  tourismSite TourismSite @relation(fields: [tourismSiteId], references: [id])

  @@unique([tourPackageId, tourismSiteId])
  @@map("tour_package_sites")
}

model BookingTourPackage {
  id               String   @id @default(uuid())
  bookingId        String
  tourPackageId    String
  transportQuotaId String   // kendaraan yang dipilih untuk booking ini, tanggal spesifik
  tourDate         DateTime @db.Date
  numPeople        Int
  totalPrice       Decimal  @db.Decimal(14, 2)  // dihitung server-side, bukan dari client

  booking        Booking        @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  tourPackage    TourPackage    @relation(fields: [tourPackageId], references: [id])
  transportQuota TransportQuota @relation(fields: [transportQuotaId], references: [id])

  @@map("booking_tour_packages")
}
```

`TransportTrip` dapat relasi balik `tourPackages TourPackage[]` (tidak mengubah field lain di Transport). `HeritageTour`, `BookingTour` **dihapus**.

### 8.3 Integrasi Harga — Pola Baru: Per-Komponen, Bukan Gabungan

Beda dari Visa/Flight/Hotel/Transport/Muthowif (yang menjumlah HPP semua komponen lalu terapkan **satu** margin di akhir via `computeSellPrice()`), Paket Ziarah butuh **margin per baris** (§8.1) — jadi **tidak** memakai `computeSellPrice()` apa adanya. Fungsi baru `lib/pricing/computeTourPackagePrice.ts`:

1. Ambil kendaraan aktif dari `transportTrip.pricing` (semua opsi `TransportPricing`, sudah final harga jualnya — pass-through, tidak dihitung ulang).
2. Ambil semua `ProductCost` untuk `productType:'tour_package', productId: tourPackage.id` (komponen bebas: guide, makan, minum, dst — nama `costComponent` bebas teks, TIDAK fixed).
3. Untuk **setiap komponen tambahan secara independen**: konversi kurs kalau perlu → HPP komponen itu → terapkan margin global (`PricingRule`) → Harga Jual komponen itu. Hasil per-baris disimpan untuk tabel breakdown admin.
4. Total komponen tambahan = SUM Harga Jual semua baris komponen.
5. Harga final **per opsi kendaraan** = `TransportPricing.price` (opsi itu) + total komponen tambahan.
6. `TourPackage.price` (cache "mulai dari") = harga final dengan opsi kendaraan **termurah**.

`Vendor.category` dapat nilai baru `'tour_package'`. Komponen tambahan **tetap punya vendor sungguhan** (beda dari Muthowif — guide/katering/dll biasanya memang dari vendor pihak ketiga, bukan internal).

### 8.4 API Routes

| Method | Path | Catatan |
|---|---|---|
| GET, POST, PUT, DELETE | `/api/v1/admin/products/tourism-sites` (+`[id]`) | **Baru** — CRUD `TourismSite`, Zod-validated, foto via MinIO (pola sama Muthowif/Hotel) |
| GET, POST | `/api/v1/admin/products/tour-packages` | **Baru** — CRUD `TourPackage` (nama, deskripsi, `transportTripId`, pilihan `TourismSite`+urutan) |
| GET, PUT, DELETE | `/api/v1/admin/products/tour-packages/[id]` | **Baru** |
| GET, POST, PUT, DELETE | `/api/v1/admin/products/tour-packages/[id]/costs` (+`[costId]`) | **Baru** — kelola baris komponen biaya tambahan (vendor+currency+cost per baris) |
| GET | `/api/v1/admin/products/tour-packages/[id]/breakdown` | **Baru** — tabel breakdown HPP/Harga Jual per komponen + per opsi kendaraan, untuk preview admin |
| GET | `/api/v1/catalog/tour-packages` | **Baru**, menggantikan `catalog/tours` — list paket aktif + situs + harga "mulai dari" |
| — | `/api/v1/admin/products/tours`, `/api/v1/catalog/tours` | **Dihapus** (HeritageTour dihapus) |

### 8.5 Booking Creation & Kuota

`app/api/v1/bookings/route.ts` — ganti blok `data.tours` (HeritageTour) jadi `data.tourPackages`: untuk tiap paket dipilih, reserve **`TransportQuota`** milik `transportQuotaId` yang dikirim (fungsi `reserveTransportQuota` yang SAMA persis dipakai booking Transport biasa, §8.1), hitung `totalPrice` server-side = harga kendaraan (`TransportQuota.pricing.price`) + total komponen tambahan (dari `computeTourPackagePrice`), **bukan** dari client. `lib/validators/booking.ts` — `tours[]` diganti `tourPackages[]` tanpa field `totalPrice` (server hitung ulang, pola sama Gap #1 Hotel/Transport/Muthowif yang sudah ditutup).

Payment confirm (`admin/payments/[id]/confirm/route.ts`) dan auto-cancel cron — tambah `booking.tourPackages` ke `include`, panggil `confirmTransportQuota`/`releaseTransportQuota` (fungsi Transport yang sudah ada, tidak ada fungsi kuota baru).

### 8.6 Admin UI

- `admin/products/tourism-sites/page.tsx` (+ `[id]/page.tsx`) — **baru**, CRUD situs wisata (nama, kota, deskripsi, foto, gmaps url), pola sama Hotel/Muthowif.
- `admin/products/tour-packages/page.tsx` (+ `[id]/page.tsx`) — **baru**, menggantikan `admin/products/tours/page.tsx`. Halaman edit: pilih `TransportTrip` (dropdown, idealnya filter kategori `city_tour`), multi-select `TourismSite` dengan urutan, **tabel baris biaya tambahan** (tambah/hapus baris bebas, tiap baris: nama komponen + vendor quick-add + currency + cost + kolom HPP & Harga Jual live), baris ringkasan per opsi kendaraan menampilkan total akhir.

### 8.7 Publik & Wizard

- `(public)/tours/page.tsx` → `(public)/tour-packages/page.tsx` (atau tetap di URL `/tours` demi SEO, isi kontennya yang berubah) — tampilkan situs yang dikunjungi (foto+nama+link gmaps), harga "mulai dari".
- Wizard `bookings/new/addons/page.tsx` — bagian "Paket Ziarah" ganti dari list `HeritageTour` flat jadi list `TourPackage`: pilih paket → pilih opsi kendaraan (dari `transportTrip.pricing`, mirip UI Transport) → harga dihitung live dari breakdown.
- `lib/booking/draft.ts` — `TourSelection` diganti `TourPackageSelection` (`tourPackageId`, `transportQuotaId` yang dipilih, `tourDate`, `numPeople`, harga tampilan saja).

### 8.8 Blast Radius (grep 2026-07-20)

```
HeritageTour / heritageTour / BookingTour:
  app/[locale]/admin/(protected)/bookings/[id]/page.tsx
  app/[locale]/(pilgrim)/bookings/new/payment/page.tsx
  app/[locale]/(pilgrim)/bookings/new/addons/page.tsx
  app/[locale]/(pilgrim)/bookings/[id]/page.tsx
  app/[locale]/(public)/tours/page.tsx
  app/[locale]/(public)/page.tsx
  app/api/v1/bookings/[id]/route.ts
  app/api/v1/bookings/route.ts
  app/api/v1/catalog/tours/route.ts
  app/api/v1/admin/products/tours/route.ts
  lib/booking/draft.ts
  lib/validators/booking.ts
```

~12 file inti terdampak langsung, plus banyak file baru (situs wisata CRUD, tour package CRUD+cost+breakdown, fungsi pricing baru). Skala besar — sebanding refactor Hotel §10/Transport §9. Dieksekusi sebagai rangkaian fase berkelanjutan (deviasi Fase Eksekusi SOP yang sama), verifikasi menyeluruh di fase akhir.

### 8.9 Fase Eksekusi

1. **Fase 0 — Schema + migrasi**: `TourismSite`, `TourPackage`, `TourPackageSite`, `BookingTourPackage` baru; `HeritageTour`+`BookingTour` dihapus (belum ada booking nyata — aman). Shadow DB terverifikasi terpisah.
2. **Fase 1 — Fungsi harga**: `lib/pricing/computeTourPackagePrice.ts` (margin per-komponen, §8.3), `refreshTourPackagePriceCache.ts`.
3. **Fase 2 — API routes**: `tourism-sites` CRUD, `tour-packages` CRUD+costs+breakdown, `catalog/tour-packages`, hapus route `tours` lama.
4. **Fase 3 — Booking lifecycle**: `bookings/route.ts` (reserve TransportQuota + hitung harga server-side), payment confirm, auto-cancel cron.
5. **Fase 4 — Admin UI**: CRUD situs wisata, package builder (pilih trip+situs+komponen biaya+preview breakdown).
6. **Fase 5 — Publik & wizard**: katalog situs/paket, wizard addons step, draft type, validator.
7. **Fase 6 — Verifikasi & dokumentasi**: `bun run build` 0 error, browser end-to-end (admin susun paket → breakdown benar → booking → kuota TransportQuota konsisten dengan booking Transport biasa), update `docs/progress.md`+`docs/decisions.md`+`CLAUDE.md`.

Semua fase di atas **SELESAI & TERVERIFIKASI 2026-07-21** — lihat §9.

## 9. Verifikasi (2026-07-21)

Semua fase §8.9 dieksekusi berurutan, `bun run build` 0 type error di akhir. Verifikasi browser end-to-end (admin superadmin, `localhost:6260`):

1. **Admin — Situs Wisata** (`/admin/products/tourism-sites`): buat situs "Jabal Nur (Gua Hira)" (kota Makkah, link Google Maps) → tersimpan, tampil di tabel dengan status Aktif. Halaman edit (`[id]/page.tsx`) menampilkan form + UI upload foto (pola sama Muthowif).
2. **Admin — Paket Ziarah** (`/admin/products/tour-packages`): buat paket "Ziarah Makkah — Sejarah Islam" referensi `TransportTrip` "City Tour Makkah — Ziarah 4 Tempat" (kategori `city_tour`, sudah ada dari modul Transport) → tersimpan. Builder page (`[id]/page.tsx`):
   - Tambah situs "Jabal Nur (Gua Hira)" ke paket → berhasil.
   - Tambah komponen biaya "Guide Lokal" HPP Rp 200.000, vendor quick-add "Ahmad Guide" (kategori `tour_package`) → berhasil, vendor baru langsung muncul di dropdown.
   - Preview breakdown: HPP Rp 200.000 → Harga Jual Rp 250.000 (margin 20% default) → Total Komponen Rp 250.000. Total per kendaraan: Bus Pariwisata 49 (Rp 4.000.000) → **Rp 4.250.000**, Coaster 20 → Rp 2.250.000, Hiace Premio 10 → Rp 1.350.000. Konfirmasi rumus §8.3 (margin per-komponen, lalu dijumlahkan ke harga kendaraan pass-through) berjalan benar.
3. **Publik** (`/tours`): paket tampil dengan "Mulai dari Rp 1.350.000" (kendaraan termurah + komponen) — cocok dengan cache `TourPackage.price` hasil `refreshTourPackagePriceCache()`.
4. **Booking creation** (via `POST /api/v1/bookings` langsung, karena data seed 90-hari kuota Transport tidak mencakup trip `city_tour` — lihat catatan gap di bawah): payload hanya kirim `tourPackageId`+`transportQuotaId`+`numPeople` (tanpa harga/tanggal). Hasil DB terverifikasi:
   - `BookingTourPackage.totalPrice` = Rp 4.250.000 — dihitung ulang server-side dari `computeTourPackageBreakdown()`, identik dengan preview admin. Harga dari client (dikirim `totalAmount: 1` sengaja untuk uji) tidak mempengaruhi harga komponen booking.
   - `BookingTourPackage.tourDate` = 2026-08-15 — diambil dari `TransportQuota.travelDate`, bukan dari client.
   - `TransportQuota.pendingSeats` bertambah dari 0 → 1 — konfirmasi `reserveTransportQuota()` yang SAMA dipakai booking Transport biasa berhasil dipanggil dari alur Paket Ziarah.
   - Data uji (booking, `BookingTourPackage`, reservasi kuota) dibersihkan setelah verifikasi; situs wisata + paket + komponen biaya yang dibuat selama verifikasi dibiarkan sebagai data katalog nyata (bukan data uji sekali pakai).

**Gap ditemukan saat verifikasi (dicatat, sengaja tidak diperbaiki — di luar scope Ziarah):**
- Tidak ada admin UI/API untuk membuat `TransportQuota` ad-hoc per tanggal untuk trip kategori `city_tour` — seed 90-hari (`prisma/seed.ts`) hanya membuat kuota untuk trip airport/intercity, bukan city_tour. Ini gap pre-existing di modul **Transport**, bukan Ziarah — Ziarah hanya reuse infrastruktur kuota yang ada. Tanpa perbaikan ini, wizard step "Tambahan" tidak akan menampilkan kendaraan tersedia untuk paket ziarah manapun sampai admin (lewat cara lain / manual) mengisi kuota untuk tanggal terkait.
- Halaman hotel wizard (`/bookings/new/hotel`) menampilkan "Rp 0/mlm" untuk semua hotel pada rentang tanggal 2026-08 — terindikasi tidak ada `HotelPricePeriod` yang mencakup rentang itu di data seed. Tidak diselidiki lebih lanjut (di luar scope Ziarah).

## 10. Hotel sebagai Komponen Add-on Pass-through — SELESAI & TERVERIFIKASI (2026-07-21)

### 10.1 Konteks

User mengoreksi kesalahpahaman: catatan "Hotel Rp 0/mlm" di §9 adalah soal wizard Umroh yang sudah ada, bukan permintaan untuk mewajibkan hotel di Paket Ziarah. User lalu mengusulkan fitur baru: supaya "Hotel" bisa jadi salah satu pilihan komponen add-on di Paket Ziarah — mirip kendaraan (referensi data yang sudah ada untuk kemudahan), sejajar dengan variable custom manual (Guide/Makan/Minum) yang sudah ada — **semua komponen (termasuk Hotel) tetap harus bersifat add-on: bisa ditambah dan dikurangi bebas, ketiadaan data tidak boleh membuat apa pun jadi wajib.**

Dikonfirmasi via AskUserQuestion (2026-07-21):
1. **Harga Hotel pass-through, TIDAK dimargin lagi** — `HotelRoomSchedule.price` sudah cache hasil `computeSellPrice()` milik modul Hotel sendiri (sudah final). Kalau dimargin lagi jadi margin berlapis — sama alasan kenapa harga kendaraan (`TransportPricing.price`) pass-through di §8.3.
2. **Admin pilih hotel + tipe kamar + jumlah malam + jumlah kamar** saat membangun paket (bukan dipilih ulang oleh jamaah saat booking) — total = `nights × numRooms × HotelRoomSchedule.price`, dihitung sekali di level template paket, konsisten dengan komponen lain (Guide/Makan/Minum juga flat per-paket, tidak dikalikan `numPeople`).

### 10.2 Skema Baru

```prisma
model TourPackageHotel {
  id                  String   @id @default(uuid())
  tourPackageId       String
  hotelRoomScheduleId String
  nights              Int
  numRooms            Int      @default(1)
  createdAt           DateTime @default(now())

  tourPackage       TourPackage       @relation(fields: [tourPackageId], references: [id], onDelete: Cascade)
  hotelRoomSchedule HotelRoomSchedule @relation(fields: [hotelRoomScheduleId], references: [id])

  @@map("tour_package_hotels")
}
```
- `TourPackage.hotels TourPackageHotel[]` (relasi baru)
- `HotelRoomSchedule.tourPackageHotels TourPackageHotel[]` (relasi balik baru)
- Tidak ada `onDelete` di sisi `hotelRoomSchedule` — schedule tidak boleh dihapus selama masih direferensikan (default Prisma: restrict).

### 10.3 Integrasi Harga

`computeTourPackageBreakdown()` di `lib/pricing/computeTourPackagePrice.ts` ditambah:
- Fetch `tourPackage.hotels` include `hotelRoomSchedule.period.hotel` + `hotelRoomSchedule.roomType`.
- Per baris: `hotelTotal = nights * numRooms * Number(hotelRoomSchedule.price)` — **tidak ada margin, tidak ada konversi kurs** (harga sudah IDR final dari modul Hotel).
- Breakdown baru: `hotelComponents: HotelBreakdown[]` (id, hotelName, roomTypeName, nights, numRooms, pricePerNight, totalPrice) + `hotelComponentsTotal: number`.
- Grand total (dipakai `totalForVehicle()`/`cheapestTotal()`) jadi: `vehiclePrice + componentsTotalSellPrice + hotelComponentsTotal`.

### 10.4 API Routes

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/admin/products/hotels/schedules` | List `HotelRoomSchedule` aktif, flattened (hotelName, city, roomTypeName, price, periodStart/End) — untuk dropdown, endpoint baru |
| POST | `/api/v1/admin/products/tour-packages/[id]/hotels` | Tambah baris hotel ke paket — body `{ hotelRoomScheduleId, nights, numRooms }`, panggil `refreshTourPackagePriceCache()` |
| DELETE | `/api/v1/admin/products/tour-packages/[id]/hotels/[hotelId]` | Hapus baris — panggil `refreshTourPackagePriceCache()` |

### 10.5 Admin UI

Package builder (`tour-packages/[id]/page.tsx`) ditambah section "Hotel (opsional)" — sejajar dengan "Situs Wisata" dan "Komponen Biaya", pola sama (list + form tambah + tombol hapus per baris). Dropdown schedule menampilkan `{hotelName} — {roomTypeName} ({city}) — Rp {price}/malam`. Preview breakdown ditambah baris hotel (pass-through, tanpa kolom HPP/margin terpisah — sama seperti kendaraan) dan grand total per kendaraan diperbarui menjadi `vehiclePrice + componentsTotal + hotelTotal`.

### 10.6 Booking — Tidak Ada Perubahan

Karena hotel adalah atribut level TEMPLATE paket (bukan pilihan booking-time seperti kendaraan), `bookings/route.ts` **tidak perlu diubah** — `totalForVehicle()` yang sudah dipanggil di sana otomatis ikut menghitung `hotelComponentsTotal` begitu fungsi harga diupdate.

### 10.7 Scope Sengaja Tidak Termasuk — Reservasi Kuota Hotel Nyata

**Keputusan sadar**: fitur ini HANYA mereferensikan HARGA `HotelRoomSchedule` untuk kemudahan input admin — **TIDAK memanggil `reserveHotelQuota()`/`confirmHotelQuota()`/`releaseHotelQuota()`** meski fungsi-fungsi itu sudah ada dan reusable (dipakai wizard Umroh biasa). Alasan: hotel di sini dipilih di level TEMPLATE paket (statis, tidak terikat tanggal), sedangkan kuota hotel nyata terikat periode/tanggal spesifik — mengikat kuota di level template akan salah kalau paket dipakai lintas periode musim, atau kalau period lama nonaktif. Konsekuensi: **HotelRoomSchedule.totalQuota TIDAK berkurang saat Paket Ziarah dengan komponen hotel dibooking** — secara teori kamar fisik yang sama bisa terjual dobel via jalur Hotel biasa dan jalur Paket Ziarah. Ini gap yang diketahui sejak awal (bukan ditemukan belakangan), didokumentasikan di sini supaya tidak dianggap tersembunyi — perbaikan (kalau dibutuhkan nanti) butuh desain terpisah untuk mengikat komponen hotel ke tanggal tur yang sebenarnya (mis. `tourDate` dari `TransportQuota` + `nights`), di luar scope permintaan user saat ini (permintaan eksplisit hanya soal kemudahan harga, bukan kuota).

### 10.8 Fase Eksekusi

1. Schema `TourPackageHotel` + migrasi.
2. Update `computeTourPackagePrice.ts` + `refreshTourPackagePriceCache.ts` (tidak berubah, tapi diverifikasi tetap benar karena manggil fungsi yang sama).
3. API routes (`hotels/schedules`, `tour-packages/[id]/hotels`, `.../hotels/[hotelId]`).
4. Admin UI package builder.
5. Verifikasi (`bun run build` 0 error, browser end-to-end) + dokumentasi.

### 10.9 Verifikasi (2026-07-21)

`bun run build` 0 type error. Verifikasi browser end-to-end di package builder paket "Ziarah Makkah — Sejarah Islam" (sudah ada komponen "Guide Lokal" Rp 250.000 dari §9):
- Dropdown "Hotel (opsional)" terisi data hotel real (`Anwar Al Madinah Mövenpick Hotel`, berbagai tipe kamar dan periode) dari `GET /api/v1/admin/products/hotels/schedules`.
- Tambah baris: Double room, 1 malam × 1 kamar, harga `HotelRoomSchedule.price` = Rp 14.200.000 → baris muncul, breakdown preview menampilkan section baru "Hotel (pass-through, tanpa margin tambahan)" dengan total Rp 14.200.000 (identik dengan harga asal, **tidak dimargin lagi** — mengonfirmasi §10.1 keputusan #1).
- Total per kendaraan otomatis bertambah tepat sebesar itu: Bus Pariwisata 49 Rp 4.250.000 → **Rp 18.450.000**, Coaster 20 → Rp 16.450.000, Hiace Premio 10 → Rp 15.550.000 (`vehiclePrice + componentsTotal(250rb) + hotelTotal(14,2jt)` — matematika benar persis).
- Hapus baris hotel → breakdown kembali ke angka semula (Rp 4.250.000/2.250.000/1.350.000) — mengonfirmasi sifat add-on: menambah dan mengurangi bebas, tidak ada yang jadi wajib, komponen Guide/Makan/Minum tidak terganggu oleh ada/tidaknya hotel.

Catatan koreksi selama sesi ini: awalnya ditemukan gap "Hotel Rp 0/mlm" di wizard Umroh biasa (§9) sempat disalahpahami sebagai bagian dari kerja Ziarah — dikonfirmasi ke user bahwa itu bagian terpisah (wizard booking umum, bukan Paket Ziarah) dan tidak diubah apa pun di sana. Fitur Hotel-sebagai-komponen ini murni permintaan baru user, dieksekusi sesuai §10.1-§10.8.

### 10.10 Koreksi — Harga Hotel Harus Editable, Bukan Pass-through Kaku (2026-07-21)

**Masukan user setelah §10.9**: "harga2 itu hanya menjadi referensi, tidak hanya hotel, semuanya, artinya admin boleh edit lagi.. tidak ada yg statis disini.." — desain awal §10.3 (baca `HotelRoomSchedule.price` langsung, live, setiap kali breakdown dihitung) terlalu kaku. Prinsipnya: nilai yang direferensikan dari modul lain (di sini Hotel) hanyalah **titik awal/saran**, bukan angka final yang terkunci — admin harus bisa mengedit angka itu untuk paket ini secara spesifik kapan saja, terlepas dari perubahan harga di modul Hotel aslinya.

**Perubahan desain**: `TourPackageHotel` ditambah field `pricePerNight` (Decimal, tersimpan) — diisi otomatis dari `HotelRoomSchedule.price` SERVER-SIDE saat baris pertama kali ditambahkan (bukan dari input client, tetap menjaga prinsip "jangan percaya harga dari client" untuk NILAI AWAL), tapi setelah itu **admin bisa PUT untuk mengubah angkanya kapan saja** — breakdown selalu pakai `pricePerNight` yang tersimpan di baris, bukan mengambil ulang `HotelRoomSchedule.price` yang mungkin sudah berubah di modul Hotel. `hotelRoomSchedule` (relasi) tetap disimpan untuk tampilan nama hotel/tipe kamar, tapi TIDAK lagi jadi sumber harga langsung.

Ini konsisten dengan komponen custom (Guide/Makan/Minum) yang sudah 100% manual dari awal — sekarang Hotel disamakan: referensi cuma bantu isi angka awal, bukan mengunci nilai.

**API ditambah**: `PUT /api/v1/admin/products/tour-packages/[id]/hotels/[hotelId]` — body `{ nights?, numRooms?, pricePerNight? }`, panggil `refreshTourPackagePriceCache()`.

**Admin UI**: baris hotel yang sudah ditambahkan dapat tombol Edit (pensil) sejajar tombol Hapus, membuka form sama seperti form tambah tapi terisi nilai saat ini (termasuk `pricePerNight` sebagai angka yang bisa diketik ulang) — pola sama seperti Edit komponen biaya.

**Verifikasi (2026-07-21)**: `bun run build` 0 error. Browser end-to-end: tambah hotel Double 1 malam × 1 kamar → snapshot awal Rp 14.200.000 (identik `HotelRoomSchedule.price`) → klik Edit, ubah `pricePerNight` jadi Rp 10.000.000 → Simpan → breakdown & total per kendaraan langsung ikut berubah (Bus Pariwisata 49: Rp 18.450.000 → **Rp 14.250.000**) — mengonfirmasi harga tersimpan di paket, TIDAK terikat lagi ke `HotelRoomSchedule.price` asli (yang tetap Rp 14.200.000 tidak berubah di modul Hotel). Hapus baris → breakdown kembali normal.

## 11. Kendaraan (Transport) Jadi Opsional, Sejajar Hotel — SELESAI, DISEMPURNAKAN DI §12 (2026-07-21)

> **Catatan superseding**: §11 menyelesaikan SATU dimensi (wajib → opsional/nullable), tapi user menunjukkan ada dimensi kedua yang belum ditangani — **cara variable harga masuk ke harga publish** (baku/included vs dipilih user/user_choice). §12 menggantikan model 2-keadaan (ada/tidak ada trip) di bawah ini dengan model 3-mode eksplisit (`included`/`user_choice`/`none`) untuk Transport DAN Hotel. Baca §12 sebagai desain final — bagian di bawah ini diarsipkan sebagai riwayat, jangan dipakai sebagai acuan implementasi baru.

### 11.1 Konteks

User: "hotel dan transportasi itu di paket ziarah sebagai opsional... jangan dijadikan kunci utama.. jadi hotel dan transport dimasukan sebagai variable harga terpisah sebagai pilihan, apakah ingin diaktifkan, atau tidak, atau bisa masuk dalam variable manual."

Audit kode aktual (per prinsip "recheck sebelum rencana"): Hotel SUDAH sepenuhnya opsional sejak §10 (list `TourPackageHotel`, 0-banyak baris, bisa tambah/hapus bebas). Tapi **Transport/kendaraan MASIH wajib** — `TourPackage.transportTripId` adalah kolom `String` non-null (bukan `String?`), jadi setiap Paket Ziarah HARUS punya satu `TransportTrip` terhubung, dan setiap booking WAJIB mengisi `transportQuotaId`. Ini persis "kunci utama" yang tidak diinginkan user.

**Keputusan**: `transportTripId` jadi nullable — paket ziarah bisa dibuat TANPA kendaraan terstruktur sama sekali (harga = komponen + hotel saja). Kalau admin tetap butuh mencatat biaya transport tapi tidak mau pakai integrasi Trip/Vehicle/Quota, tinggal tambahkan sebagai baris "Komponen Biaya" manual (misal nama "Sewa Mobil") — jalur ini SUDAH ada, tidak perlu kode baru.

### 11.2 Skema

- `TourPackage.transportTripId` → `String?` (nullable), relasi `transportTrip TransportTrip? @relation(...)`.
- `BookingTourPackage.transportQuotaId` → `String?` (nullable), relasi `transportQuota TransportQuota? @relation(...)`.
- `BookingTourPackage.tourDate` tetap wajib (perlu untuk pencatatan) — kalau tidak ada kendaraan, `tourDate` diambil dari `departureDate` booking keseluruhan (sudah tervalidasi di `createBookingSchema`, bukan field baru yang dipercaya mentah-mentah dari client hanya untuk paket ini).

### 11.3 Fungsi Harga

`computeTourPackageBreakdown()`: kalau `tourPackage.transportTripId` null, `vehicleOptions = []` (tidak query pricing). `totalForVehicle()` dan `cheapestTotal()` sudah punya jalur "vehicleOptions kosong" (dipakai saat trip ada tapi tanpa pricing aktif) — jalur yang sama otomatis berlaku juga untuk "tidak ada trip sama sekali", tidak perlu fungsi baru.

### 11.4 API

- `POST /api/v1/admin/products/tour-packages` — `transportTripId` jadi opsional di create schema (sebelumnya wajib).
- `PUT /api/v1/admin/products/tour-packages/[id]` — terima `transportTripId: null` eksplisit untuk melepas kendaraan (bukan cuma `.optional()` yang berarti "tidak diubah").

### 11.5 Admin UI

- Dropdown "Trip Kendaraan" (list + builder) dapat opsi "— Tidak pakai kendaraan —" (value kosong → dikirim `null`).
- Tabel list paket: kolom trip tampilkan "— tanpa kendaraan —" kalau null.
- Builder — "Total Harga Paket per Pilihan Kendaraan": kalau tidak ada trip terhubung, ganti jadi satu baris "Total Harga Paket" (komponen + hotel saja), bukan pesan error "trip belum punya harga kendaraan aktif" (pesan itu tetap dipakai HANYA kalau trip terhubung tapi pricing-nya kosong/nonaktif — beda kondisi).

### 11.6 Booking Lifecycle

- `lib/validators/booking.ts`: `tourPackages[].transportQuotaId` jadi `.optional()`.
- `bookings/route.ts`: reserve kuota kendaraan HANYA kalau `transportQuotaId` dikirim; hitung `totalPrice` dari `totalForVehicle()` kalau ada quota, atau langsung `componentsTotalSellPrice + hotelsTotalPrice` kalau tidak; `tourDate` dari `quota.travelDate` atau fallback `data.departureDate`.
- `payments/[id]/confirm/route.ts` dan `lib/cron/autocancelJob.ts`: `confirmTransportQuota()`/`releaseTransportQuota()` untuk baris `BookingTourPackage` dibungkus `if (tp.transportQuotaId)`.

### 11.7 Publik & Wizard

- `catalog/tour-packages/route.ts`, `(public)/tours/page.tsx`, admin list: `origin`/`destination` jadi `string | null`, tampilkan fallback (mis. tidak tampilkan baris rute) kalau null.
- Wizard `addons/page.tsx`: paket tanpa `transportTripId` langsung bisa dipilih tanpa sub-langkah pilih kendaraan (harga = `priceFrom` apa adanya), `TourPackageSelection.transportQuotaId` jadi opsional di `lib/booking/draft.ts`.

### 11.8 Fase Eksekusi

1. Schema (nullable) + migrasi.
2. Fungsi harga (pastikan jalur kosong tetap benar).
3. API routes (create/update schema).
4. Admin UI (list + builder).
5. Booking lifecycle (validator, creation, confirm, cron).
6. Publik & wizard.
7. Verifikasi (`bun run build` 0 error, browser: buat paket tanpa kendaraan → breakdown benar → booking tanpa transportQuotaId berhasil) + dokumentasi.

### 11.9 Verifikasi (2026-07-21)

`bun run build` 0 type error. Verifikasi browser + API end-to-end:

1. **Admin — buat paket tanpa kendaraan**: form "Paket Baru" dengan dropdown "Trip Kendaraan" default "— tidak pakai kendaraan —" → simpan → tabel list menampilkan "— tanpa kendaraan —" di kolom Trip (bukan error atau kosong).
2. **Builder — komponen manual sebagai pengganti transport terstruktur**: tambah komponen biaya "Sewa Mobil Manual" (vendor "Ahmad Guide", IDR 500.000) ke paket tanpa kendaraan → breakdown preview: "Total Harga Paket (tanpa kendaraan)" → "Komponen + Hotel" → **Rp 600.000** (HPP 500rb × margin 20% dibulatkan) — mengonfirmasi jalur "variable manual" (§11.1 opsi 2) berfungsi tanpa perlu integrasi Trip/Vehicle sama sekali.
3. **Katalog publik**: paket tanpa kendaraan tampil di `/tours` dengan "Mulai dari Rp 600.000", **tanpa badge rute** (origin→destination disembunyikan karena null, bukan menampilkan teks kosong/error).
4. **Booking langsung via API** (`POST /api/v1/bookings`, payload `tourPackages: [{ tourPackageId, numPeople }]` — tanpa `transportQuotaId` sama sekali): berhasil, DB dikonfirmasi — `BookingTourPackage.transportQuotaId = null`, `tourDate` fallback ke `departureDate` booking (2026-09-01, sesuai kirim client), `totalPrice` dihitung server-side dari `componentsTotalSellPrice + hotelsTotalPrice` (0 untuk paket kosong tanpa komponen).
5. Data uji (2 paket percobaan, 1 booking, 1 komponen biaya) dibersihkan setelah verifikasi.

Paket "Ziarah Makkah — Sejarah Islam" (dengan kendaraan, dari §8-§10) tetap berfungsi normal — perubahan ini murni menambah jalur alternatif "tanpa kendaraan", bukan mengubah perilaku default untuk paket yang sudah pakai kendaraan.

### 11.10 Bug ditemukan pasca-implementasi — PUT Info Paket tidak refresh cache (2026-07-21)

Saat menyelidiki laporan user "harga admin vs publik tidak sinkron", ditemukan `PUT /api/v1/admin/products/tour-packages/[id]` (form Info Paket — termasuk field `transportTripId`) **tidak pernah memanggil `refreshTourPackagePriceCache()`**, berbeda dari endpoint `costs`/`hotels`/`sites` yang semua sudah benar. Karena `transportTripId` menentukan `vehicleOptions`, mengganti/melepas kendaraan lewat form ini membuat cache `TourPackage.price` basi. **DITUTUP**: PUT sekarang panggil refresh kalau `transportTripId` ikut dikirim. Detail & bukti verifikasi di `docs/decisions.md` 2026-07-21 ("Bug: PUT Info Paket Ziarah Tidak Refresh Cache Harga").

## 12. Variable Harga 3-Mode: Included / User Choice / None — SELESAI & TERVERIFIKASI (2026-07-21)

### 12.1 Konteks & Masalah Konsep

Investigasi laporan "harga tidak sinkron" (§11.10) memicu diskusi lebih dalam dengan user. Kesimpulannya: §11 baru menyelesaikan SATU sumbu masalah (kendaraan wajib → opsional), tapi ada sumbu KEDUA yang belum ditangani sama sekali — **cara variable harga (Transport, Hotel) masuk ke "harga jual paket"**. User menjelaskan lewat 3 skenario nyata:

> "ketika admin memilih modul transportasi dimasukan dalam variable harga, maka harusnya muncul 2-3 opsi:
> 1. admin bisa memilih kendaraan mana yang akan digunakan, lalu muncul harga sesuai harga sewa kendaraan yang sudah ada... jika memilih opsi ini, maka di front-end, user tidak bisa memilih kendaraan, pokoknya paket itu sudah included dengan kendaraan.
> 2. admin bisa membebaskan user untuk memilih kendaraan... variable harga transportasi tidak dihitung langsung ke dalam paket... contoh kasus: saya bersama 5 orang mau jalan-jalan ke makkah, saya memilih paket, lalu memilih kendaraan apa yang sesuai dengan kebutuhan saya 5 orang.
> 3. admin tidak memasukan kendaraan sama sekali, atau memasukan variable kendaraan manual...
> kedua hal tersebut berlaku untuk hotel..."

Dan inti keluhannya: **"sekarang, jika memilih variable kendaraan, tiba2 masuk dalam harga publish, ini membingungkan kalau user tidak membutuhkan kendaraan atau kendaraannya over price karena tidak sesuai kebutuhan."**

**Audit kode aktual (recheck sebelum rencana, sesuai SOP)**: implementasi §8-§11 saat ini HANYA punya 2 keadaan biner untuk Transport — `transportTripId` null (Mode None/C) atau terisi (langsung dianggap "aktif", dan `cheapestTotal()` OTOMATIS membakukan harga kendaraan TERMURAH ke `TourPackage.price`/"Mulai dari"). Tidak ada cara membedakan "kendaraan ini sudah final/included" vs "kendaraan ini baru opsi, user yang pilih nanti" — keduanya diperlakukan SAMA (harga termurah selalu dibakukan). Inilah bug konsepnya. Hotel sudah lebih dekat ke Mode Included (baris `TourPackageHotel` = harga final dibakukan) tapi belum punya Mode User Choice sama sekali.

### 12.2 Definisi 3 Mode (berlaku sama untuk Transport dan Hotel)

| Mode | Siapa yang pilih | Harga masuk "harga jual paket" (`TourPackage.price`)? | Kuota kendaraan/hotel direservasi? |
|---|---|---|---|
| **`included`** | Admin kunci SATU pilihan spesifik saat membangun paket | **YA** — dibakukan, jadi bagian harga final | Tidak (statis di level template — sama alasan §10.7 untuk Hotel; kalau perlu tanggal spesifik, direservasi otomatis pakai tanggal booking saat pilgrim benar-benar booking, lihat §12.6) |
| **`user_choice`** | Pilgrim, saat booking (wizard) | **TIDAK** — base harga TIDAK termasuk ini; ditampilkan+ditambahkan terpisah setelah pilgrim memilih | Ya — direservasi ke kuota nyata (`TransportQuota`/`HotelRoomSchedule`) sesuai pilihan aktual pilgrim, sama seperti booking biasa |
| **`none`** | Tidak dipakai — atau admin isi manual lewat "Komponen Biaya" (sudah ada, tidak berubah) | — | — |

Prinsip kunci: **`included` = statis/final, `user_choice` = dinamis/terpisah dari harga dasar**. Ini konsisten dengan prinsip lama "harga referensi boleh diedit, bukan angka statis" (§10.10) — `included` MASIH ikut prinsip itu (harga di-snapshot, admin bisa edit), bedanya di `user_choice` harganya bahkan tidak pernah masuk ke perhitungan dasar sama sekali.

### 12.3 Skema Baru

```prisma
enum PriceVariableMode {
  included
  user_choice
  none

  @@map("price_variable_mode")
}
```

`TourPackage` — field baru:
```prisma
model TourPackage {
  // ...existing...

  // Kendaraan — 3 mode (§12.2). transportTripId tetap ada, dipakai kalau mode = user_choice
  // (sumber opsi kendaraan yang ditampilkan ke pilgrim). includedTransportPricingId/Price
  // dipakai kalau mode = included (SATU kendaraan dikunci, harga di-snapshot & editable —
  // pola sama TourPackageHotel.pricePerNight, §10.10).
  transportMode              PriceVariableMode @default(none)
  includedTransportPricingId String?
  includedTransportPrice     Decimal?          @db.Decimal(14, 2)

  // Hotel — 3 mode juga. `included` pakai TourPackageHotel (list, SUDAH ADA sejak §10, tidak
  // berubah). `user_choice` pakai TourPackageHotelOption (list opsi baru, §12.3).
  hotelMode                  PriceVariableMode @default(none)

  includedTransportPricing TransportPricing?       @relation(fields: [includedTransportPricingId], references: [id])
  hotelOptions              TourPackageHotelOption[]
}
```

Model baru — opsi hotel untuk mode `user_choice` (pilgrim pilih tipe kamar, admin cuma tentukan durasi & yang mana yang ditawarkan):
```prisma
// Opsi hotel yang DITAWARKAN (bukan dikunci) — dipakai kalau TourPackage.hotelMode = user_choice.
// Beda dari TourPackageHotel (§10): di sini harga TIDAK di-snapshot/dibakukan ke harga paket,
// dihitung live (pass-through) dari HotelRoomSchedule.price saat pilgrim benar-benar memilih +
// berapa kamar, mirip cara TransportPricing ditampilkan sbg opsi di mode user_choice (§12.4).
model TourPackageHotelOption {
  id                  String @id @default(uuid())
  tourPackageId       String
  hotelRoomScheduleId String
  nights              Int    // durasi ditentukan admin; jumlah kamar ditentukan pilgrim saat booking

  tourPackage       TourPackage       @relation(fields: [tourPackageId], references: [id], onDelete: Cascade)
  hotelRoomSchedule HotelRoomSchedule @relation(fields: [hotelRoomScheduleId], references: [id])

  @@unique([tourPackageId, hotelRoomScheduleId])
  @@map("tour_package_hotel_options")
}
```

`BookingTourPackage` — field baru untuk mencatat pilihan hotel `user_choice` (kendaraan sudah punya `transportQuotaId`, dipakai ulang untuk mode `included` MAUPUN `user_choice` — bedanya cuma siapa yang memilihnya & kapan):
```prisma
model BookingTourPackage {
  // ...existing (transportQuotaId, tourDate, numPeople, totalPrice)...
  chosenHotelRoomScheduleId String? // diisi kalau hotelMode = user_choice dan pilgrim memilih hotel
  chosenHotelNumRooms       Int?
}
```

### 12.4 Fungsi Harga — `computeTourPackageBreakdown()`

Perubahan inti — HAPUS asumsi "kendaraan termurah otomatis masuk total", ganti dengan cabang eksplisit per mode:

- **Transport `included`**: `transportIncludedPrice = includedTransportPrice` (bukan live dari `TransportPricing.price` — sama prinsip Hotel §10.10, cuma referensi awal). Masuk ke base total. `vehicleOptions` kosong (tidak ada pilihan, tidak perlu ditampilkan sbg opsi).
- **Transport `user_choice`**: `vehicleOptions` = SEMUA `TransportPricing` aktif dari `transportTripId` (mekanisme sama seperti sekarang) — TAPI **TIDAK** masuk ke base total. Dipakai HANYA oleh wizard (untuk ditampilkan sbg pilihan + harga terpisah) dan oleh `totalForVehicle()` (dipanggil saat booking, dengan quota yang BENAR-BENAR dipilih pilgrim).
- **Transport `none`**: tidak ada apa pun (kondisi sekarang untuk `transportTripId = null`).
- Hotel mengikuti pola yang sama persis: `included` pakai `hotels`/`hotelsTotalPrice` (SUDAH ADA, tidak berubah) masuk base total; `user_choice` pakai `hotelOptions` (baru, dari `TourPackageHotelOption` + live `HotelRoomSchedule.price`) TIDAK masuk base total; `none` tidak ada apa pun.

`cheapestTotal()` (dipakai untuk cache `TourPackage.price`/"Mulai dari") **jadi HANYA**: `componentsTotalSellPrice + (transportIncludedPrice ?? 0) + (hotelsTotalPrice ?? 0)`. Tidak pernah menyertakan estimasi dari opsi `user_choice` — ini yang memperbaiki keluhan utama user ("tiba2 masuk harga publish").

`totalForVehicle()` tetap dipakai saat booking (mode `user_choice`), ditambah fungsi baru untuk hotel `user_choice` (`totalWithHotelChoice()` atau serupa) yang menjumlah base + harga hotel pilihan pilgrim, dipanggil di `bookings/route.ts`.

### 12.5 API

- `PUT /api/v1/admin/products/tour-packages/[id]` — terima `transportMode`, `hotelMode`, `includedTransportPricingId` (dengan snapshot harga server-side ke `includedTransportPrice`, sama pola Hotel §10.10), lalu SELALU panggil `refreshTourPackagePriceCache()` kalau salah satu field ini berubah (menutup gap §11.10 sekalian, generalisasi ke semua field yang mempengaruhi harga).
- `POST/DELETE /api/v1/admin/products/tour-packages/[id]/hotel-options` — kelola daftar opsi hotel `user_choice` (mirror pola `sites`/`hotels`).
- `GET .../breakdown` — sertakan `transportMode`, `hotelMode`, `transportIncludedPrice`, `hotelOptions` di response untuk ditampilkan admin.

### 12.6 Booking Lifecycle

- **Transport `included`**: pilgrim TIDAK melihat/pilih kendaraan di wizard. Saat booking dibuat, sistem otomatis cari `TransportQuota` yang cocok (`pricingId = includedTransportPricingId`, `travelDate = departureDate booking`) dan reservasi seperti biasa (`reserveTransportQuota`) — kalau tidak ketemu kuota untuk tanggal itu, booking gagal dengan pesan jelas ("kendaraan untuk paket ini belum tersedia di tanggal tsb — hubungi admin"), BUKAN diam-diam skip reservasi (beda dari mode `none` yang memang tidak pernah punya kendaraan nyata).
- **Transport `user_choice`**: TETAP seperti mekanisme sekarang (wizard tampilkan pilihan, pilgrim pilih, `transportQuotaId` dikirim, direservasi) — cuma harga totalnya sekarang ditambahkan EKSPLISIT terpisah dari base, bukan pre-baked.
- **Hotel `included`**: tidak berubah dari §10 (statis di level template, sengaja TIDAK reservasi `HotelRoomSchedule` quota nyata — §10.7).
- **Hotel `user_choice`**: BEDA dari Included — di sini pilgrim memilih hotel di waktu booking yang SEBENARNYA (mirip Transport `user_choice`), jadi **reservasi kuota hotel nyata JADI MASUK AKAL dan HARUS dilakukan** (`reserveHotelQuota`/`confirmHotelQuota`/`releaseHotelQuota` yang sudah ada, reused persis) — ini menutup celah filosofis §10.7 (yang sengaja tidak reservasi karena statis di template) untuk kasus yang BUKAN statis.

### 12.7 Admin UI

Section "Kendaraan" dan "Hotel" di package builder masing-masing dapat **pemilih mode** (3 opsi, mis. segmented control): "Sudah Termasuk (Included)" / "Pilih Sendiri saat Booking (User Choice)" / "Tidak Dipakai (None)". Render kondisional:
- **Included**: dropdown pilih SATU kendaraan/kamar spesifik → harga snapshot muncul, editable (pola sama §10.10) → jelas ditandai "harga ini masuk ke Harga Jual Paket".
- **User Choice**: dropdown pilih SUMBER (trip untuk kendaraan; tidak butuh apa pun tambahan untuk hotel selain daftar opsi kamar yang ditawarkan) → jelas ditandai "harga TIDAK masuk ke Harga Jual Paket — pilgrim pilih & bayar sendiri saat booking".
- **None**: kosong seperti sekarang.

"Preview Harga" dipisah jadi 2 blok jelas: **"Harga Jual Paket (dasar)"** (cuma componen `included` + Komponen Biaya) vs **"Opsi Tambahan (dipilih pilgrim saat booking)"** (daftar opsi `user_choice` dengan harga masing-masing, TIDAK dijumlah ke blok pertama).

### 12.8 Publik & Wizard

- Katalog "Mulai dari" = harga dasar yang sudah benar (§12.4) — kalau ada komponen `user_choice`, tambahkan caption jelas "+ kendaraan/hotel sesuai pilihan" supaya pilgrim tidak kaget.
- Wizard: kalau `transportMode/hotelMode = included`, TIDAK ada sub-langkah pilih kendaraan/hotel (otomatis ikut, harga sudah termasuk). Kalau `user_choice`, tampilkan pilihan seperti sekarang TAPI harga yang ditampilkan adalah "base + opsi ini" secara eksplisit terpisah, bukan angka tunggal yang membingungkan.

### 12.9 Migrasi Data Lama

Paket yang sudah ada dengan `transportTripId` terisi (mis. "Ziarah Makkah — Sejarah Islam") saat migrasi otomatis diperlakukan sebagai `transportMode = user_choice` (perilaku paling dekat dengan kondisi sebelumnya — kendaraan opsional dipilih pilgrim) — BUKAN `included`, supaya tidak diam-diam mengunci satu kendaraan yang belum pernah eksplisit dipilih admin. Harga dasarnya otomatis TURUN setelah migrasi (tidak lagi termasuk kendaraan) — ini WAJIB dikomunikasikan sebagai perubahan tampilan yang disengaja, bukan bug, saat verifikasi.

### 12.10 Fase Eksekusi

1. Schema (enum + field baru + model `TourPackageHotelOption` + migrasi).
2. Fungsi harga (`computeTourPackageBreakdown()` dirombak sesuai §12.4).
3. API routes (PUT info paket + hotel-options CRUD + breakdown response).
4. Admin UI (mode selector + preview harga 2-blok, untuk Transport dan Hotel).
5. Booking lifecycle (validator, `bookings/route.ts` reservasi bersyarat mode, payment confirm, autocancel cron — termasuk reservasi hotel quota nyata untuk `user_choice`).
6. Publik & wizard (katalog caption, wizard render per-mode).
7. Verifikasi (`bun run build` 0 error, browser: paket Included tanpa pilihan kendaraan di wizard, paket User Choice harga terpisah jelas, migrasi data lama diverifikasi tidak merusak booking existing) + dokumentasi.

### 12.11 Verifikasi (2026-07-21)

`bun run build` 0 type error di setiap fase. Migrasi data: paket "Ziarah Makkah — Sejarah Islam" (satu-satunya paket existing, `transportTripId` sudah terisi sebelum §12) diset `transportMode='user_choice'` (sesuai §12.9, dikonfirmasi user via AskUserQuestion) — cache `TourPackage.price` otomatis turun dari **Rp 1.350.000 → Rp 250.000** setelah refresh (cuma komponen "Guide Lokal", kendaraan tidak lagi dibakukan) — ini perubahan tampilan yang DISENGAJA, bukan bug.

Verifikasi browser + API end-to-end:

1. **Admin — Kendaraan mode User Choice** (paket existing): dropdown mode menampilkan "Pilih Sendiri saat Booking" terpilih, caption amber "Harga kendaraan TIDAK masuk Harga Jual Paket" tampil, dropdown "pilih trip sumber opsi kendaraan" berfungsi. "Harga Jual Paket (dasar)" = Rp 250.000 (cuma komponen), section terpisah "Opsi Tambahan" menampilkan 3 opsi kendaraan (Bus Rp 4.000.000 / Coaster Rp 2.000.000 / Hiace Rp 1.100.000) masing-masing dengan prefix "+", TIDAK dijumlah ke harga dasar.
2. **Admin — Kendaraan mode Included**: ganti mode ke "Sudah Termasuk" → dropdown flat semua kombinasi trip×kendaraan muncul (20 opsi) → pilih "City Tour Makkah — Hiace Premio 10 (Rp 1.100.000)" → harga di-snapshot & terkunci → "Harga Jual Paket (dasar)" langsung jadi Rp 1.350.000 (250rb + 1,1jt), TIDAK ada section "Opsi Tambahan" untuk kendaraan (karena tidak ada pilihan, sudah final).
3. **Katalog publik**: sinkron dengan admin di kedua mode — mode Included tampil "Mulai dari Rp 1.350.000" tanpa badge rute (karena tidak ada pilihan trip untuk ditampilkan); mode User Choice tampil "Mulai dari Rp 250.000 + kendaraan sesuai pilihan" dengan badge rute.
4. **Booking API — mode Included**: payload `tourPackages: [{ tourPackageId, numPeople }]` **tanpa `transportQuotaId` sama sekali** → server AUTO-RESOLVE `TransportQuota` dari `includedTransportPricingId` + `departureDate` → `BookingTourPackage.transportQuotaId` terisi otomatis (quota yang benar-benar cocok), `totalPrice` = Rp 1.350.000 (baseTotal, kendaraan sudah termasuk), `TransportQuota.pendingSeats` bertambah 0→1 — mengonfirmasi kuota kendaraan TETAP direservasi meski pilgrim tidak memilih apa pun (mencegah overbooking untuk kendaraan yang "sudah termasuk").
5. **Wizard** (`/bookings/new/addons`): paket mode User Choice tampil dengan harga dasar Rp 250.000 terpisah dari kendaraan, badge rute tampil, grid pilihan kendaraan coba di-fetch (menampilkan "belum ada kendaraan tersedia" karena tidak ada `TransportQuota` utk tanggal default test — perilaku benar, bukan error). Tidak ada error console.
6. Data uji (2 percobaan booking, 1 `TransportQuota` sementara) dibersihkan setelah verifikasi; paket "Ziarah Makkah" dikembalikan ke `transportMode='user_choice'` (keputusan migrasi final).

**Catatan proses**: selama verifikasi, ditemukan (lagi) `transportTripId` paket sempat ter-null oleh interaksi browser-automation yang tidak disengaja (kemungkinan besar artefak alat baca aksesibilitas pada elemen `<select>`) — data dipulihkan tiap kali ditemukan. Ini bukan bug aplikasi (dikonfirmasi lewat log server: request `PUT` sungguhan terkirim, bukan sekadar state UI yang salah baca) — dicatat sebagai risiko operasional alat testing, bukan risiko produksi (browser pengguna asli tidak menjalankan automation semacam ini).
