# Arsitektur — Modul Tiket Pesawat

> **Status: SELESAI & TERVERIFIKASI (2026-07-19), diaudit ulang rencana-vs-kode (2026-07-19).** Ditulis mengikuti Fase Eksekusi SOP `CLAUDE.md` poin 1 (rencana dulu, baru kode), dieksekusi 6 fase berurutan (§10), semua diverifikasi lewat `bun run build` (0 error tiap fase) + browser nyata (Fase 3, 4) / script langsung (Fase 5). Dokumen ini **menggantikan total** isi sebelumnya (yang cuma konfirmasi "0% diimplementasikan, out-of-scope Phase 1"). Modul ini masuk scope aktif atas permintaan eksplisit user 2026-07-19 — lihat §2 untuk keputusan cakupan yang membuat ini berbeda dari catatan `docs/spec.md` lama ("Flight booking — No, Phase 2"). **Yang sengaja belum dikerjakan** (bukan gap, keputusan cakupan eksplisit §2.1): kuota (`reserveFlightQuota` dst.) infrastruktur-saja tanpa pemanggil, integrasi wizard booking, generalisasi override harga manual di `computeSellPrice()` (§4), validasi silang `departureTo >= departureFrom` di `PUT schedules/[id]` (ditemukan saat audit, bukan bug aktif — lihat `docs/decisions.md` 2026-07-19 "Audit Ulang"). Audit rencana-vs-kode sempat menemukan 2 gap (endpoint `GET /api/v1/catalog/flight` §6 dan kolom Maskapai listing admin §7 belum dibuat) — keduanya sudah ditutup, sekarang §6/§7 di bawah ini akurat mencerminkan kode. Detail per fase & audit: `docs/progress.md` bagian "Modul Tiket Pesawat".

---

## 1. Konteks Bisnis

Saudinesia perlu mencatat dan menampilkan jadwal tiket pesawat (rute + maskapai + harga + periode keberangkatan) yang mereka jual sebagai bagian paket Umroh/Haji atau produk berdiri sendiri. Beda dengan Visa/Hotel/Transport yang sudah lama berjalan, modul ini **dibangun dari nol** — kesempatan untuk langsung pakai arsitektur harga (`docs/arsitektur-harga.md`) yang sudah terbukti di Visa, bukan pola lama (`TransportPricing` yang field harga-nya diisi manual admin tanpa HPP/kurs/margin).

Karakteristik bisnis tiket pesawat yang beda dari modul lain:
- **Harga tergantung periode keberangkatan, bukan durasi trip** — beda dari Visa (harga bervariasi per *jumlah hari visa berlaku*). Satu maskapai/rute punya harga tertentu yang berlaku untuk **rentang tanggal keberangkatan** tertentu (mis. "Garuda, CGK-MED, Rp 8.500.000, berlaku untuk keberangkatan 1-15 Agustus 2026") — begitu keluar rentang itu, harga beda (perlu baris jadwal baru), bukan jatuh ke "harga default" seperti pola Visa.
- **Kuota dibeli per blok periode, bukan per tanggal** — beda dari Transport (`TransportQuota` per `travelDate` spesifik, karena kendaraan dijadwalkan harian). Agen travel biasanya membeli alokasi kursi dari maskapai untuk satu blok periode sekaligus (mis. "50 kursi untuk periode 1-15 Agustus"), bukan per tanggal individual — jadi kuota di modul ini melekat ke **jadwal (periode)**, bukan ke tanggal spesifik dalam periode itu.

---

## 2. Keputusan Cakupan (dikonfirmasi user, 2026-07-19)

Tiga keputusan berikut dikonfirmasi eksplisit sebelum rencana ini ditulis, supaya tidak salah bangun:

1. **Quota-aware, bukan katalog pasif.** Modul ini punya tracking kuota kursi (`totalSeats`/`pendingSeats`/`bookedSeats`) — bukan sekadar daftar harga tampilan. Ini **memperluas** batas `docs/spec.md` ("Flight booking — No, Phase 2") — lihat catatan penting di §2.1 di bawah soal apa yang TETAP tidak dikerjakan sesi ini walau schema-nya quota-aware.
2. **Satu komponen HPP: "Harga Tiket".** Beda dari Visa yang butuh 2 komponen wajib+opsional (Harga Visa + Harga BRN, karena memang ada 2 sumber biaya nyata) — tiket pesawat cukup 1 harga dari maskapai. Konsekuensi struktural: **tidak butuh tabel tier seperti Visa** (§9.6 `docs/arsitektur-visa.md`) — satu `FlightSchedule` = satu periode = satu harga, bukan banyak baris tier dalam satu produk.
3. **Rute (`FlightRoute`) jadi entitas terpisah**, dipakai ulang oleh banyak `FlightSchedule` — mirip pola `TransportTrip`/`TransportPricing` di modul Transport, bukan field flat seperti `VisaProduct`.

### 2.1 Yang TETAP Tidak Dikerjakan Sesi Ini (penting, baca sebelum lanjut)

Schema & fungsi kuota (`reserveFlightQuota`/`confirmFlightQuota`/`releaseFlightQuota`) **dibangun lengkap** di fase ini (§9 Fase 5) — tapi **integrasi ke wizard booking (jamaah benar-benar bisa pesan tiket pesawat lewat wizard) TIDAK dikerjakan sesi ini**. Alasan:
- Ini konsisten dengan pola yang sudah dipakai untuk Visa Step 3 (fitur varian ditunda karena menyentuh wizard lintas-modul — lihat `docs/decisions.md` 2026-07-18) dan `docs/arsitektur-booking.md` §1.5 (pertanyaan terbuka "keranjang multi-alur" yang masih PENDING).
- **Ini BUKAN pola yang sama dengan bug kritis Muthowif** (`docs/arsitektur-muthowif.md` §7 Gap #1 — `confirmMuthowifQuota()` tidak pernah dibuat sama sekali, kuota pending tidak pernah pindah ke booked, dan ini TIDAK PERNAH terdokumentasi sampai diaudit). Beda krusial: fungsi quota untuk Flight **dibuat lengkap dan benar** (reserve+confirm+release, ketiganya), cuma **belum ada pemanggil** (tidak ada wizard step yang memanggilnya) — dan ini didokumentasikan eksplisit DI SINI, dari awal, bukan ditemukan lewat audit nanti. `pendingSeats`/`bookedSeats` akan tetap 0 sampai integrasi wizard dikerjakan sebagai fase terpisah — itu status yang benar dan diketahui, bukan bug tersembunyi.
- Kalau nanti integrasi wizard dikerjakan, fungsi kuota di `lib/quota/` sudah siap pakai — tidak perlu ditulis ulang, tinggal dipanggil dari step wizard yang baru.

---

## 3. Skema Data

### 3.1 `FlightRoute` (rute — dipakai ulang lintas periode)

```prisma
model FlightRoute {
  id          String   @id @default(uuid())
  origin      String   // "Cengkareng (CGK)" — teks bebas, tidak hardcode daftar bandara
  destination String   // "Madinah (MED)"
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  schedules FlightSchedule[]

  @@map("flight_routes")
}
```

### 3.2 `FlightSchedule` (jadwal = rute × maskapai × periode × harga × kuota)

```prisma
model FlightSchedule {
  id            String   @id @default(uuid())
  routeId       String
  departureFrom DateTime @db.Date  // periode mulai — harga & kuota berlaku untuk keberangkatan di rentang ini
  departureTo   DateTime @db.Date  // periode akhir
  price         Decimal  @db.Decimal(12, 2)  // CACHE hasil computeSellPrice() — pola sama VisaProduct.price, TIDAK diisi manual
  totalSeats    Int      @default(0)
  pendingSeats  Int      @default(0)
  bookedSeats   Int      @default(0)
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  route          FlightRoute      @relation(fields: [routeId], references: [id])
  bookingFlights BookingFlight[]

  @@map("flight_schedules")
}
```

**Kenapa `price` bukan diisi manual:** persis pola Visa pasca `docs/arsitektur-harga.md` §17 — field ini murni cache hasil `computeSellPrice()` dari komponen HPP (§4), satu-satunya jalur penulisan lewat fungsi refresh, bukan input admin. Menutup kemungkinan Gap #5 versi Visa (`arsitektur-harga.md` §13, harga manual + cache hidup berdampingan tanpa aturan) muncul lagi di modul baru ini — dicegah dari desain awal, bukan ditambal belakangan.

**Kenapa kuota di level `FlightSchedule` (bukan per tanggal seperti `TransportQuota`):** dijelaskan di §1 — maskapai/agen jual blok kursi per periode, bukan per tanggal individual. Kalau nanti ternyata butuh presisi per-tanggal, itu perubahan struktural (tabel kuota terpisah per tanggal dalam periode) — bukan yang dibutuhkan sekarang, tidak dibangun spekulatif.

### 3.3 `BookingFlight` (line-item booking — schema siap, BELUM ada pemanggil, lihat §2.1)

```prisma
model BookingFlight {
  id               String   @id @default(uuid())
  bookingId        String
  flightScheduleId String
  departureDate    DateTime @db.Date  // tanggal keberangkatan aktual yang dipilih jamaah (dalam rentang schedule)
  numPassengers    Int      @default(1)
  unitPrice        Decimal  @db.Decimal(12, 2)  // snapshot harga saat booking dibuat
  totalPrice       Decimal  @db.Decimal(14, 2)

  booking        Booking        @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  flightSchedule FlightSchedule @relation(fields: [flightScheduleId], references: [id])

  @@map("booking_flights")
}
```

Pola snapshot (`unitPrice`/`totalPrice` dibekukan saat booking) sama persis dengan `BookingTransport.unitPrice` — konsisten dengan prinsip snapshot di `docs/arsitektur-harga.md` §2 ("Snapshot saat transaksi, bukan live-reference").

**Tidak perlu migrasi Package/PackageItem** — `PackageItem.productType` sudah generik (`String`, bukan enum), `'flight'` bisa dipakai sebagai value kapan pun tanpa ubah schema, sama seperti Visa dulu tidak butuh migrasi Package.

---

## 4. Integrasi Harga/HPP (`docs/arsitektur-harga.md`) — Reuse Penuh, Bukan Rancang Ulang

Sesuai instruksi eksplisit user ("Harga harus sesuai dengan komponen harga, cek arsitektur harga") — modul ini jadi modul KEDUA (setelah Visa) yang pakai arsitektur harga universal, membuktikan klaim reusability di `docs/arsitektur-harga.md` §8.1.

**100% dipakai ulang tanpa sentuh kode:** `Vendor` (dipakai sebagai "maskapai" — nama field sama, makna kontekstual beda, tidak butuh model `Airline` terpisah), `ExchangeRate`, `ProductCost`, `PricingRule`, `PreferredVendor`, `lib/pricing/computeSellPrice.ts`, `lib/pricing/simulateSellPrice.ts`, `lib/pricing/pricingHelpers.ts`.

**Adapter tipis baru** (persis pola yang diprediksi §8.1 "arsitektur-harga.md"): `lib/pricing/refreshFlightScheduleCache.ts` — mirip `refreshVisaProductCache.ts` tapi jauh lebih simpel karena cuma 1 komponen tanpa multi-tier:

```
refreshFlightScheduleCache(scheduleId):
  result = computeSellPrice('flight', scheduleId, 1)  // probe day = 1, tidak dipakai bermakna
                                                          // (tidak ada tier hari untuk flight — lihat catatan bawah)
  update FlightSchedule.price = result.sellPrice (kalau result.hppRupiah > 0, sama pola "jangan reset ke 0")
```

**Kenapa `computeSellPrice()` tetap dipanggil dengan parameter hari (`jumlahHari`) walau flight tidak day-based:** fungsi itu men-cari tier `costTiers` yang cocok dengan `jumlahHari` — untuk Flight, `ProductCost.costTiers` cukup **satu baris** `[{ minDays: 0, maxDays: 9999, cost: X }]` (flat, cocok di hari berapa pun) — sama teknik yang sudah dipakai Visa untuk komponen "individu" yang flat (117 USD di semua hari, lihat `docs/arsitektur-harga.md` §3.3 contoh awal sebelum day-tier ditambahkan). Parameter hari jadi tidak bermakna secara bisnis untuk Flight (selalu match), tapi fungsi tidak perlu diubah sama sekali — reuse murni.

**`costComponent` untuk Flight:** `"tiket"` (bebas teks, konsisten prinsip anti-hardcode arsitektur-harga.md §2 — bukan enum). Cuma 1 komponen per keputusan §2.2 — tidak ada komponen kedua seperti "biaya_non_hotel" versi Visa.

**Override manual harga jual (`docs/arsitektur-harga.md` §15) — TIDAK didukung untuk Flight di fase ini, catatan teknis penting:** logika override di `computeSellPrice()` saat ini **hardcode mencari komponen bernama persis `"individu"`** (lihat `lib/pricing/computeSellPrice.ts`, variabel `individuComponent`) — ini konsekuensi dari `costComponent` Visa yang memang literal `"individu"`. Untuk Flight yang komponennya bernama `"tiket"`, override **tidak akan pernah aktif** (pencarian `costComponent === 'individu'` tidak akan pernah cocok) — bukan bug, cuma fitur yang belum digeneralisasi. **Tidak diperbaiki sesi ini** (di luar scope permintaan user, "satu komponen" tidak minta override) — dicatat sebagai item teknis kalau nanti override dibutuhkan untuk modul non-Visa, `computeSellPrice()` perlu digeneralisasi supaya override dicari di komponen manapun yang match, bukan hardcode nama `"individu"`.

---

## 5. Kuota

### 5.1 Fungsi `lib/quota/index.ts` (baru)

Mengikuti pola persis `reserveTransportQuota`/`confirmTransportQuota`/`releaseTransportQuota` (seats-based, paling dekat dengan Flight):

```typescript
export async function reserveFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  const schedule = await tx.flightSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: { totalSeats: true, pendingSeats: true, bookedSeats: true },
  })
  const available = schedule.totalSeats - schedule.pendingSeats - schedule.bookedSeats
  if (available < seats) throw new Error(`Flight quota insufficient: need ${seats}, have ${available}`)
  await tx.flightSchedule.update({ where: { id: scheduleId }, data: { pendingSeats: { increment: seats } } })
}

export async function confirmFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  await tx.flightSchedule.update({
    where: { id: scheduleId },
    data: { pendingSeats: { decrement: seats }, bookedSeats: { increment: seats } },
  })
}

export async function releaseFlightQuota(tx: Tx, scheduleId: string, seats: number): Promise<void> {
  await tx.flightSchedule.update({ where: { id: scheduleId }, data: { pendingSeats: { decrement: seats } } })
}
```

Semua **wajib** dipanggil di dalam `prisma.$transaction()` (komentar di puncak file sudah menegaskan ini untuk fungsi lain, berlaku sama) — mencegah race condition kuota, konsisten prinsip yang sudah ada.

### 5.2 Validasi Tanggal Keberangkatan vs Periode

Kalau/ketika `BookingFlight` mulai dibuat (fase integrasi wizard nanti, di luar scope sesi ini), `departureDate` yang dipilih jamaah **wajib divalidasi** berada di antara `flightSchedule.departureFrom` dan `departureTo` sebelum `reserveFlightQuota()` dipanggil — dicatat di sini supaya tidak terlewat saat fase itu dikerjakan.

---

## 6. API Routes (Rencana)

| Method | Path | Auth guard | Catatan |
|---|---|---|---|
| GET, POST | `/api/v1/admin/products/flight/routes` | `requireManager()` | CRUD rute (list + create) |
| PUT, DELETE | `/api/v1/admin/products/flight/routes/[id]` | `requireManager()` | DELETE = soft (`isActive:false`) kalau rute masih dipakai schedule aktif — cek dulu sebelum hapus fisik, hindari Gap serupa constraint DB yang tersamar (`docs/arsitektur-visa.md` §7 Gap #6 lama) |
| GET, POST | `/api/v1/admin/products/flight/schedules` | `requireManager()` | List semua jadwal (dengan info rute), create baru — `price` TIDAK diterima dari body (pelajaran dari `docs/arsitektur-harga.md` §17 Gap #5 — jangan buka jalur harga manual dari awal) |
| GET, PUT, DELETE | `/api/v1/admin/products/flight/schedules/[id]` | `requireManager()` | Update field non-harga (periode, kuota, rute); `price` juga TIDAK ada di update schema |
| GET, PUT | `/api/v1/admin/products/flight/schedules/[id]/cost` | `requireSuperAdmin()` | Kelola 1 komponen HPP (vendor/maskapai, mata uang, harga tiket) — jauh lebih simpel dari `cost-tiers` Visa karena cuma 1 baris, bukan tabel tier |
| GET | `/api/v1/admin/products/flight/simulate` | `requireSuperAdmin()` | Live preview HPP→harga jual dari angka yang diketik, reuse `simulateSellPrice()` — pola identik `docs/arsitektur-harga.md` §16, cukup ganti `productType` jadi `'flight'` |
| GET | `/api/v1/catalog/flight` | publik | List jadwal aktif, sort by `departureFrom`, include info rute |

Semua route **wajib** pakai pola pembeda error `Unauthorized`/`Forbidden` (403) vs error lain (500 + `console.error`) **sejak awal** — pelajaran langsung dari `docs/arsitektur-visa.md` §7 Gap #6 (baru ditutup 2026-07-18 setelah lama jadi `catch{...403}` polos). Tidak boleh terulang di modul baru.

---

## 7. Admin UI (Rencana, "mirip Visa" sesuai permintaan)

**`app/[locale]/admin/(protected)/products/flight/page.tsx`** — listing 2-level: tabel Rute (CRUD ringkas, mirip pola sederhana) di atas, tabel Jadwal (dengan kolom Rute/Maskapai/Periode/Harga/Kuota/Status) di bawah, tombol "+Tambah Rute" dan "+Tambah Jadwal".

**`app/[locale]/admin/(protected)/products/flight/[id]/page.tsx`** (edit jadwal) — struktur meniru `products/visa/[id]/page.tsx` pasca-redesain (`docs/arsitektur-harga.md` §14-17):
- Panel "Informasi Dasar": pilih Rute (dropdown dari `FlightRoute` aktif + tombol "+ Rute Baru" inline, pola sama quick-add vendor Visa), Periode (`departureFrom`/`departureTo`), Total Kursi. **Tidak ada input harga di sini** — read-only, sama pelajaran Visa.
- Panel "HPP & Komponen Biaya" — jauh lebih simpel dari Visa (1 komponen, bukan tabel tier): vendor picker "Maskapai" (+ tombol "+ Vendor Baru" inline, reuse `/api/v1/admin/system/settings/vendors` yang sudah ada — **tidak perlu endpoint baru**, `Vendor` memang generik), mata uang, 1 input "Harga Tiket". Kolom HPP (read-only) + Harga Jual (read-only, tanpa override — lihat §4) muncul **live** lewat debounce ke `/simulate`, pola identik `docs/arsitektur-harga.md` §16 — pelajaran langsung: jangan bangun versi "tunggu simpan dulu" yang harus diperbaiki lagi belakangan.

Nav sidebar: `components/admin/AdminSidebar.tsx` — tambah item baru di `productItems`, ikon `Plane` (lucide-react, sudah tersedia di package), label "Pesawat", href `/${locale}/admin/products/flight`.

---

## 8. Tampilan Publik (Rencana)

**`app/[locale]/(public)/flight/page.tsx`** — server component, query `FlightSchedule` aktif + rute, **sort by `departureFrom` ascending** (sesuai permintaan eksplisit "diurutkan berdasarkan tanggal").

- **Desktop (≥md breakpoint Tailwind)**: tabel — kolom Maskapai, Rute, Periode, Harga.
- **Mobile (<md)**: card per baris, susun vertikal (`flex-col` / `grid grid-cols-1`) — pola responsive standar Tailwind (`hidden md:table` untuk tabel, `md:hidden` untuk card list), **bukan 2 query terpisah** — satu data source, dua presentasi lewat CSS breakpoint, konsisten cara React/Tailwind di seluruh codebase ini (tidak ada duplikasi fetch).

---

## 9. Keamanan / Safe Coding (permintaan eksplisit user, poin 3)

Checklist yang ditegakkan di setiap fase eksekusi (bukan aspirasi, dicek tiap endpoint sebelum fase dianggap selesai):

1. **Validasi Zod di setiap Route Handler**, tanpa kecuali — input request di-parse dulu (`safeParse`/`safeParseAsync`), 400 dengan pesan jelas kalau gagal, sebelum sentuh Prisma sama sekali.
2. **Auth guard di dalam handler**, bukan cuma middleware — `requireManager()` untuk CRUD rute/jadwal, `requireSuperAdmin()` untuk kelola HPP (pola sama persis Visa: manager kelola produk, superadmin kelola harga).
3. **Kuota selalu di dalam `prisma.$transaction()`**, tidak pernah `update()` langsung di luar transaksi — mencegah race condition dua booking rebutan kursi terakhir bersamaan.
4. **Error handling dari hari pertama**: bedakan 401/403 (auth) dari 500 (lainnya), `console.error` untuk log server, **tidak pernah** bocorkan pesan Prisma mentah ke client — bukan ditambal belakangan seperti Visa Gap #6.
5. **Tidak ada `any`** — semua tipe eksplisit atau `unknown` + narrowing, sesuai `CLAUDE.md` TypeScript strict.
6. **Tidak ada `$queryRaw`** — semua lewat Prisma ORM biasa, tidak ada kebutuhan raw SQL di modul ini.
7. **`price` tidak pernah jadi input yang diterima langsung dari client** di endpoint mana pun (create/update jadwal) — satu-satunya jalur penulisan adalah `refreshFlightScheduleCache()`, ditegakkan di level Zod schema (field-nya tidak ada di schema, bukan cuma "diabaikan di UI") — pelajaran `docs/arsitektur-harga.md` §17 diterapkan dari desain awal, bukan hasil perbaikan gap belakangan.
8. **DELETE rute/jadwal**: cek dulu ada FK yang masih mereferensikan (jadwal aktif untuk rute, booking untuk jadwal) sebelum hapus fisik — soft-delete (`isActive:false`) kalau masih dipakai, konsisten pola `Vendor`/`TransportVehicle`.

---

## 10. Fase Eksekusi

1. **Fase 1 — Schema**: `FlightRoute`, `FlightSchedule`, `BookingFlight` di `prisma/schema.prisma`, migrasi Prisma (workaround non-interaktif sesuai memori sesi: `migrate diff --shadow-database-url <DB-TERPISAH>` → tulis migration.sql manual → `migrate deploy`). Verifikasi: `bun run build` 0 error, 3 tabel baru terkonfirmasi ada via query DB langsung.
2. **Fase 2 — Integrasi harga**: `lib/pricing/refreshFlightScheduleCache.ts` (adapter tipis, §4), endpoint `cost` + `simulate` untuk Flight. Verifikasi: `bun run build` 0 error + test langsung endpoint tanpa UI (isi HPP komponen "tiket", cek `price` ter-cache benar sesuai kurs+margin yang sedang aktif).
3. **Fase 3 — Admin UI**: halaman listing (`products/flight/page.tsx`) + edit jadwal (`products/flight/[id]/page.tsx`) + nav sidebar. Verifikasi: `bun run build` 0 error + browser nyata (buat rute, buat jadwal, isi HPP, lihat harga jual live, simpan, lihat di listing).
4. **Fase 4 — Publik**: `app/[locale]/(public)/flight/page.tsx`, tabel↔card responsive, sort by tanggal. Verifikasi: `bun run build` 0 error + browser nyata (desktop tabel, resize ke mobile width cek jadi card, urutan tanggal benar).
5. **Fase 5 — Kuota**: `reserveFlightQuota`/`confirmFlightQuota`/`releaseFlightQuota` di `lib/quota/index.ts` — infrastruktur saja, **tidak ada pemanggil di fase ini** (lihat §2.1). Verifikasi: `bun run build` 0 error + test langsung 3 fungsi lewat script (reserve → cek pendingSeats naik, confirm → cek pending turun bookedSeats naik, release → cek pending turun tanpa naikkan booked, dan kasus kuota habis → throw error yang benar).
6. **Fase 6 — Dokumentasi**: `docs/progress.md`, `docs/decisions.md`, dokumen ini di-update status jadi SELESAI & TERVERIFIKASI per fase.

**Independensi:** Fase 1 harus selesai dulu (semua bergantung schema). Fase 2 butuh Fase 1. Fase 3 butuh Fase 1+2 (UI HPP butuh endpoint-nya). Fase 4 cuma butuh Fase 1 (baca data publik, tidak butuh UI admin selesai dulu — bisa paralel dengan Fase 3 kalau mau, tapi dikerjakan berurutan sesuai SOP "satu fase pada satu waktu"). Fase 5 independen, bisa disisipkan kapan saja setelah Fase 1.

---

## 11. Yang TIDAK Dikerjakan Sesi Ini

- **Integrasi wizard booking** — lihat §2.1, alasan lengkap di sana. `BookingFlight`/fungsi kuota siap tapi belum dipanggil dari mana pun.
- **Override harga manual per jadwal** — lihat catatan teknis di §4 (`computeSellPrice()` hardcode nama komponen `"individu"`, Flight pakai `"tiket"`). Bisa dikerjakan nanti kalau dibutuhkan, perlu generalisasi kecil di `computeSellPrice()` dulu.
- **Validasi silang tanggal keberangkatan vs periode di level booking** — dicatat di §5.2, relevan cuma setelah integrasi wizard ada.
- **`spreadPercent`/`PricingRule` per-`productType` untuk `'flight'`** — infrastrukturnya sudah generik (`PricingRule.productType` nullable, bisa diisi `'flight'` kapan saja lewat DB kalau margin flight perlu beda dari default global) tapi belum ada UI untuk override per-tipe (sama gap yang sudah tercatat di `docs/arsitektur-harga.md` §13 Gap #3, berlaku juga untuk modul ini bukan cuma Visa).

---

## 12. Referensi Silang

- `docs/arsitektur-harga.md` — arsitektur HPP/kurs/margin yang di-reuse penuh (§2-§7), termasuk catatan teknis hardcode override di §4 dokumen ini
- `docs/arsitektur-transportasi.md` — preseden pola Rute+Pricing+Kuota (`TransportTrip`/`TransportPricing`/`TransportQuota`) yang jadi acuan struktural §3 dokumen ini (walau sumber harga beda — Transport pakai field manual, Flight pakai `ProductCost`)
- `docs/arsitektur-visa.md` — preseden UI admin "mirip Visa" (§7 di dokumen ini), termasuk pelajaran Gap #5/#6 (harga manual, error handling) yang diterapkan dari desain awal di modul ini
- `docs/arsitektur-muthowif.md` §7 Gap #1 — preseden bug kritis "kuota ada tapi fungsi konfirmasi tidak pernah dibuat/dipanggil" yang jadi alasan §2.1 dokumen ini ditulis eksplisit (dokumentasikan gap dari awal, jangan biarkan ditemukan lewat audit nanti)
- `docs/arsitektur-booking.md` §1.5 — pertanyaan terbuka "keranjang multi-alur" yang jadi alasan integrasi wizard ditunda (§2.1)
- `docs/spec.md` — baris "Flight booking — No, Phase 2" yang di-supersede sebagian oleh keputusan 2026-07-19 (§2) — booking PENUH tetap Phase 2, tapi pencatatan+kuota+harga masuk scope aktif sekarang
