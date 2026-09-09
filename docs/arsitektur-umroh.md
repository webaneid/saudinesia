# Arsitektur — Modul Umroh (Booking Core / Mesin Booking)

> **Status: SOURCE OF TRUTH untuk modul Umroh.** Ini adalah lapisan orkestrasi yang menyatukan semua produk (Hotel, Transport, Muthowif, Katering, Tour, Visa, Haji) menjadi satu booking. Dokumen per-produk (`docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`) sudah membahas detail masing-masing produk — dokumen ini **tidak mengulang** itu, fokus ke: wizard, transaksi pembuatan booking, siklus status, pembayaran, pembatalan, dan cron jobs. Ditulis dari audit kode aktual per **2026-07-08**.
>
> **Berisi beberapa temuan kritis (§7) yang lebih parah dari modul manapun yang sudah diaudit — termasuk risiko overbooking Haji dan hilangnya jejak audit refund.**

---

## 1. Konteks Bisnis

Booking adalah satu paket perjalanan (Umroh atau Haji) yang menggabungkan 0-N komponen: hotel Makkah, hotel Madinah, transport (multi), muthowif (opsional), katering (opsional), tur ziarah (multi, opsional), dan N jamaah (masing-masing dengan aplikasi visa). Satu `Booking` = satu transaksi pembayaran = satu payment deadline 24 jam.

---

## 2. Skema Data Aktual (Prisma)

Sumber: `prisma/schema.prisma:379-425` (Booking, BookingStatus), `:623-649` (Payment, PaymentStatus), `:651-668+` (Refund, RefundStatus).

```prisma
model Booking {
  id              String        @id @default(uuid())
  bookingCode     String        @unique   // format SND-YYYY-##### — lihat §8
  userId          String
  groupId         String?
  status          BookingStatus @default(awaiting_payment)
  departureDate   DateTime      @db.Date
  returnDate      DateTime      @db.Date
  season          String
  totalAmount     Decimal       @db.Decimal(14, 2)  // trusted dari client — lihat Gap #4
  paymentDeadline DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  hotels        BookingHotel[]
  transports    BookingTransport[]
  muthowif      BookingMuthowif[]
  catering      BookingCatering[]
  tours         BookingTour[]
  services      BookingService[]
  haji          BookingHaji[]     // relasi ada di schema, TIDAK PERNAH diisi — lihat Gap #1
  visa          BookingVisa[]     // relasi ada di schema, TIDAK PERNAH diisi (beda dari VisaApplication)
  payments      Payment[]
  refunds       Refund[]          // relasi ada di schema, TIDAK PERNAH diisi — lihat Gap #3
  notifications NotificationLog[]
}

enum BookingStatus {
  awaiting_payment   // default saat create
  payment_review     // setelah upload bukti transfer
  confirmed          // setelah admin confirm payment
  active             // manual oleh admin (belum ada UI/trigger otomatis)
  completed          // manual oleh admin (belum ada UI/trigger otomatis)
  cancelled          // self-cancel ATAU auto-cancel cron
}

model Payment {
  id                      String        @id @default(uuid())
  bookingId               String
  amount                  Decimal       @db.Decimal(14, 2)
  method                  String
  status                  PaymentStatus @default(pending)
  buktiTransferPath       String?
  buktiTransferUploadedAt DateTime?
  confirmedById           String?
  confirmedAt             DateTime?
  notes                   String?
}

model Refund {
  id             String       @id @default(uuid())
  bookingId      String
  amount         Decimal      @db.Decimal(14, 2)
  reason         String
  isForceMajeure Boolean      @default(false)
  status         RefundStatus @default(pending)
  approvedById   String?
  approvedAt     DateTime?
  paidAt         DateTime?
}
```

**Catatan penting:** `Refund` model lengkap ada di schema (dengan `isForceMajeure`, approval flow, `paidAt`) tapi **tidak ada satu baris kode pun yang membuat record `Refund`** — lihat Gap #3. `Booking.haji` juga tidak pernah diisi — lihat Gap #1.

---

## 3. Transaksi Pembuatan Booking

**File:** `app/api/v1/bookings/route.ts:33-174` — `POST /api/v1/bookings`, guard `requireSession()`, validasi `createBookingSchema` (`lib/validators/booking.ts`).

### 3.1 Reservasi Kuota (di dalam `$transaction(Serializable)`, baris 47-64)

```typescript
if (data.hotelMakkah)  await reserveHotelQuota(tx, data.hotelMakkah.hotelQuotaId, data.hotelMakkah.numRooms)
if (data.hotelMadinah) await reserveHotelQuota(tx, data.hotelMadinah.hotelQuotaId, data.hotelMadinah.numRooms)
for (const t of data.transports) await reserveTransportQuota(tx, t.transportQuotaId, t.numPassengers)
if (data.muthowif) { /* loop per-hari reserveMuthowifQuota */ }
```

**Hanya Hotel, Transport, Muthowif yang dicek kuotanya.** Katering dan Tour dibuat langsung tanpa cek kapasitas apa pun (schema `CateringOption`/`HeritageTour` memang tidak punya tabel kuota — `HeritageTour.maxGroupSize` ada di schema tapi tidak pernah dibaca di kode manapun). Haji **tidak diproses sama sekali** — lihat Gap #1.

### 3.2 Pembuatan Booking (baris 66-78)

`totalAmount` diambil langsung dari `data.totalAmount` (payload klien) — **tidak dihitung ulang di server**. Lihat Gap #4.

`createBookingSchema` (`lib/validators/booking.ts:1-70`) **tidak punya field `haji` sama sekali** — bukan hanya "tidak dipakai", tapi secara skema memang tidak bisa dikirim dari wizard.

### 3.3 Line Items (baris 80-157)

Hotel Makkah/Madinah, Transport (multi), Muthowif (satu per booking), Katering (satu per booking), Tour (multi), Pilgrims + `VisaApplication` per jamaah (status awal `pending_documents`). Detail masing-masing model ada di dokumen produk terkait.

---

## 4. Siklus Status Booking

| Status | Dari | Trigger | File:Line |
|---|---|---|---|
| `awaiting_payment` | — | Booking dibuat | `app/api/v1/bookings/route.ts:71` |
| `payment_review` | `awaiting_payment` | Jamaah upload bukti transfer | `app/api/v1/bookings/[id]/payment/bukti/route.ts:56` |
| `confirmed` | `payment_review` | Admin confirm payment | `app/api/v1/admin/payments/[id]/confirm/route.ts:31` |
| `awaiting_payment` | `payment_review` | Admin reject payment | `app/api/v1/admin/payments/[id]/confirm/route.ts:43` |
| `cancelled` | `awaiting_payment` | Jamaah self-cancel | `app/api/v1/bookings/[id]/route.ts:52` (DELETE) |
| `cancelled` | `awaiting_payment` | Auto-cancel cron (deadline lewat) | `lib/cron/autocancelJob.ts:24` |
| `active`, `completed` | `confirmed` | **Manual oleh admin — tidak ada UI/route ditemukan untuk transisi ini** | — |

Transisi ke `payment_review` **berfungsi dengan benar** (`app/api/v1/bookings/[id]/payment/bukti/route.ts:45-56` — buat `Payment` record dengan `status: 'pending'`, lalu update `booking.status` ke `payment_review`, semua dalam satu route meski bukan `$transaction` eksplisit karena hanya 2 write sekuensial tanpa quota terlibat).

---

## 5. Konfirmasi & Penolakan Pembayaran

**File:** `app/api/v1/admin/payments/[id]/confirm/route.ts:1-58`, guard `requireAdmin()`.

Query `booking` hanya `include: { hotels, transports, user }` — **tidak include `muthowif`, `catering`, `tours`, atau `haji`**. Di dalam `$transaction`: update `payment.status`, update `booking.status: 'confirmed'`, lalu `confirmHotelQuota()` per hotel dan `confirmTransportQuota()` per transport. **Tidak ada pemanggilan apa pun untuk muthowif** — ini bug yang sudah didokumentasikan detail di `docs/arsitektur-muthowif.md` §7 Gap #1, dikonfirmasi ulang di sini karena titik masalahnya justru di file ini (Booking Core), bukan di modul Muthowif itu sendiri.

Reject: `payment.status → rejected`, `booking.status → awaiting_payment` (kembali, bukan `cancelled` — jamaah bisa upload ulang bukti baru).

---

## 6. Pembatalan

### 6.1 Self-Cancel Jamaah

**File:** `app/api/v1/bookings/[id]/route.ts:35-62` — `DELETE /api/v1/bookings/[id]`.

```typescript
if (['confirmed', 'active', 'completed', 'cancelled'].includes(booking.status)) {
  return NextResponse.json(err('Booking ini tidak dapat dibatalkan.'), { status: 422 })
}
const refund = computeRefundAmount(Number(booking.totalAmount), new Date(booking.departureDate))
await prisma.booking.update({ where: { id }, data: { status: 'cancelled' } })
return NextResponse.json(ok({ refundAmount: refund }))
```

Hanya bisa cancel saat status `awaiting_payment` atau `payment_review`. **Tidak di dalam `$transaction`, tidak ada pemanggilan `releaseHotelQuota`/`releaseTransportQuota`/`releaseMuthowifQuota` sama sekali, dan tidak membuat record `Refund`** — nominal refund dihitung dan dikembalikan ke klien sebagai angka saja, lalu hilang. Lihat Gap #2 dan #3.

**Kebijakan refund** (`lib/utils/cancellationPolicy.ts:1-19`, terverifikasi):
```typescript
if (days > 60) return { refundPercent: 100, label: '>60 hari: refund penuh' }
if (days >= 30) return { refundPercent: 50, label: '30–60 hari: refund 50%' }
return { refundPercent: 0, label: '<30 hari: tidak ada refund' }
```
`computeRefundAmount = Math.floor(totalAmount * refundPercent / 100)`.

### 6.2 Auto-Cancel Cron

**File:** `lib/cron/autocancelJob.ts:9-63` — `startAutoCancelJob()`, jadwal `0 * * * *` (tiap jam), dipanggil dari `instrumentation.ts` saat startup.

Query booking `awaiting_payment` dengan `paymentDeadline < now`, include `hotels, transports, muthowif` (Catering/Tour sengaja tidak di-include karena memang tidak ada kuota untuk dirilis). Di dalam `$transaction`: update status → `cancelled`, lalu `releaseHotelQuota`/`releaseTransportQuota`/`releaseMuthowifQuota` per item — **benar dan lengkap untuk 3 layanan yang punya kuota**. Kirim WA `auto_cancelled` (best-effort, di luar transaksi). **Tidak membuat record `Refund`** (memang tidak perlu — auto-cancel terjadi sebelum bayar, jadi tidak ada uang untuk direfund).

### 6.3 Payment Reminder Cron

**File:** `lib/cron/autocancelJob.ts:65-113` — `startPaymentReminderJob()`, jadwal `30 * * * *`.

Dua jendela waktu dihitung dari `paymentDeadline` (deadline 24 jam sejak booking dibuat): `payment_reminder_12h` saat sisa waktu 11-13 jam, `payment_reminder_22h` saat sisa waktu 1-3 jam (penamaan `12h`/`22h` merujuk ke **jam berjalan sejak booking dibuat** dari total 24 jam, bukan jam tersisa — konsisten dengan istilah "T+12h/T+22h" di `docs/progress.md`, bukan typo). Idempotent via cek `NotificationLog` per `(bookingId, type)` sebelum kirim.

---

## 7. Gap / Ketidaksesuaian Aktif (per audit 2026-07-08)

Modul ini punya gap paling serius dari semua yang sudah diaudit — bukan sekadar fitur belum lengkap, tapi risiko integritas data produksi.

### Gap #1 — KRITIS (DITUTUP di sisi API/skema 2026-07-25, UI/wizard sengaja BELUM): Haji tidak bisa dibooking sama sekali, dan skema kuotanya cacat

**Update 2026-07-25**: `createBookingSchema` (`lib/validators/booking.ts`) sekarang punya `itemType='haji'` (`hajiProductId`, `numPersons`) di discriminated union `items[]` (`docs/arsitektur-booking.md` §6 Step 5). `POST /api/v1/bookings` memanggil `reserveHaji()` + `tx.bookingHaji.create()` untuk item bertipe itu, `totalAmount` ikut terhitung server-side. Diverifikasi end-to-end via curl: booking Haji-only berhasil dibuat, `HajiProduct.pendingQuota` bertambah benar, `POST admin/payments/[id]/confirm` memindahkan `pendingQuota`→`bookedQuota` dengan benar (`docs/arsitektur-booking.md` §7.1).

**Yang MASIH terbuka, sengaja (bukan terlewat)**: tidak ada wizard/checkout UI yang pernah mengirim `itemType='haji'` — pilgrim asli TIDAK BISA booking Haji lewat browser sama sekali, meski API-nya sudah bisa menerimanya lewat curl/klien lain. Checkout pendek Haji sengaja DIKELUARKAN dari `docs/arsitektur-booking.md` §6 Step 6 (dieksekusi 2026-07-25 untuk Visa-only/Transport-only saja) — kata user: *"visa haji dengan visa yang tersedia berbeda sama sekali .. kita blm sentuh haji, karena blm masuk dalam rencana kita sekarang."* Haji butuh konsep "Visa Haji" tersendiri, BEDA dari `VisaProduct` biasa yang dipakai Umroh — pola manifest/visa existing TIDAK BOLEH diasumsikan otomatis berlaku begitu modul ini akhirnya dikerjakan. Lihat `CLAUDE.md` bug list dan `docs/decisions.md` 2026-07-25 (entri Step 6) untuk detail lengkap.

**Prasyarat skema DITUTUP 2026-07-24**: `HajiProduct.pendingQuota` (migrasi `20260724100000_haji_pending_quota`, pola identik Hotel), `hajiAdapter` (`lib/quota/adapters/haji.ts`, `reserveHaji`/`confirm`/`release`) terdaftar di registry adapter — race condition TIDAK MUNGKIN lagi.

### Gap #2 — DITUTUP 2026-07-24: Self-cancel tidak melepas kuota

~~Diverifikasi (`app/api/v1/bookings/[id]/route.ts:35-62`): tidak ada `$transaction`, tidak ada pemanggilan `releaseHotelQuota`/`releaseTransportQuota`/`releaseMuthowifQuota` apa pun.~~ **DITUTUP** — `DELETE /api/v1/bookings/[id]` sekarang memanggil `cancelBooking()` (`lib/booking/cancel.ts`) di dalam `prisma.$transaction`, fungsi yang SAMA persis dipakai `lib/cron/autocancelJob.ts` (dulu dua implementasi terpisah — cron benar, self-cancel tidak sama sekali). Loop release memakai adapter registry (`lib/quota/adapters/`), mencakup hotel/transport/muthowif/tourPackage/haji. Diverifikasi end-to-end via curl: booking dengan `hotelMakkah` (2 kamar) → `pendingQuota` naik jadi 2 → self-cancel → `pendingQuota` kembali 0, status `cancelled`. Detail di `docs/arsitektur-booking.md` §6 Step 1 & 3, `docs/decisions.md` 2026-07-24.

### Gap #3 — DITUTUP 2026-07-24: Tidak ada record `Refund` yang pernah dibuat

~~`Refund` model lengkap ada di schema... tapi tidak ada satu tempat pun di kode yang memanggil `prisma.refund.create()`.~~ **DITUTUP** — `cancelBooking()` (`lib/booking/cancel.ts`) selalu memanggil `tx.refund.create()` kalau `computeRefundAmount() > 0`, dipanggil dari self-cancel DAN auto-cancel cron (fungsi yang sama, tidak mungkin lagi satu jalur "lupa" membuat record). Diverifikasi end-to-end via curl: booking dengan `departureDate` >60 hari ke depan, `totalAmount` 20.000.000 → self-cancel → row `Refund` tercipta dengan `amount: 20000000`, `status: 'pending'`, `reason` sesuai jalur pembatalan (pilgrim vs auto-cancel). `docs/progress.md` M8 "Refund request form" (UI approval admin) masih pending — cuma fondasi data (pembuatan record saat cancel) yang ditutup di sini.

### ~~Gap #4 — Sedang: `totalAmount` dipercaya dari klien tanpa validasi ulang server~~ — DITUTUP 2026-07-25

~~`app/api/v1/bookings/route.ts:75` — `totalAmount: data.totalAmount` diambil langsung dari payload POST. Perhitungan asli ada di `lib/booking/draft.ts:computeTotal()` yang berjalan di klien. Server tidak menjumlahkan ulang dari `pricePerNight`, `unitPrice`, dll. yang juga dikirim di payload yang sama untuk memverifikasi kecocokan. Secara teori klien bisa mengirim `totalAmount` lebih rendah dari total item sebenarnya.~~

**DITUTUP** — `docs/arsitektur-booking.md` §6 Step 5: `createBookingSchema` tidak lagi menerima `totalAmount` dari client sama sekali. `app/api/v1/bookings/route.ts` menghitung total dari `totalPrice` tiap item yang baru direservasi/dibuat server-side (di dalam `$transaction` yang sama) ditambah `sellPriceSnapshot` visa tiap pilgrim, lalu menulisnya lewat `tx.booking.update()` di akhir transaksi. Diverifikasi end-to-end via curl+DB: booking kombinasi hotel+transport+visa, `totalAmount` server dikonfirmasi persis sama dengan jumlah manual tiap komponen — lihat `docs/arsitektur-booking.md` §7.1 dan `docs/decisions.md` 2026-07-25.

### Gap lain (non-kritis)

| # | Gap | Lokasi |
|---|-----|--------|
| 5 | Katering & Tour tidak punya kuota/kapasitas sama sekali — booking tak terbatas selalu diterima | `CateringOption`/`HeritageTour` di schema, tidak ada tabel kuota |
| 6 | Status `active`/`completed` tidak punya trigger otomatis atau UI transisi yang ditemukan — hanya ada di enum | — |
| 7 | Invoice PDF benar-benar belum dimulai — `lib/pdf/invoice.tsx` cuma `export {}` dengan komentar TODO, route `GET /api/v1/bookings/[id]/invoice` selalu `return ok(null)` | `lib/pdf/invoice.tsx`, `app/api/v1/bookings/[id]/invoice/route.ts` |
| 8 | Group booking 0% — `app/[locale]/(pilgrim)/groups/page.tsx` hanya `<div>TODO</div>`, tidak ada API route. Model `Group`/`GroupMember` ada di schema tapi tidak dipakai kode manapun | `app/[locale]/(pilgrim)/groups/page.tsx` |
| 9 | `generateBookingCode()` (`lib/utils/bookingCode.ts`) pakai `count()` + increment, dipanggil **di luar** `$transaction` booking (baris 44, sebelum `$transaction` dibuka di baris 47) — dua booking paralel secara teori bisa dapat kode sama; constraint unique di DB akan menolak salah satunya dengan error, bukan silent duplicate, tapi user kedua akan dapat pesan error generik alih-alih retry otomatis | `lib/utils/bookingCode.ts`, `app/api/v1/bookings/route.ts:44` |
| 10 | Dead code: `app/api/v1/internal/autocancel/route.ts` dan `app/api/v1/internal/reminders/route.ts` — stub `return ok(null)`, tidak dipanggil siapa pun. Mekanisme nyata adalah `instrumentation.ts` yang menjalankan `startAutoCancelJob()`/`startPaymentReminderJob()` (node-cron in-process) saat server startup — sama pola dengan dead stub yang ditemukan di modul Transport (`admin/transport/route.ts`) | `app/api/v1/internal/autocancel/route.ts`, `app/api/v1/internal/reminders/route.ts` |

---

## 8. Referensi Silang

- Bug muthowif payment-confirm: dijelaskan detail di `docs/arsitektur-muthowif.md` §7 Gap #1 — dikonfirmasi ulang di sini karena akar masalahnya ada di file Booking Core (`admin/payments/[id]/confirm/route.ts`), bukan di kode Muthowif itu sendiri.
- Kebijakan refund tier: `lib/utils/cancellationPolicy.ts` — >60 hari 100%, 30-60 hari 50%, <30 hari 0%.
- Status milestone: `docs/progress.md` → M4 (wizard), M5 (dashboard pilgrim), M8 (payments, sebagian besar gap di atas ada di sini), M6 (group booking, dikonfirmasi 0%), M11 (invoice, dikonfirmasi belum mulai)
- Modul produk terkait: `docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`. Hotel, Haji, Katering & Tour, Paket belum punya dokumen arsitektur terpisah.
- Pola dokumen ini mengikuti template `docs/arsitektur-visa.md`.
