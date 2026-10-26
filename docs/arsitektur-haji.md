# Arsitektur — Modul Haji

> **Status: SOURCE OF TRUTH untuk modul Haji (as-built, 2026-10-26).** Menggantikan bagian Haji di `docs/architecture.md`. Ditulis dari audit langsung ke kode aktual setelah rangkaian Komponen Biaya Fase 1-4 (`docs/arsitektur-komponen-biaya.md`); setiap rujukan berkas/baris diperiksa terhadap kode pada tanggal itu.
>
> **Ringkas:** produk Haji kini punya harga turunan (Komponen Biaya → HPP + kurs + margin per komponen), CRUD lengkap di API dan admin UI (hapus aman / nonaktif / aktifkan kembali), dan booking yang aman di sisi API (harga dihitung server, produk nonaktif/belum berharga ditolak, kuota ditahan atomik). **Yang BELUM ada:** checkout Haji di browser, konsep "Visa Haji" tersendiri, galeri gambar, dokumen/manifest khusus Haji — lihat §7.

---

## 1. Konteks Bisnis

Saudinesia menjual paket Haji (Furoda/Musyarifah, Khusus/ONH Plus, Reguler, Plus) sebagai produk katalog: satu `HajiProduct` per paket per tahun, dengan kuota kursi terbatas dan harga per orang. Berbeda dari Umroh, Haji **bukan** komponen yang dirakit jamaah (hotel/transport/visa dipilih sendiri): satu produk adalah satu paket utuh dengan harga tunggal per orang, yang dihitung admin dari komponen biaya (visa haji, akomodasi, transportasi, dst).

Alur bisnis: admin membuat produk → mengisi Komponen Biaya (vendor + mata uang + nominal) → harga jual per orang terhitung otomatis dan tampil di katalog publik `/haji` → (rencana) jamaah memesan lewat checkout → kuota ditahan → pembayaran dikonfirmasi admin → kuota terjual → invoice PDF.

---

## 2. Skema Data Aktual (Prisma)

Sumber: `prisma/schema.prisma`.

```prisma
model HajiProduct {                       // schema.prisma:426
  id            String    @id @default(uuid())
  name          String
  description   String?                    // JSON dokumen teks kaya (docs/arsitektur-editor-teks.md)
  hajiType      String                     // 'khusus' | 'furoda' | 'reguler' | 'plus'
  year          Int
  departureDate DateTime? @db.Date
  returnDate    DateTime? @db.Date
  durationDays  Int?
  includes      Json      @default("[]")   // daftar "yang termasuk"
  price         Decimal   @db.Decimal(14, 2) // CACHE harga jual per orang — hasil Komponen Biaya, BUKAN masukan (0 = belum ditetapkan)
  priceLabel    String?
  totalQuota    Int       @default(0)
  pendingQuota  Int       @default(0)      // ditahan booking belum dibayar (mesin booking)
  bookedQuota   Int       @default(0)      // terjual (mesin booking)
  images        Json      @default("[]")   // belum ada jalur unggah (lihat §7)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  bookingHaji   BookingHaji[]
  @@map("haji_products")
}

model BookingHaji {                       // schema.prisma:1044
  id, bookingId (onDelete: Cascade), hajiProductId (TANPA cascade — produk bertransaksi tidak bisa dihapus keras),
  numPersons Int @default(1), totalPrice Decimal(14,2)   // totalPrice dihitung SERVER = price × numPersons
  @@map("booking_haji")
}
```

Tabel polimorfik (tanpa FK; `productType = 'haji'`): `ProductCost` (`schema.prisma:1187` — Komponen Biaya), `PreferredVendor` (`:1231`), `DocumentRequirement` (`:482`), `ManifestFieldRequirement` (`:500`). Margin: `PricingRule` (`:1203`) dengan `productType = 'haji'`, jatuh ke aturan global (default 20 %, pembulatan 50.000). **Tidak ada baris `DocumentRequirement`/`ManifestFieldRequirement` untuk Haji** hari ini.

---

## 3. Tipe & Validasi

`lib/validators/adminUpdates.ts`: `hajiProductCreateSchema` (`:80`) dan `hajiProductUpdateSchema` (`:99`) — keduanya `.strict()`, pesan berbahasa Indonesia, **tanpa `price`** (harga bukan masukan; mengirimnya → 400), tanpa `pendingQuota`/`bookedQuota` (milik mesin booking). Deskripsi memakai `richTextField()`. Komponen biaya: `lib/validators/costComponent.ts` (`.strict()`). Booking: `lib/validators/booking.ts` (`itemType: 'haji'`, `hajiProductId`, `numPersons`).

---

## 4. API Routes (aktual)

| Route | Method | Peran | Fungsi |
|---|---|---|---|
| `/api/v1/admin/products/haji` | GET | manager+ | daftar semua produk (admin) |
| | POST | manager+ | buat produk; `price: 0`, `priceLabel: 'per orang'` |
| `/api/v1/admin/products/haji/[id]` | GET | manager+ | satu produk + `bookingCount` |
| | PUT | manager+ | koreksi bidang apa pun (termasuk `isActive` = aktifkan kembali); `totalQuota` tak boleh < pending + booked (409) |
| | DELETE | manager+ | **hapus aman**: belum pernah dipesan → hapus sungguhan + baris polimorfik miliknya; ada booking → nonaktif + pesan (`lib/haji/delete.ts`) |
| `/api/v1/admin/products/haji/[id]/costs` | GET, POST | **superadmin** | daftar / tambah Komponen Biaya (handler bersama) |
| `…/costs/[costId]` | PUT, DELETE | **superadmin** | ubah / hapus komponen — dicakup ke produk dan modul |
| `…/costs/simulate` | GET | **superadmin** | pratinjau HPP → harga jual (margin tipe `haji`) |
| `/api/v1/catalog/haji` | GET | publik | katalog aktif; peta eksplisit `toCatalogHaji` (tanpa kolom kuota mentah), `priced`, `available = total − pending − booked`; produk belum berharga di urutan akhir |
| `/api/v1/bookings` | POST | login | `items[].itemType = 'haji'`: `reserveHaji` (tolak nonaktif/harga ≤ 0 → 422; kuota habis → 409), `totalPrice` server |

Semua route admin: peran dicek di awal handler; galat dibedakan (`authFailureResponse`/`isRecordNotFound`); body diparse Zod. Route biaya hanya re-export `createCostComponentHandlers('haji')` (`lib/pricing/costComponentHandlers.ts`).

---

## 5. Komponen Frontend

| Berkas | Fungsi |
|---|---|
| `app/[locale]/admin/(protected)/products/haji/page.tsx` | daftar + form buat (tanpa kolom harga; "Belum diatur" bila 0), tautan **Kelola**, Aktifkan/Nonaktifkan cepat |
| `app/[locale]/admin/(protected)/products/haji/[id]/page.tsx` | edit penuh: Info Produk (kuota + Ditahan/Terjual/Sisa, deskripsi teks kaya, "Yang Termasuk", saklar Aktif), `CostComponentsPanel`, kartu **Harga Jual per Orang**, **Zona Berbahaya** (Hapus Produk / Nonaktifkan Produk, dengan konfirmasi) |
| `components/admin/pricing/CostComponentsPanel.tsx` + `VendorCurrencyField.tsx` | komponen universal Komponen Biaya (dipakai juga Paket Umroh & Paket Ziarah) |
| `app/[locale]/(public)/haji/page.tsx` | katalog publik per jenis; "Harga belum ditetapkan" bila belum berharga; kursi tersedia memperhitungkan `pending` |

---

## 6. Alur Data End-to-End

1. **Buat** (`POST`) → produk dengan `price = 0`, aktif, kuota sesuai input.
2. **Isi harga**: superadmin menambah Komponen Biaya → `computeCostComponents('haji', id)` (HPP dari kurs terbaru + margin tipe `haji` + pembulatan, **per komponen**, lalu dijumlah) → `refreshHajiPriceCache` menulis `HajiProduct.price`. Cron kurs (`lib/cron/exchangeRateJob.ts`) memanggil `refreshAllHajiPriceCaches` saat kurs berubah — semua produk, termasuk yang nonaktif.
3. **Katalog**: `/haji` dan `/api/v1/catalog/haji` menampilkan produk aktif; harga 0 → "Harga belum ditetapkan".
4. **Booking** (`POST /bookings`, saat ini hanya via API): dalam satu transaksi `reserveHaji` memeriksa aktif + harga > 0 + kuota lalu menaikkan `pendingQuota`; `BookingHaji.totalPrice = price × numPersons` (server); `totalAmount` booking dijumlah server.
5. **Pembayaran**: konfirmasi admin → `quotaAdapters.haji.confirm` (pending → booked); penolakan/pembatalan/kedaluwarsa → `quotaAdapters.haji.release` (`lib/booking/cancel.ts`).
6. **Invoice**: `lib/pdf/invoiceData.ts` menormalisasi baris Haji (`label` = nama produk, `qty` = jumlah orang).
7. **Hapus**: lihat DELETE di §4 — produk bertransaksi tidak pernah dihapus keras, sehingga booking/invoice tak yatim.

---

## 7. Gap / Ketidaksesuaian Aktif

**Terbuka (sengaja belum dikerjakan):**
1. **Tidak ada checkout/wizard di browser untuk Haji** — API dan skema sudah menerima `itemType='haji'` (dibuktikan end-to-end via HTTP), tetapi tidak ada UI yang mengirimnya (`grep` `hajiProductId` di `app/`+`components/` kosong). Jamaah belum bisa memesan Haji lewat browser; CTA di `/haji` menuju `/register`.
2. **"Visa Haji" belum ada sebagai konsep tersendiri** — keputusan pemilik: visa haji berbeda sama sekali dari `VisaProduct` umroh; jangan memakai pola `pilgrims[].visaProductId` untuk Haji. Hari ini komponen biaya "Visa Haji" hanya baris biaya bebas.
3. **Dokumen dan manifest Haji** — belum ada `DocumentRequirement`/`ManifestFieldRequirement` bertipe `haji`; pilgrim Haji akan memakai field manifest "core" (`lib/manifest/constants.ts`) sampai dirancang.
4. **Galeri gambar** — kolom `images` ada tetapi tidak ada jalur unggah/tampil (hotel dan kendaraan punya; Haji belum).
5. **Halaman detail publik per produk** — katalog hanya kartu daftar; belum ada halaman detail/SEO per produk.
6. **Margin per tipe** — aturan `haji` di `PricingRule` hanya lewat data (belum ada UI Pengaturan per tipe); tanpa itu memakai margin global.
7. Jalur balapan hapus-vs-booking (booking masuk di antara pengecekan dan penghapusan → FK `P2003` → nonaktif) hanya dijaga pemeriksaan sumber, tidak disimulasikan dalam tes.

**Ditutup (rangkaian Komponen Biaya, 2026-10-26):** harga Haji manual tanpa HPP/kurs; tidak ada halaman edit; "hapus" hanya menonaktifkan tanpa semantik; **SEC-66** (Medium — Haji berharga 0/nonaktif bisa dipesan gratis), **SEC-67** (katalog membocorkan kolom kuota dan menghitung `available` tanpa `pending`). Register: `docs/lessons-learned.md`.

---

## 8. Pengujian

`scripts/test-haji-pricing.ts` (DB sungguhan, masuk `bun run test`/CI; 12 uji): harga dari komponen + margin tipe/fallback global, scoping komponen (lintas produk/modul), cron kurs, guard booking (nonaktif/harga 0/kuota habis + rollback), hapus aman (hapus keras + pembersihan baris polimorfik vs nonaktif), kontrak skema (tanpa `price`), peta katalog, penjaga sumber wiring dan UI — 7+2 mutasi pengaman tertangkap. `scripts/test-cost-components.ts` mencakup komponen bersama. Verifikasi end-to-end: HTTP nyata (booking Haji sungguhan) dan Chrome headless asli untuk CRUD UI (superadmin dan manager) — rincian di `docs/arsitektur-komponen-biaya.md` §9.3-§9.4.

---

## 9. Referensi Silang

`docs/arsitektur-komponen-biaya.md` (komponen universal ke-6), `docs/arsitektur-harga.md` (HPP/kurs/margin), `docs/arsitektur-booking.md` (engine booking, adapter kuota), `docs/arsitektur-umroh.md` §7 Gap #1 (riwayat Haji tak bisa dibooking), `docs/arsitektur-editor-teks.md` (deskripsi), `docs/lessons-learned.md` SEC-66/SEC-67.
