# Arsitektur — Harga & HPP Universal

> **Status: DIIMPLEMENTASIKAN & TERVERIFIKASI (scope Visa) — per audit 2026-07-17.** Semua 7 fase di §9 sudah dieksekusi: schema, cron kurs, admin settings, admin HPP per produk, `computeSellPrice()`, cache refresh, dan field snapshot (schema saja, belum diisi kode — lihat §7). Tiap fase diverifikasi `bun run build` (0 error) **dan** fungsional (browser atau query DB langsung), bukan cuma ditulis di dokumen. Dokumen ini awalnya rencana murni (ditulis 2026-07-08, sebelum ada kode), sekarang sudah jadi audit as-built menyusul eksekusi — pola yang sama dengan riwayat modul Transport: `docs/arsitektur-transport.md` (rencana, sudah dihapus & diserap) → `docs/arsitektur-transportasi.md` (as-built, dokumen yang berlaku sekarang).
>
> **Scope saat ini: Visa saja** (karena baru itu yang punya data HPP nyata — tabel BRN yang dilampirkan user). Skema generik (`ProductCost` dkk, polimorfik) sudah siap diperluas ke Hotel/Transport/Muthowif/Haji **tanpa migrasi ulang** begitu ada data HPP nyata untuk modul itu — lihat §8.
>
> **Ketidaksesuaian aktif yang perlu diketahui sebelum modul lain dikerjakan** — lihat §13 untuk detail lengkap: (1) `spreadPercent` kurs masih hardcode di kode, belum admin-configurable seperti rencana awal; (2) field snapshot di `VisaApplication` (§7) ada di schema tapi belum diisi kode manapun — bergantung pada Gap #1/#2 `docs/arsitektur-visa.md` §7 yang di luar scope pricing.
>
> **Redesain UI input HPP selesai (2026-07-18)** — lihat §14: panel admin "HPP & Komponen Biaya" (§12) diganti dari form komponen bebas jadi tabel tier gabungan (Harga Visa + Harga BRN dalam satu baris per rentang hari), setelah ditemukan mismatch bentuk input saat dipakai user langsung. Skema & `computeSellPrice()` tidak berubah — murni redesain endpoint+UI. Semua 4 fase dieksekusi & diverifikasi (build + browser + query DB langsung).

> **Pembaruan 2026-10-26 — Komponen Biaya kini komponen universal.** Route CRUD biaya, hitung per komponen (`computeCostComponents`), registry pemilik, dan panel UI (`components/admin/pricing/CostComponentsPanel.tsx`) dipakai bersama Paket Umroh, Paket Ziarah, dan Haji — rujukan berkas/route inline pada bagian "Komponen Biaya" di bawah adalah riwayat; sumber kebenaran: `docs/arsitektur-komponen-biaya.md`.

---

## 1. Konteks Bisnis

Saudinesia beli layanan (khususnya visa) dari beberapa syarikah/vendor berbeda, dengan HPP (harga pokok) dalam USD yang bervariasi per jumlah hari (visa berdurasi lebih lama = HPP lebih tinggi, tidak selalu linear). HPP itu perlu dikonversi ke Rupiah pakai kurs yang berubah tiap hari, lalu ditambah margin keuntungan minimum yang bisa admin atur sendiri, sebelum jadi harga jual yang ditampilkan ke pelanggan (dengan pembulatan psikologis, mis. Rp 2.859.424 → Rp 2.900.000 untuk display).

Tiga masalah yang membuat ini butuh arsitektur sendiri (bukan sekadar field tambahan di `VisaProduct`):
1. **HPP bervariasi per vendor** (syarikah A ≠ syarikah B) — satu produk visa bisa punya beberapa harga sumber, bukan satu HPP tunggal.
2. **Kurs berubah tiap hari, dan ada 2 pasangan mata uang yang dibutuhkan**: USD→IDR dan SAR→IDR (Riyal Saudi) — harga jual harus pakai kurs "jual" (dengan spread) untuk keduanya, bukan kurs tengah mentah dari API. Lihat §4.1 untuk detail sumber data per pasangan.
3. **Ini lintas modul** — Hotel/Transport/Muthowif/Haji berpotensi punya eksposur HPP mata uang asing yang sama (dibayar ke vendor Saudi, kemungkinan besar dalam SAR), bukan cuma Visa.

---

## 2. Prinsip Desain

- **Satu tabel `ProductCost` generik**, di-join lewat `productType` + `productId` (pola polimorfik yang sama dengan `PackageItem`, lihat `docs/arsitektur-booking.md` §2) — bukan field HPP nempel di tiap tabel produk (`VisaProduct.hppUsd`, dst.) yang akan terduplikasi di 6+ tabel.
- **Kurs di-cache, bukan di-fetch live per request.** Cron job (pola sama dengan `startAutoCancelJob()`/`startPaymentReminderJob()` yang sudah ada) fetch kurs 1-2x sehari, simpan ke tabel `ExchangeRate`, semua kalkulasi baca dari cache.
- **Kurs jual ≠ kurs mentah.** Setiap baris `ExchangeRate` simpan `midRate` (dari API) dan `sellRate` (mid + spread admin-configurable) terpisah.
- **Snapshot saat transaksi, bukan live-reference** — begitu ada booking yang pakai HPP/kurs/margin tertentu, nilai-nilai itu dibekukan di record booking (pola yang sama dengan `BookingTransport.unitPrice`), supaya margin riil bisa dihitung akurat kapan pun di kemudian hari, bukan berubah ikut kurs hari ini.
- **Margin minimum admin-configurable, bukan hardcode** — satu setting global (default berlaku semua produk) dengan opsi override per `productType`.
- **Append-only untuk riwayat kurs** — jangan overwrite satu baris "kurs saat ini", simpan tiap fetch sebagai baris baru, supaya ada histori untuk audit.

---

## 3. Skema yang Diusulkan

### 3.1 `Vendor` (Syarikah)

> **DIGANTIKAN (vendor F5, 2026-10-26):** model `Vendor` di bawah (kolom `category`/`country`/`contactInfo` teks bebas) sudah tidak ada. Skema, API, UI, dan aturan integritas vendor yang berlaku ada di **`docs/arsitektur-vendor.md`** (ADR-0003). Isi bagian ini dipertahankan sebagai riwayat saja.

```prisma
model Vendor {
  id          String   @id @default(uuid())
  name        String   // "Syarikah Al-Rajhi", "Syarikah Makkah Prima", dll — bebas, tidak hardcode
  country     String   @default("Saudi Arabia")
  contactInfo String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  costs ProductCost[]
  @@map("vendors")
}
```

### 3.2 `ExchangeRate` (riwayat kurs, append-only)

```prisma
model ExchangeRate {
  id            String   @id @default(uuid())
  fromCurrency  String   // "USD"
  toCurrency    String   @default("IDR")
  midRate       Decimal  @db.Decimal(12, 4)  // mentah dari API/JISDOR
  spreadPercent Decimal  @db.Decimal(5, 2)   // persen tambahan, admin-configurable
  sellRate      Decimal  @db.Decimal(12, 4)  // midRate * (1 + spreadPercent/100) — dihitung saat insert, disimpan (bukan computed column) untuk snapshot yang stabil
  source        String   // "BI_JISDOR" | "EXCHANGERATE_API" | dll — supaya tahu asal data saat audit
  fetchedAt     DateTime @default(now())

  @@index([fromCurrency, toCurrency, fetchedAt])
  @@map("exchange_rates")
}
```

Kalkulasi harga selalu pakai baris **terbaru** (`fetchedAt` terbesar) untuk pasangan currency yang relevan — tapi baris lama tidak dihapus, tetap ada untuk histori/audit.

### 3.3 `ProductCost` (HPP, polimorfik + multi-komponen + multi-vendor PER KOMPONEN + day-tiers)

> **Direvisi 2026-07-08 (revisi kedua)** setelah klarifikasi user: kolom "BRN" di tabel bukan angka biaya — itu **nama syarikah/vendor** yang menyuplai komponen biaya khusus varian **Non-Hotel**. Klarifikasi lengkap:
> - **"HPP Visa Individu"** (117 USD, flat) = komponen biaya proses visa standar — inilah **HPP untuk Visa Reguler Umroh** (satu-satunya komponennya, karena Reguler sudah bundling hotel asli).
> - **"BRN"** = vendor yang menyuplai komponen biaya tambahan khusus **Visa Non-Hotel** (bervariasi per hari: 9,38 di hari-7 sampai 113,94 di hari-85).
> - **HPP untuk Non-Hotel** = komponen "Individu" (117, sama seperti Reguler) **+** komponen dari vendor BRN — dua komponen, dua vendor berbeda, dijumlahkan.
>
> Konsekuensi penting: **komponen berbeda dalam satu produk boleh disuplai vendor berbeda** — bukan satu vendor untuk seluruh HPP produk. Kalau nanti ada syarikah lain menawarkan komponen "biaya non-hotel" dengan harga beda dari BRN, itu jadi kompetisi **di level komponen**, bukan di level produk keseluruhan — makanya "vendor pilihan" (§3.4 di bawah) harus per (produk, komponen), bukan per produk saja.

```prisma
model ProductCost {
  id            String   @id @default(uuid())
  productType   String   // "visa" | "hotel" | "transport" | dst — sama konvensi dengan PackageItem.productType
  productId     String   // FK polimorfik ke VisaProduct.id, dst — tidak di-enforce di DB, sama seperti PackageItem
  vendorId      String
  costComponent String   // BARU — label bebas: "government_fee", "individual_fee", "service_fee", dll (bukan hardcode/enum)
  currency      String   // "USD" | "SAR" | "EUR" | dst — bebas, tidak hardcode. Tiap komponen boleh beda currency.
  costTiers     Json     // day-based, POLA SAMA dengan VisaProduct.durationFeeRules (docs/arsitektur-visa.md §9.3):
                          // [{ minDays, maxDays, cost }] — cost flat per tier, bukan dikali hari.
                          // Untuk komponen yang tidak day-based (mis. "individual_fee" = 117 USD di semua hari),
                          // cukup satu baris { minDays: 0, maxDays: 9999, cost: 117 }
  isActive      Boolean  @default(true)
  notes         String?

  vendor Vendor @relation(fields: [vendorId], references: [id])
  @@map("product_costs")
}
```

**Kalkulasi HPP total** untuk satu produk + satu jumlah hari = **jumlahkan HPP dari SEMUA komponen yang berlaku untuk produk itu** (mis. Non-Hotel = komponen "individu" + komponen "biaya-non-hotel"; Reguler = komponen "individu" saja) — untuk tiap komponen, ambil vendor yang sedang **preferred untuk komponen itu** (lihat `PreferredVendor` di bawah), konversi ke IDR pakai `ExchangeRate` sesuai `currency` komponen itu (komponen "individu" dalam USD dan komponen "biaya-non-hotel" dalam SAR misalnya, bisa hidup berdampingan, masing-masing pakai kurs pasangannya sendiri), baru dijumlahkan totalnya dalam Rupiah.

**"Vendor pilihan" per KOMPONEN, bukan per produk** — karena komponen berbeda dalam satu produk bisa disuplai vendor berbeda (contoh BRN di atas), dan kompetisi antar-syarikah terjadi di level komponen (mis. dua syarikah sama-sama bisa menawarkan komponen "biaya-non-hotel" dengan harga beda):

```prisma
model PreferredVendor {
  id            String @id @default(uuid())
  productType   String
  productId     String
  costComponent String  // HARUS sama dengan costComponent di ProductCost yang mau dipilih vendornya
  vendorId      String

  @@unique([productType, productId, costComponent])  // satu komponen dalam satu produk = satu vendor pilihan pada satu waktu
  @@map("preferred_vendors")
}
```

**Contoh konkret (Visa Non-Hotel Umroh):**
- `ProductCost` baris 1: `costComponent: "individu"`, `vendorId: <vendor generik/pemerintah>`, `currency: "USD"`, `costTiers: [{minDays:0, maxDays:9999, cost:117}]`
- `ProductCost` baris 2: `costComponent: "biaya_non_hotel"`, `vendorId: <vendor "BRN">`, `currency: "USD"`, `costTiers: [{minDays:7,maxDays:7,cost:9.38}, {minDays:8,maxDays:8,cost:10.72}, ..., {minDays:75,maxDays:75,cost:100.54}, {minDays:85,maxDays:85,cost:113.94}]`
- `PreferredVendor` baris 1: `costComponent: "individu"` → vendor generik
- `PreferredVendor` baris 2: `costComponent: "biaya_non_hotel"` → vendor BRN (bisa diganti ke syarikah lain kapan saja tanpa menyentuh baris "individu")

**Visa Reguler Umroh** hanya punya SATU baris `ProductCost` (`costComponent: "individu"`, kemungkinan besar nilai & vendor sama dengan yang dipakai Non-Hotel di atas) — tidak ada baris "biaya_non_hotel" sama sekali untuk produk ini.

**Kenapa `costTiers` polanya sama persis dengan `durationFeeRules` di §9.3 `docs/arsitektur-visa.md`:** karena secara struktural memang masalah yang sama (harga/biaya yang bervariasi per rentang hari) — satu pola dipakai dua sisi (sisi HPP dan sisi harga jual), bukan dua struktur berbeda yang harus dipelihara terpisah.

### 3.4 `PricingRule`

> **Diperbarui 2026-10-27 (Fase 0 harga terpadu):** baris global kini berkunci `productType = 'global'` (non-NULL, unik), bukan `NULL` — lihat `docs/arsitektur-harga-terpadu.md` §13. Nilai bawaan 20 % / 50.000 hanya di `lib/pricing/pricingHelpers.ts`.
 (margin minimum, global + override per tipe)

```prisma
model PricingRule {
  id               String   @id @default(uuid())
  productType      String?  // null = default global, "visa" = override khusus tipe itu
  minMarginPercent Decimal  @db.Decimal(5, 2)  // mis. 20.00 untuk 20%
  roundingIncrement Int     @default(50000)     // pembulatan ke kelipatan ini, mis. 50000 = kelipatan Rp50rb
  updatedAt        DateTime @updatedAt

  @@unique([productType])
  @@map("pricing_rules")
}
```

Admin atur ini lewat `app/[locale]/admin/(protected)/system/settings/page.tsx` — **sudah dibangun** (Fase 3, section "Margin & Pembulatan Harga"). Detail halaman & API di §12.

---

## 4. Cron Job Kurs

Pola: sama seperti `lib/cron/autocancelJob.ts` (node-cron in-process, didaftarkan dari `instrumentation.ts`).

### 4.1 Dua Pasangan Mata Uang Dibutuhkan

Dikonfirmasi user: butuh **USD→IDR** (untuk komponen HPP visa yang dalam USD, mis. fee 117 USD di tabel BRN) **dan SAR→IDR** (untuk komponen HPP dalam Riyal, dan berpotensi dipakai modul lain — Hotel/Transport/Muthowif yang dibayar ke vendor Saudi). Skema `ExchangeRate` di §3.2 **sudah otomatis mendukung ini tanpa perubahan** — `fromCurrency`/`toCurrency` bebas string, satu tabel menampung banyak pasangan. Yang perlu diubah hanya cron job: **fetch kedua pasangan tiap kali jalan**, simpan sebagai 2 baris terpisah per fetch (bukan cuma 1 pasangan).

**Catatan penting (riset 2026-07-08):** Saudi Riyal **di-peg tetap ke USD sejak 1986 di rate 3,75 SAR = 1 USD**, sangat stabil, diperkirakan tetap begitu di 2026. Ini **bukan alasan untuk hardcode 3,75 di kode** (tetap fetch SAR→IDR langsung dari sumber, konsisten dengan prinsip anti-hardcode) — tapi bisa dipakai sebagai **validasi sanity-check** di cron job: kalau rate SAR→IDR yang di-fetch, dibagi rate USD→IDR yang di-fetch di waktu yang sama, hasilnya menyimpang jauh dari ~3,75, itu sinyal ada yang salah di data API (log warning, tapi tetap simpan datanya — jangan block).

### 4.2 Sumber Data — Terpengaruh oleh Kebutuhan Dua Pasangan

| | **Bank Indonesia (JISDOR)** | **ExchangeRate-API** | **Frankfurter** |
|---|---|---|---|
| Cakupan pasangan | Hanya USD/IDR (JISDOR spesifik untuk USD) — **tidak ada SAR/IDR resmi dari BI** | 165 mata uang, **termasuk SAR** (dikonfirmasi) | ECB-based — **SAR tidak didukung sama sekali** (dikonfirmasi lewat tracker currency mereka) |
| Otoritas | Resmi, kurs acuan negara | Agregator pihak ketiga | Agregator pihak ketiga |
| Format API | SOAP/XML lama, perlu parsing | REST/JSON sederhana | REST/JSON sederhana |
| Kesimpulan | Bisa jadi sumber USD/IDR saja (kalau mau otoritatif untuk pasangan itu) | **Satu-satunya kandidat yang bisa mengisi KEDUA pasangan dari satu sumber konsisten** | Tereliminasi untuk kebutuhan ini — tidak ada SAR |

**Rekomendasi diperbarui:** pakai **ExchangeRate-API** untuk kedua pasangan (USD→IDR dan SAR→IDR) dari satu sumber yang konsisten — Frankfurter otomatis gugur karena tidak punya SAR, dan BI JISDOR hanya menutupi separuh kebutuhan (USD saja). Kalau nanti kebutuhan akuntansi formal mengharuskan sumber resmi khusus USD/IDR, JISDOR bisa ditambahkan sebagai sumber KEDUA khusus pasangan itu (dua sumber berbeda per pasangan mata uang, `source` field di `ExchangeRate` sudah mencatat asal data per baris) — tapi ini penyempurnaan, bukan blocker untuk mulai.

**Jadwal yang diusulkan — 2x sehari, fetch kedua pasangan tiap kali jalan:**
- **08:00 WIB** dan **16:00 WIB** — dua kali fetch, tiap fetch mengambil USD→IDR dan SAR→IDR sekaligus, disimpan sebagai 2 baris baru di `ExchangeRate`.
- Kalau API gagal/rate limit: tetap pakai baris `ExchangeRate` terakhir yang ada per pasangan (tidak error, tidak block sistem) — dua pasangan independen, kegagalan salah satu tidak mempengaruhi yang lain.

`spreadPercent` (untuk `sellRate`) tetap admin-configurable per pasangan mata uang — bukan hardcode, dan tidak harus sama antara USD dan SAR.

---

## 5. Alur Kalkulasi Harga Jual

> **Direvisi 2026-07-08 (revisi kedua)** — vendor sekarang dipilih **per komponen** (lewat `PreferredVendor` yang scoped ke `costComponent`), bukan satu vendor untuk seluruh produk — lihat contoh konkret Reguler vs Non-Hotel di §3.3.

Fungsi murni (tidak disimpan sebagai model, dihitung saat dibutuhkan):

```
computeSellPrice(productType, productId, jumlahHari):
  1. components = semua ProductCost aktif WHERE productType, productId
     (bisa lebih dari satu costComponent — mis. "individu" + "biaya_non_hotel")
  2. hppRupiah = 0
     untuk setiap component di components:
       preferredVendorId = PreferredVendor untuk (productType, productId, component.costComponent)
       jika component.vendorId != preferredVendorId: skip baris ini
         // ← satu komponen bisa punya beberapa baris ProductCost (beberapa syarikah bersaing),
         //   tapi cuma vendor yang preferred UNTUK KOMPONEN ITU yang dipakai kalkulasi
       tier = cari baris component.costTiers di mana minDays <= jumlahHari <= maxDays
       rate = ExchangeRate terbaru untuk (component.currency → IDR)
       hppRupiah += tier.cost * rate.sellRate
  3. marginRule = PricingRule untuk productType, fallback ke productType=null (global)
  4. minSellPrice = hppRupiah * (1 + marginRule.minMarginPercent / 100)
  5. sellPrice = roundToNearest(minSellPrice, marginRule.roundingIncrement)
     // ← BUKAN roundUp — tabel BRN menunjukkan pembulatan ke kelipatan TERDEKAT,
     //   bisa naik atau turun tergantung mana yang lebih dekat
  return { hppRupiah, minSellPrice, sellPrice, rateUsed: [...id per komponen], vendorUsed: [...vendorId per komponen] }
```

**Validasi harga jual manual (kalau admin override harga produk secara manual):** tolak (400/422) kalau harga yang diinput admin < `minSellPrice` hasil kalkulasi (sebelum pembulatan) — ini yang mewujudkan kebutuhan awal user: "HPP 10rb, jual minimal 20% jadi 12rb, tidak boleh di bawah itu." Pembulatan (`roundToNearest`) hanya berlaku untuk harga TAMPILAN/jual final, tidak mengubah ambang minimum yang divalidasi.

---

## 6. Cache Harga Jual di `VisaProduct` (Referensi Resmi untuk Visa)

> **Baru 2026-07-08** — sesuai arahan user: arsitektur harga ini jadi **rujukan resmi** untuk harga Visa. `VisaProduct.price` dan `durationFeeRules` (`docs/arsitektur-visa.md` §9.2-9.3) **bukan lagi field yang diisi admin manual** — keduanya jadi **cache/snapshot hasil `computeSellPrice()`**, supaya harga tidak perlu dihitung ulang tiap kali katalog/wizard dibuka (alasan sama dengan kenapa kurs di-cache, bukan fetch live — lihat §2).

### 6.1 Kapan Cache Di-refresh

Cache (`VisaProduct.price` + `durationFeeRules`) dihitung ulang dan disimpan ulang pada 2 pemicu:

1. **Perubahan data** — begitu admin mengubah `ProductCost` (HPP/vendor/komponen), `PreferredVendor`, atau `PricingRule` untuk produk itu → recalculate seketika untuk produk yang terpengaruh saja.
2. **Setelah cron kurs jalan** (§4, jam 08:00 & 16:00 WIB) → recalculate SEMUA produk yang komponennya pakai `currency` yang baru saja di-refresh (mis. kurs USD berubah → semua produk dengan komponen USD di-recalculate; kurs SAR tidak berubah → produk yang cuma pakai SAR tidak perlu disentuh).

### 6.2 Cara Menghasilkan `durationFeeRules` dari `ProductCost`

Boundary hari di `durationFeeRules` **diturunkan otomatis** dari union semua `minDays`/`maxDays` yang ada di `ProductCost.costTiers` milik produk itu (lintas semua `costComponent` aktifnya) — bukan diketik manual oleh admin:

```
refreshVisaProductCache(productId):
  boundaries = union semua {minDays, maxDays} dari ProductCost.costTiers
               WHERE productType="visa", productId=ini, isActive=true
  untuk setiap boundary (kecuali yang dianggap "default"):
    hasil = computeSellPrice("visa", productId, jumlahHariRepresentatif)
    upsert ke durationFeeRules: { minDays, maxDays, fee: hasil.sellPrice }
  hasilDefault = computeSellPrice("visa", productId, jumlahHariDefault)
  update VisaProduct.price = hasilDefault.sellPrice
```

Admin tidak lagi punya form untuk mengetik nilai `fee` — yang admin kelola adalah **input di sisi HPP** (`ProductCost` per komponen, §3.3) dan margin (`PricingRule`, §3.4). Harga jual "muncul sendiri" dari situ.

**Konsekuensi ke §9.4 `docs/arsitektur-visa.md`:** halaman admin `/products/visa/[id]` punya section baru "HPP & Komponen Biaya" untuk kelola `ProductCost` per komponen — **sudah dibangun** (Fase 4), bukan lagi requirements-builder-style form untuk `durationFeeRules` langsung. Detail di §12.

Implementasi aktual `refreshVisaProductCache()` memilih hari probe untuk "default" (`jumlahHariDefault` di pseudocode atas) = **hari ke-1**, konstanta `DEFAULT_PROBE_DAY` di `lib/pricing/refreshVisaProductCache.ts` — dipilih sebagai probe netral (bukan hardcode angka bisnis "7 hari"): kalau ada komponen yang berlaku di semua durasi (tier `[0,9999]`), dia akan match di hari berapa pun termasuk hari 1; kalau tidak ada komponen yang match hari 1, hasilnya 0 (produk itu memang tidak punya harga default yang berarti tanpa memilih durasi tertentu dulu).

---

## 7. Snapshot Saat Transaksi

Begitu booking/pesanan dibuat dengan harga hasil kalkulasi di atas, field berikut **dibekukan** di record booking terkait (bukan dihitung ulang nanti):
- `vendorId` yang dipakai (HPP dari syarikah mana, per komponen — bisa lebih dari satu)
- `exchangeRateId` yang dipakai (kurs berapa saat itu — FK ke `ExchangeRate`, bukan salin angka mentah, supaya tetap bisa telusur sumbernya)
- `hppRupiah`, `sellPrice` final saat itu

Ini konsisten dengan pola snapshot yang sudah ada di `BookingTransport.unitPrice`, dan penting supaya laporan margin/keuntungan tetap akurat historis meski kurs besok berubah.

**Status aktual (Fase 7, 2026-07-17): field sudah ada di schema, TAPI belum diisi kode manapun.** `VisaApplication` punya 5 kolom baru: `selectedDurationDays`, `hppSnapshotRupiah`, `sellPriceSnapshot`, `exchangeRateIdsUsed` (Json, array string ID), `vendorIdsUsed` (Json, array string ID) — persis field yang dideskripsikan di atas. Pengisiannya menunggu `POST /api/v1/bookings` benar-benar men-set `visaProductId` dan memanggil `computeSellPrice()` saat create booking, yang bergantung pada Gap #1 (`visaApplication.visaProductId` tidak pernah di-set) dan Gap #2 (wizard belum punya step pilih `VisaProduct`) di `docs/arsitektur-visa.md` §7 — keduanya **di luar scope eksekusi arsitektur harga**, harus dikerjakan sebagai bagian dari perbaikan gap Visa itu sendiri.

---

## 8. Lingkup Bertahap

**Tahap 1 (sekarang):** Bangun skema generik (`Vendor`, `ExchangeRate`, `ProductCost`, `PricingRule`) + cron kurs + halaman settings margin minimum. **Isi data HPP hanya untuk Visa** (karena baru itu yang datanya nyata, sesuai tabel BRN).

**Tahap 2 (nanti, tidak dikerjakan sekarang):** Setelah pola ini terbukti jalan di Visa, isi `ProductCost` untuk Hotel/Transport/Muthowif/Haji **tanpa migrasi skema** — tinggal tambah baris, karena skemanya sudah generik sejak awal.

### 8.1 Yang Reusable 100% vs Yang Butuh "Kabel Penghubung" per Produk

Harga/HPP didesain sebagai **komponen yang bisa dipasang ke produk mana pun** lewat `productType`/`productId` — tapi tidak sepenuhnya nol-kode saat dipasang ke produk baru. Rinciannya:

**Reusable 100% tanpa sentuh kode sama sekali** (`Vendor`, `ExchangeRate`, `ProductCost`, `PricingRule`, `PreferredVendor`, fungsi `computeSellPrice()`) — semuanya sudah sama sekali tidak tahu-menahu soal "ini visa atau hotel", cuma soal komponen biaya, kurs, dan margin.

**Butuh "adapter" tipis per tipe produk** (pola yang sama dengan adapter registry kuota di `docs/arsitektur-booking.md` §3.2) — khususnya fungsi `refresh*ProductCache()` (§6.2), karena:
- Tempat hasil hitungan di-cache beda per produk (Visa → `VisaProduct.price`/`durationFeeRules`; nanti Hotel → `HotelRoom.priceRegular` dkk; Transport → `TransportPricing.charterRegular` dkk)
- Bentuk "tier" beda per produk (Visa per rentang hari; Hotel per season; Transport per charter/per-kursi × season)

Jadi untuk memasang harga ini ke produk baru nanti, yang perlu ditulis cuma satu fungsi kecil "baca `ProductCost` → tulis ke field harga produk itu sendiri" — bukan desain ulang `ProductCost`/`ExchangeRate`/`PricingRule`, itu semua tetap dipakai apa adanya.

---

## 9. Urutan Implementasi — SEMUA SELESAI (2026-07-17)

> Dipertahankan sebagai catatan historis rencana asli. Status tiap step dikonfirmasi lewat `bun run build` (0 error di tiap fase) + verifikasi fungsional (browser/query DB langsung) — detail di `docs/progress.md` dan `docs/decisions.md` per tanggal 2026-07-17. Nomor "Step" di sini = "Fase" di `docs/progress.md`.

```
Step 1 — Schema ✓ SELESAI
  - Model Vendor, ExchangeRate, ProductCost (dengan costComponent), PricingRule, PreferredVendor
  - Migrasi Prisma (add_pricing_hpp_infrastructure)

Step 2 — Cron kurs ✓ SELESAI
  - lib/cron/exchangeRateJob.ts — fetch 08:00 & 16:00 WIB untuk USD→IDR DAN SAR→IDR, simpan ke ExchangeRate
  - Daftarkan di instrumentation.ts (pola sama dengan cron lain)
  - Sumber API: ExchangeRate-API (open.er-api.com), dikonfirmasi via §4.2

Step 3 — Admin: Settings halaman baru ✓ SELESAI
  - app/[locale]/admin/(protected)/system/settings/page.tsx
  - CRUD PricingRule (margin minimum global, belum ada override per productType di UI — cuma global untuk saat ini)
  - CRUD Vendor (syarikah) — create + toggle aktif/nonaktif (bukan delete fisik)

Step 4 — Admin: HPP per produk Visa ✓ SELESAI
  - Section "HPP & Komponen Biaya" di /products/visa/[id] — input ProductCost per komponen biaya, costTiers builder, vendor per komponen, tombol "Jadikan Pilihan" untuk PreferredVendor per komponen

Step 5 — Fungsi kalkulasi ✓ SELESAI
  - lib/pricing/computeSellPrice.ts — implementasi §5, diverifikasi dengan data nyata

Step 6 — Cache refresh (§6) ✓ SELESAI
  - lib/pricing/refreshVisaProductCache.ts — implementasi §6.2
  - Disambungkan ke 5 titik pemicu (lihat §11): create/update/delete ProductCost, update PreferredVendor, update PricingRule global (fire-and-forget), akhir cron kurs (awaited)
  - VisaProduct.price dan durationFeeRules TIDAK LAGI form input manual di admin UI — dihapus dari Step 4, digantikan hasil cache ini

Step 7 — Snapshot di booking — SCHEMA SELESAI, BELUM DIISI
  - Field snapshot ditambahkan ke VisaApplication (migrasi add_visa_application_price_snapshot)
  - Pengisian menunggu Gap #1/#2 docs/arsitektur-visa.md §7 (di luar scope pricing) — lihat §7 dan §13

Step 8 — Build + dokumentasi ✓ SELESAI
  - bun run build 0 error di tiap fase, docs/progress.md dan docs/decisions.md diupdate tiap fase
```

---

## 10. Keputusan Arsitektur

| # | Keputusan | Alasan |
|---|-----------|--------|
| 1 | `ProductCost` polimorfik (`productType`+`productId`), bukan field HPP di tiap tabel produk | Menghindari duplikasi skema di 6+ tabel produk; pola sama dengan `PackageItem` yang sudah diterima di codebase |
| 2 | Kurs di-cache via cron, bukan fetch live per request | Latensi, ketahanan (API down tidak mem-block harga tampil), dan konsistensi harga dalam satu sesi user |
| 3 | `midRate` dan `sellRate` disimpan terpisah, `sellRate` = mid + spread admin-configurable | Mewujudkan kebutuhan "kurs jual ≠ kurs tengah" yang disebut user secara eksplisit |
| 4 | `ExchangeRate` append-only (riwayat), bukan satu baris "current" yang di-overwrite | Snapshot butuh FK ke baris kurs spesifik yang dipakai saat transaksi, untuk audit margin historis |
| 5 | `costTiers` di `ProductCost` pakai struktur sama dengan `durationFeeRules` di Visa | Masalah struktural yang sama (harga bervariasi per rentang hari) tidak perlu dua pola berbeda |
| 6 | `PricingRule` dengan `productType` nullable (global + override), bukan hardcode persentase di kode | Admin bisa atur margin minimum sendiri, beda per tipe produk kalau perlu, tanpa deploy ulang |
| 7 | Scope data awal: Visa saja, skema tetap generik | Hotel/Transport/dll belum punya data HPP nyata — isi skema kosong untuk modul lain hanya spekulasi, bukan kebutuhan mendesak |
| 8 | Sumber kurs: ExchangeRate-API untuk kedua pasangan (USD/IDR & SAR/IDR), BI JISDOR sebagai opsi tambahan khusus USD/IDR nanti | Frankfurter gugur (tidak dukung SAR), BI JISDOR hanya cakup USD — hanya ExchangeRate-API yang bisa penuhi kedua pasangan dari satu sumber konsisten sekarang |
| 9 | Fetch SAR→IDR langsung dari API, bukan derivasi dari USD→IDR ÷ 3,75 (peg tetap) | Konsisten dengan prinsip anti-hardcode — kalau peg berubah di masa depan (jarang tapi pernah terjadi ke mata uang lain), derivasi manual akan diam-diam salah tanpa terdeteksi. Rasio peg dipakai sebagai sanity-check log warning saja, bukan jalur kalkulasi utama |
| 10 | `ProductCost` per-komponen (`costComponent` label bebas) yang dijumlahkan, bukan satu angka HPP per vendor | Diverifikasi langsung: Visa Reguler HPP = komponen "individu" saja; Visa Non-Hotel HPP = komponen "individu" + komponen dari vendor BRN — dua komponen berbeda per varian, bukan satu nilai |
| 11 | "Vendor pilihan" jadi model `PreferredVendor` di-scope PER KOMPONEN (`productType`+`productId`+`costComponent`), bukan per produk | "BRN" adalah nama vendor yang menyuplai komponen "biaya_non_hotel" — komponen "individu" bisa disuplai vendor lain. Kompetisi antar-syarikah terjadi di level komponen, jadi vendor pilihan juga harus di level komponen |
| 12 | Pembulatan harga jual pakai "ke terdekat" (`roundToNearest`), bukan "selalu ke atas" (`roundUp`) | Diverifikasi langsung terhadap tabel BRN nyata: Rp 2.950.409 dibulatkan TURUN ke Rp 2.950.000, bukan naik — draf pertama salah asumsi |
| 13 | `docs/arsitektur-harga.md` jadi rujukan resmi harga Visa — `VisaProduct.price`/`durationFeeRules` jadi CACHE hasil `computeSellPrice()`, bukan lagi diisi admin manual | Arahan eksplisit user. Menghindari 2 sumber kebenaran harga jual yang bisa saling tidak sinkron (tabel manual vs mesin HPP) — admin cukup kelola HPP+margin, harga jual dihitung otomatis |
| 14 | Cache di-refresh saat data HPP/vendor/margin berubah, DAN setelah tiap cron kurs jalan | Sama alasan dengan kenapa kurs sendiri di-cache (§2) — hindari hitung ulang tiap page view, tapi tetap harus ikut berubah begitu kurs harian ter-update |

---

## 11. API Routes (Aktual, Terverifikasi per File)

| Method | Path | Auth guard | File | Catatan |
|---|---|---|---|---|
| GET, PUT | `/api/v1/admin/system/settings/pricing-rule` | `requireSuperAdmin()` | `admin/system/settings/pricing-rule/route.ts` | GET auto-create baris global (`productType: null`) kalau belum ada. PUT memicu `refreshAllVisaProductCaches()` fire-and-forget |
| GET, POST | `/api/v1/admin/system/settings/vendors` | `requireSuperAdmin()` | `admin/system/settings/vendors/route.ts` | List/create syarikah |
| PUT, DELETE | `/api/v1/admin/system/settings/vendors/[id]` | `requireSuperAdmin()` | `admin/system/settings/vendors/[id]/route.ts` | DELETE = soft (set `isActive: false`), bukan hapus fisik — sama pola dengan Transport vehicle |
| GET, PUT | `/api/v1/admin/products/visa/[id]/cost-tiers` | `requireSuperAdmin()` | `admin/products/visa/[id]/cost-tiers/route.ts` | **Menggantikan `/costs*` (dihapus 2026-07-18, lihat §14).** GET join komponen `individu` (Harga Visa) + `biaya_non_hotel` (Harga BRN) jadi satu array `rows` bentuk tabel (join by `id` yang disimpan di dalam JSON `costTiers`), termasuk `sellPriceOverride` per baris (§15). PUT replace-seluruh: upsert kedua `ProductCost`, auto-`PreferredVendor`, soft-deactivate (`isActive:false`) komponen BRN kalau dikosongkan, lalu `refreshVisaProductCache()` |
| GET | `/api/v1/admin/products/visa/[id]/preview` | `requireSuperAdmin()` | `admin/products/visa/[id]/preview/route.ts` | Query param `?days=N` (default 1). Panggil `computeSellPrice('visa', id, days)` langsung terhadap data **tersimpan** (read-only, tidak menyentuh cache `VisaProduct`), termasuk baris `ExchangeRate` yang dipakai. Sejak §16, UI tabel tier tidak lagi pakai endpoint ini untuk preview per baris (diganti `/simulate`) — tetap ada untuk kebutuhan lain yang butuh baca dari data tersimpan |
| GET | `/api/v1/admin/products/visa/simulate` | `requireSuperAdmin()` | `admin/products/visa/simulate/route.ts` | **Baru (§16)** — sengaja bukan di bawah `[id]/`, tidak bergantung produk spesifik. Query `visaCost`/`visaCurrency`/`brnCost?`/`brnCurrency?`, hitung HPP→harga jual dari angka yang dikirim langsung (belum tentu tersimpan), pakai `simulateSellPrice()`. Dipakai UI §12 untuk preview live per baris tabel tier |
| PUT | `/api/v1/admin/products/visa/[id]` | `requireManager()` | `admin/products/visa/[id]/route.ts` | **`price` dihapus dari schema sejak §17** — request yang tetap mengirim `price` diabaikan Zod, tidak divalidasi/disimpan. `VisaProduct.price` sekarang murni ditulis oleh `refreshVisaProductCache()` |
| POST | `/api/v1/admin/products/visa` | `requireManager()` | `admin/products/visa/route.ts` | **`price` dihapus dari schema sejak §17** — produk baru selalu dibuat dengan `price: 0`, baru terisi setelah komponen HPP diisi di halaman edit |
| GET | `/api/v1/catalog/visa` | publik | `catalog/visa/route.ts` | **`priceIsRange: boolean` ditambahkan sejak §17** (`true` kalau ≥2 harga berbeda di `durationFeeRules`) — dipakai katalog publik untuk label "Mulai dari". `durationFeeRules` sendiri **tidak** di-expose ke publik |

Semua route membedakan `Unauthorized`/`Forbidden` (401/403) dari error lain (500, `console.error`, tanpa bocorkan detail Prisma) — **tidak** mengulangi pola "semua error jadi 403 polos" yang jadi Gap #6 di `docs/arsitektur-visa.md` §7.

---

## 12. Admin UI (Aktual)

**`app/[locale]/admin/(protected)/system/settings/page.tsx`** — 2 section:
- "Margin & Pembulatan Harga" — form `minMarginPercent` + `roundingIncrement`, baca/tulis baris `PricingRule` global
- "Vendor/Syarikah" — tabel + form tambah, toggle status aktif/nonaktif per baris

**`app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`** — panel "Informasi Dasar" **tidak lagi punya input harga** (dihapus §17) — diganti kartu read-only "Harga saat ini: Rp X — dihitung otomatis dari HPP & Komponen Biaya di bawah", sumbernya `product.price` yang di-refresh ulang tiap kali tabel HPP disimpan.

Section "HPP & Komponen Biaya" (di antara requirements builder dan danger zone) — **tabel tier gabungan** (menggantikan form "Tambah Komponen" bebas teks lama, lihat §14):
- 2 vendor-picker tetap di atas: "Vendor & Mata Uang — Harga Visa" (wajib) dan "Harga BRN" di belakang checkbox "Produk ini pakai komponen BRN (opsional)" — masing-masing punya tombol "+ Vendor Baru" inline
- Tabel baris tier: kolom Min Hari, Maks Hari, Harga Visa, Harga BRN, **HPP** (read-only), **Harga Jual** (editable — kosong = otomatis, terisi = override manual §15, baris jadi highlight kuning)
- Kolom HPP & placeholder Harga Jual dihitung **live** lewat debounce 500ms ke `/simulate` (§16) — muncul begitu mengetik, tidak perlu simpan dulu, dan tidak pernah hilang dari layar
- Tombol "+ Tambah Baris", tombol hapus per baris, satu tombol "Simpan Tabel HPP" untuk seluruh grid

**`app/[locale]/admin/(protected)/products/visa/page.tsx`** (listing + buat produk baru) — form "+Tambah Produk" **tidak lagi punya input harga** (dihapus §17), diganti teks penjelas bahwa harga terhitung otomatis setelah komponen HPP diisi di halaman edit. Tabel listing tetap tampilkan kolom harga (read-only, otomatis benar berkat §17.3).

**`app/[locale]/(public)/visa/page.tsx`** (katalog publik) — kartu produk tampilkan prefix **"Mulai dari "** sebelum harga kalau `priceIsRange` true (§17.5), polos kalau tidak.

---

## 13. Gap / Ketidaksesuaian Aktif (per audit 2026-07-17)

| # | Gap | Lokasi | Dampak |
|---|-----|--------|--------|
| 1 | `spreadPercent` kurs hardcode (`DEFAULT_SPREAD_PERCENT = 1.5`), bukan admin-configurable seperti prinsip §2 | `lib/cron/exchangeRateJob.ts` | Admin tidak bisa ubah spread kurs jual tanpa deploy ulang kode — pelanggaran sementara terhadap prinsip anti-hardcode, disengaja karena Fase 3 (settings) belum ada field untuk ini saat Fase 2 dikerjakan |
| 2 | Field snapshot di `VisaApplication` (§7) ada di schema, belum diisi kode manapun | `prisma/schema.prisma` (`VisaApplication`) | Booking yang dibuat hari ini tidak mencatat HPP/kurs/vendor yang dipakai — laporan margin historis tidak bisa dihitung akurat sampai Gap #1/#2 `arsitektur-visa.md` §7 diperbaiki |
| 3 | `PricingRule` override per `productType` (bukan cuma global) belum ada UI-nya | `app/[locale]/admin/(protected)/system/settings/page.tsx` | Skema sudah mendukung (`productType` nullable), tapi admin cuma bisa atur margin global lewat UI saat ini — override per tipe produk harus lewat query manual kalau dibutuhkan sebelum modul lain (Hotel/Transport/dll) mulai pakai arsitektur ini |
| 4 | `@@unique([productType])` di `PricingRule` tidak mencegah banyak baris `productType: null` di Postgres (NULL tidak dianggap sama untuk unique constraint) | `prisma/schema.prisma` | Invarian "hanya 1 baris global" ditegakkan di level aplikasi (`getOrCreateGlobalRule()`), bukan DB — aman selama semua kode akses lewat fungsi itu, tapi rawan kalau ada akses langsung `prisma.pricingRule.create()` di luar fungsi itu nanti |
| 5 | ~~Jalur edit manual lama masih terbuka & tidak sinkron dengan cache.~~ **DITUTUP 2026-07-18 — lihat §17.** | ~~`app/api/v1/admin/products/visa/[id]/route.ts`~~ | ~~Admin bisa mengetik harga manual, tersimpan tanpa validasi, diam-diam ter-overwrite oleh cache refresh berikutnya.~~ |

**Untuk menutup Gap #1:** tambah field `spreadPercent` ke form settings (section margin atau section baru), baca dari `PricingRule` (atau tabel kecil terpisah per currency pair) di `exchangeRateJob.ts` alih-alih konstanta.

**Untuk menutup Gap #2:** perbaiki Gap #1/#2 di `docs/arsitektur-visa.md` §7 dulu (di luar scope dokumen ini), lalu isi field snapshot saat `POST /api/v1/bookings` memproses pilgrim dengan `visaProductId`.

**Gap #5 — DITUTUP 2026-07-18.** Field `price` dihapus total dari `updateSchema`/`createSchema` (`PUT`/`POST /api/v1/admin/products/visa/*`) — bukan lagi bisa diisi manual dari mana pun, request yang tetap mengirim `price` diabaikan begitu saja oleh Zod. Input "Harga (Rp)" dihapus dari kedua form admin (edit & buat produk baru), diganti tampilan read-only "Harga saat ini: Rp X — dihitung otomatis". `VisaProduct.price` sekarang murni `Math.min()` dari `durationFeeRules`, satu-satunya jalur penulisan adalah `refreshVisaProductCache()`. Detail rencana & verifikasi di §17.

---

## 14. RENCANA — Redesain UI Input HPP: Tabel Tier Gabungan (ditulis 2026-07-18, belum dieksekusi)

> **Status: SELESAI & TERVERIFIKASI (2026-07-18).** Semua 4 fase (§14.6) sudah dieksekusi mengikuti Fase Eksekusi SOP `CLAUDE.md` — detail verifikasi tiap fase ada di `docs/progress.md` bagian "Redesain UI Input HPP: Tabel Tier Gabungan".

### 14.1 Masalah yang Ditemukan

Setelah §12 (panel "HPP & Komponen Biaya") dipakai langsung oleh user, ditemukan mismatch antara UI dan model bisnis nyata:

- **Model bisnis user (dikonfirmasi presisi, 2026-07-18):** satu produk visa punya maksimal 2 elemen HPP — **Harga Visa** (wajib) dan **Harga BRN** (opsional, boleh tidak ada) — dan keduanya **melekat ke rentang hari yang sama**. Contoh: "2–7 hari: Harga Visa 70, Harga BRN 30 → HPP 100 → ×kurs → +20% margin". Satu baris = satu rentang hari, dua kolom harga.
- **UI yang dibangun di Fase 4 (§12):** form "Tambah Komponen" generik — tiap komponen (`costComponent` bebas teks) punya builder rentang-hari sendiri, terpisah dari komponen lain. Untuk mengisi Harga Visa + Harga BRN pada rentang hari yang sama, admin harus mengetik rentang hari itu **dua kali** di dua mini-form terpisah yang tidak saling terhubung secara visual. Ini yang bikin bingung saat dipakai — bukan salah hitung (`computeSellPrice()` sudah benar, lihat §5), tapi salah bentuk input.

### 14.2 Prinsip Perbaikan

- **Tidak ada migrasi skema Prisma.** `ProductCost`/`PreferredVendor` (§3.3) tetap seperti sekarang — tetap polimorfik, tetap dipakai modul lain nanti (Hotel/Transport/dll) dengan bentuk komponen yang mungkin berbeda dari Visa.
- **`computeSellPrice()` (§5) tidak disentuh** — endpoint baru di bawah ini murni menerjemahkan input "tabel 2 kolom" ke 2 baris `ProductCost` (`costComponent: "individu"` untuk Harga Visa, `costComponent: "biaya_non_hotel"` untuk Harga BRN) di belakang layar, lalu memicu `refreshVisaProductCache()` yang sama seperti sekarang.
- **Spesialisasi di level endpoint + UI Visa, bukan di level skema.** Endpoint baru ini boleh hardcode 2 nama komponen (`"individu"`, `"biaya_non_hotel"`) karena itu memang definisi bisnis tetap untuk Visa (dikonfirmasi user) — beda dengan hardcode nilai bisnis sembarangan yang dilarang `CLAUDE.md`. Endpoint/UI generik lama (`/costs`, `/costs/[costId]`, `/costs/preferred`) tidak diperlukan lagi untuk Visa dan akan dihapus (§14.5) — bukan dipertahankan sebagai jalur paralel.
- **Vendor & mata uang dipilih per KOLOM, bukan per baris** — satu vendor+mata uang untuk seluruh "Harga Visa", satu vendor+mata uang (opsional) untuk seluruh "Harga BRN" — konsisten dengan realita bisnis (satu syarikah menyuplai satu jenis komponen untuk semua rentang hari, bukan gonta-ganti per rentang).
- **Tiap baris tier diberi `id` stabil** di dalam JSON `costTiers` — field baru opsional (`{ id?, minDays, maxDays, cost }`, non-breaking terhadap tipe `CostTier` yang sudah ada di `lib/pricing/computeSellPrice.ts`) — supaya edit/hapus baris presisi berdasar identitas, bukan menebak dari kecocokan `minDays`/`maxDays` yang rawan tabrakan kalau ada 2 baris kebetulan sama.
- **Data lama:** per audit saat rencana ini ditulis, hanya ada 1 baris `ProductCost` sisa data uji (`biaya_non_hotel`, dari insiden Fase 6) — tidak ada data produksi nyata yang perlu dimigrasikan. Tidak perlu logic rekonsiliasi data lama.

### 14.3 Endpoint Baru

`GET /api/v1/admin/products/visa/[id]/cost-tiers`
```json
{
  "visa": { "vendorId": "...", "currency": "USD" },
  "brn":  { "vendorId": "...", "currency": "USD" },
  "rows": [
    { "id": "uuid-1", "minDays": 2,  "maxDays": 7,  "hargaVisa": 70,  "hargaBrn": 30 },
    { "id": "uuid-2", "minDays": 10, "maxDays": 10, "hargaVisa": 100, "hargaBrn": null }
  ]
}
```
`visa`/`brn` bernilai `null` kalau komponen itu belum pernah disimpan (produk baru).

`PUT /api/v1/admin/products/visa/[id]/cost-tiers` — body berbentuk sama seperti response `GET`, **replace-seluruh** (bukan patch parsial per baris — lebih sederhana untuk kasus pakai "setup lalu edit sesekali", bukan kolaborasi multi-admin real-time). Server:
1. Upsert `ProductCost` (`costComponent: "individu"`) dengan `vendorId`/`currency` dari `visa`, `costTiers` = seluruh baris yang punya `hargaVisa` terisi.
2. Kalau `brn` diisi dan ≥1 baris punya `hargaBrn` terisi → upsert `ProductCost` (`costComponent: "biaya_non_hotel"`). Kalau `brn` kosong/semua baris `hargaBrn` dihapus → set baris itu `isActive: false` (soft, bukan hapus fisik — pola sama dengan `Vendor` DELETE di §11).
3. Auto-set `PreferredVendor` untuk kedua komponen (UI ini didesain 1 vendor per komponen, bukan multi-vendor-comparison — auto-preferred, tidak perlu tombol "Jadikan Pilihan" manual lagi untuk Visa).
4. Panggil `refreshVisaProductCache()` di akhir, sama seperti endpoint lama.

### 14.4 UI Baru (`app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`)

Mengganti total section "HPP & Komponen Biaya" yang ada sekarang:
- 2 vendor-picker di atas (reuse pola quick-add "+ Vendor Baru" yang sudah ada dari perbaikan 2026-07-18): "Vendor & Mata Uang — Harga Visa" (wajib) dan "Vendor & Mata Uang — Harga BRN" (opsional, ada toggle/checkbox "Produk ini pakai komponen BRN" yang menampilkan/menyembunyikan picker-nya).
- Tabel baris tier: kolom Jumlah Hari (input `minDays`–`maxDays`), Harga Visa, Harga BRN (disabled/tersembunyi kalau toggle BRN mati), tombol hapus per baris, tombol "+ Tambah Baris".
- Kolom HPP (Rupiah) & Harga Jual **tidak dihitung live saat mengetik** (supaya tidak ada logic margin/kurs dobel di client — tetap satu sumber kebenaran `computeSellPrice()`) — muncul setelah tabel disimpan, dengan memanggil endpoint `/preview?days=<minDays baris itu>` yang sudah ada (§11) per baris.
- Satu tombol "Simpan Tabel HPP" untuk seluruh grid sekaligus (bukan simpan per baris) — sesuai pola pakai admin (isi semua baris dulu, baru submit), lebih sederhana daripada auto-save per keystroke.

### 14.5 Pembersihan Legacy

- UI lama (form "Tambah Komponen" bebas teks) di halaman produk Visa **dihapus total**, diganti tabel §14.4.
- Endpoint lama `/costs`, `/costs/[costId]`, `/costs/preferred` — cek dulu tidak dipakai kode lain (per audit saat ini, hanya dipakai halaman produk Visa) sebelum dihapus. Kalau memang tidak dipakai di tempat lain, dihapus — tidak membiarkan 2 jalur edit paralel untuk data yang sama (`ProductCost`/`PreferredVendor`), karena itu sumber bug/kebingungan berikutnya.

### 14.6 Fase Eksekusi

1. **Fase 1** — Endpoint `GET`+`PUT` `/api/v1/admin/products/visa/[id]/cost-tiers` (backend murni, UI belum diubah). Verifikasi: `bun run build` 0 error + test langsung ke endpoint (curl/script) tanpa lewat browser dulu.
2. **Fase 2** — UI tabel tier baru menggantikan form lama, terhubung ke endpoint Fase 1. Verifikasi: `bun run build` 0 error + browser nyata (isi baris Harga Visa + Harga BRN pada rentang hari sama dalam satu baris, simpan, lihat HPP/Harga Jual per baris benar).
3. **Fase 3** — Hapus endpoint & kode UI lama yang sudah tidak dipakai (§14.5). Verifikasi: `bun run build` tetap 0 error setelah penghapusan.
4. **Fase 4** — Dokumentasi: `docs/progress.md`, `docs/decisions.md`, update §11/§12 dokumen ini supaya reflect struktur baru (§12 lama tentang form "Tambah Komponen" jadi usang, diganti deskripsi tabel tier).

---

## 15. Override Manual Harga Jual per Tier (SELESAI & TERVERIFIKASI, 2026-07-18)

> **Status: SELESAI & TERVERIFIKASI.** Semua 3 fase (§15.6) dieksekusi mengikuti Fase Eksekusi SOP `CLAUDE.md`, melanjutkan langsung dari §14 (tabel tier gabungan). Keputusan lingkup dikonfirmasi user lewat 2 pertanyaan eksplisit sebelum eksekusi (2026-07-18): (1) hanya **Harga Jual** yang manual-editable, **HPP tetap read-only** (murni jumlah Harga Visa+BRN — kalau ikut diedit manual jadi rancu dengan 2 kolom sumbernya yang sudah kelihatan); (2) override **disimpan permanen ke database**, bukan cuma preview sementara di layar. Detail verifikasi tiap fase ada di `docs/progress.md` bagian "Override Manual Harga Jual per Tier".

### 15.1 Kebutuhan

Setelah §14 selesai, user minta kolom HPP dan Harga Jual — yang sekarang cuma teks kecil di bawah tiap baris tabel tier (`rowPreviews`) — dipindah jadi kolom sejajar di tabel yang sama, dan kolom Harga Jual dibuat bisa diedit manual: kalau admin isi angka sendiri, itu jadi harga publish final untuk rentang hari itu, menggantikan hasil hitung otomatis (`computeSellPrice()`).

### 15.2 Skema

Tambah field opsional `sellPriceOverride?: number | null` ke `CostTier` — **hanya dipakai di tier milik komponen `individu`** (bukan `biaya_non_hotel`, karena override ini soal harga publish per rentang hari produk, bukan per komponen biaya). Disimpan di dalam JSON `costTiers` yang sudah ada — field baru opsional, non-breaking (pola sama dengan penambahan `id` di §14.2). **Tidak ada migrasi Prisma** (kolom `costTiers` sudah `Json`).

### 15.3 Perubahan `computeSellPrice()` (`lib/pricing/computeSellPrice.ts`)

Ini **satu-satunya fungsi lain** yang disentuh rencana ini (perubahan pertama sejak dibuat di Fase 5). Setelah `hppRupiah`, `minSellPrice`, dan `sellPrice` (hasil rounding otomatis) dihitung seperti sekarang — tambah langkah akhir:
1. Cari tier yang cocok dengan `jumlahHari` di komponen `individu` milik vendor preferred (komponen wajib, selalu ada tepat 1 preferred vendor kalau produk sudah dikonfigurasi).
2. Kalau tier itu punya `sellPriceOverride` terisi (bukan `null`/`undefined`) → pakai nilai itu sebagai `sellPrice` FINAL, menggantikan hasil rounding otomatis.
3. `hppRupiah` dan `minSellPrice` **tidak ikut di-override** — tetap angka asli hasil formula, supaya admin (dan siapa pun baca `/preview`) tetap bisa bandingkan HPP asli vs harga jual manual yang dipilih. Transparansi, bukan menyembunyikan data.

**Dampak ke semua pemanggil `computeSellPrice()`** (perlu disadari, bukan cuma di endpoint baru):
- `/api/v1/admin/products/visa/[id]/preview` — langsung tampilkan `sellPrice` hasil override kalau ada.
- `refreshVisaProductCache()` (§6) — `VisaProduct.price`/`durationFeeRules` (cache katalog publik) ikut pakai override kalau ada. **Ini memang benar secara desain** — override itu justru dimaksudkan untuk jadi harga publish katalog, bukan cuma tampilan admin.
- `POST /api/v1/bookings` (booking creation, sudah wired sejak Visa Step 1 — lihat `docs/decisions.md` 2026-07-17) — snapshot booking (`sellPriceSnapshot`) otomatis memakai harga override kalau ada saat jamaah booking. Konsisten dengan maksud "harga jual final".

**Risiko yang disengaja tidak divalidasi (dicatat, bukan luput):** tidak ada pengecekan bahwa `sellPriceOverride` >= `minSellPrice` (margin minimum) — admin bisa saja mengetik harga override di bawah HPP (rugi). Ini beban tanggung jawab admin, bukan validasi sistem, karena user memilih "override total, dipercaya sepenuhnya ke admin" tanpa minta guardrail tambahan. Bisa jadi Gap terpisah kalau nanti dianggap perlu.

### 15.4 Endpoint `cost-tiers` (`app/api/v1/admin/products/visa/[id]/cost-tiers/route.ts`)

- `PUT` body: `rows[].sellPriceOverride?: number | null` ditambahkan (kosong/`null` = pakai otomatis, jangan simpan field itu ke tier). Saat upsert tier `individu`, field ini ikut ditulis ke tiap entry `costTiers`.
- `GET`: setiap `rows[]` ikut mengembalikan `sellPriceOverride` (kalau ada) supaya UI tahu baris mana yang sudah di-override saat reload.

### 15.5 UI (`app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`)

Tabel tier dapat 2 kolom baru menggantikan teks `rowPreviews` di bawah baris:
- **Kolom "HPP"** — read-only, format Rupiah, hasil `/preview?days=<minDays baris>` (logic fetch sama seperti sekarang, cuma posisi tampilan pindah jadi kolom sejajar, bukan teks di bawah).
- **Kolom "Harga Jual"** — `<input type="number">` editable. Kalau baris punya `sellPriceOverride` tersimpan, prefill dengan nilai itu (`value`). Kalau tidak ada override, input kosong (`value=''`) dengan **placeholder** = angka otomatis dari `/preview` (format Rupiah polos, mis. "2.200.000") — supaya admin tetap lihat referensi harga otomatis tanpa itu dianggap "sudah diisi". Baris yang override-nya terisi diberi penanda visual (mis. border/background beda, badge kecil "Manual") supaya jelas beda dari baris yang masih ikut hitungan otomatis.
- Saat simpan (`handleSaveCostTiers`), field kosong dikirim sebagai `null` (pakai formula), field terisi dikirim sebagai angka (override).

### 15.6 Fase Eksekusi

1. **Fase A** — `computeSellPrice()` (§15.3) + endpoint `cost-tiers` (§15.4), backend murni. Verifikasi: `bun run build` 0 error + test langsung ke endpoint tanpa UI (kirim override, cek `/preview` memakainya; kosongkan override, cek kembali ke hasil formula).
2. **Fase B** — UI: kolom HPP + Harga Jual editable di tabel, placeholder otomatis, penanda visual baris ter-override (§15.5). Verifikasi: `bun run build` 0 error + browser nyata (isi override di satu baris, simpan, reload — nilai override tetap ada dan beda dari hasil formula; kosongkan lagi — kembali ke hasil formula).
3. **Fase C** — Dokumentasi: `docs/progress.md`, `docs/decisions.md`, update §11/§12/§14 dokumen ini kalau ada detail struktur yang berubah dari rencana.

---

## 16. Preview HPP & Harga Jual Live (Tanpa Simpan Dulu) — SELESAI & TERVERIFIKASI, 2026-07-18

> **Status: SELESAI & TERVERIFIKASI.** Ditulis mengikuti Fase Eksekusi SOP `CLAUDE.md` poin 1, lanjutan langsung dari §15.

### 16.1 Kebutuhan

Setelah §15 selesai, muncul bug nyata yang dilaporkan user (HPP tampil Rp 0 karena Min/Maks Hari kosong tapi tombol Simpan tidak ter-disable — sudah diperbaiki di `docs/progress.md`). Perbaikan itu memicu pertanyaan desain: kenapa HPP/Harga Jual baru muncul setelah "Simpan"? User minta diubah:
1. **Live** — begitu jumlah dolar/harga diketik, HPP & Harga Jual langsung muncul, tanpa perlu simpan dulu.
2. **Selalu tampil** — begitu sudah ada angka (baik baru diketik atau sudah tersimpan), HPP & Harga Jual tidak boleh hilang dari layar.
3. **HPP adalah data, bukan sekadar bantuan visual** — ditegaskan user: HPP/Harga Jual bukan "script pembantu bikin harga" yang boleh hilang/kosong sesukanya, tapi angka yang harus selalu bisa dipercaya dan terlihat oleh admin.

### 16.2 Prinsip Desain

- **Tidak menduplikasi rumus kurs+margin+pembulatan di client.** Endpoint baru (`/simulate`) menjalankan rumus yang SAMA (kurs sellRate + `PricingRule` margin + `roundToNearest`) di server, cuma inputnya beda: bukan baca dari `ProductCost` yang tersimpan di DB (seperti `/preview`, §11), tapi dari angka yang **sedang diketik** admin (belum tentu tersimpan).
- **Refactor, bukan duplikasi**: helper `getLatestRate()`, `getMarginRule()`, `roundToNearest()` di `lib/pricing/computeSellPrice.ts` dipindah ke modul bersama `lib/pricing/pricingHelpers.ts`, dipakai baik oleh `computeSellPrice()` (baca dari DB, §5) maupun `simulateSellPrice()` baru (baca dari input langsung, §16.3) — satu sumber kebenaran untuk rumus, dua cara berbeda untuk sumber datanya.
- **Simulate tidak butuh `minDays`/`maxDays`** — beda dari `/preview` yang mencocokkan hari ke tier tersimpan (`findTier`), `/simulate` cuma menjumlahkan biaya yang dikasih langsung. Ini juga otomatis menutup kelas bug yang sama dengan laporan HPP-Rp-0 sebelumnya (preview lama gagal kalau hari tidak cocok tier — simulate tidak punya masalah itu sama sekali karena tidak pernah mencocokkan hari).
- **Debounce di client** (500ms) supaya tidak fetch di setiap keystroke — tetap "live" dari sudut pandang admin, tapi tidak membanjiri server.
- **Override tidak disentuh simulate** — kolom Harga Jual tetap `<input>` terpisah untuk override manual (§15); nilai live-simulate cuma dipakai untuk kolom HPP (read-only) dan **placeholder** Harga Jual (referensi harga otomatis), tidak pernah menimpa override yang sudah diketik admin.

### 16.3 `lib/pricing/simulateSellPrice.ts` (baru)

```ts
simulateSellPrice(productType: string, components: {currency: string; cost: number}[]): Promise<{hppRupiah, minSellPrice, sellPrice} | null>
```
Jumlahkan tiap komponen (dikonversi ke Rupiah pakai `getLatestRate(currency, 'IDR')` masing-masing), lalu margin+rounding via `getMarginRule()`/`roundToNearest()` (sama seperti `computeSellPrice()`). Kembalikan `null` kalau kurs untuk salah satu currency tidak ditemukan (bukan diam-diam skip seperti `computeSellPrice()` — di sini semua komponen yang dikirim memang dimaksudkan untuk dihitung, jadi kurs hilang harus terlihat sebagai "belum bisa dihitung", bukan hasil parsial yang menyesatkan).

### 16.4 Endpoint `GET /api/v1/admin/products/visa/simulate` (baru, tidak butuh `[id]`)

Sengaja **tidak** di bawah `[id]/` — kalkulasinya tidak bergantung produk spesifik mana pun, cuma `productType` ('visa', hardcode sesuai halaman ini) + angka yang dikirim. Next.js App Router mengizinkan route statis (`visa/simulate/`) hidup berdampingan dengan route dinamis (`visa/[id]/`) di level yang sama.

Query params: `visaCost` (wajib), `visaCurrency` (wajib), `brnCost` (opsional), `brnCurrency` (wajib kalau `brnCost` diisi). `requireSuperAdmin()` sama seperti endpoint admin lain.

### 16.5 UI (`app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`)

- `loadRowPreviews()` (lama, dipanggil sekali setelah GET/save) **dihapus**, diganti `useEffect` yang mengamati `rows`, `visaCurrency`, `brnEnabled`, `brnCurrency` — debounce 500ms, lalu panggil `/simulate` untuk tiap baris yang `hargaVisa > 0`, isi `rowPreviews`. Efek ini otomatis jalan baik saat mengetik maupun saat data baru dimuat dari server (tidak perlu 2 jalur kode terpisah).
- Kolom HPP & placeholder Harga Jual jadi selalu hidup mengikuti apa pun yang ada di layar — baik baru diketik maupun sudah tersimpan — tidak pernah kosong selama `hargaVisa > 0`.

### 16.6 Fase Eksekusi

1. **Fase A** — `pricingHelpers.ts` (refactor dari `computeSellPrice.ts`, tidak ubah perilaku) + `simulateSellPrice.ts` + endpoint `/simulate`. Verifikasi: `bun run build` 0 error, `computeSellPrice()` masih menghasilkan angka identik seperti sebelum refactor (regresi check), `/simulate` dites langsung tanpa data tersimpan sama sekali.
2. **Fase B** — UI live-preview dengan debounce, hapus `loadRowPreviews` lama. Verifikasi: `bun run build` 0 error + browser nyata (ketik Harga Visa, tunggu <1 detik, HPP & Harga Jual placeholder muncul tanpa klik Simpan; kosongkan Min/Maks Hari — HPP tetap tampil karena simulate tidak butuh hari).
3. **Fase C** — Dokumentasi.

---

## 17. Komponen Harga Jadi Satu-Satunya Sumber Kebenaran: Hapus Harga Manual, "Mulai Dari" di Katalog (SELESAI & TERVERIFIKASI, 2026-07-18)

> **Status: SELESAI & TERVERIFIKASI.** Semua 4 fase (§17.6) dieksekusi mengikuti Fase Eksekusi SOP `CLAUDE.md`, lanjutan langsung dari §16. Rekomendasi dikonfirmasi user secara eksplisit sebelum rencana ini ditulis — 3 poin di §17.1 dikutip persis dari persetujuan user, dieksekusi *strict* sesuai rencana ini, tidak melebar. Detail verifikasi tiap fase ada di `docs/progress.md` bagian "Komponen Harga Jadi Satu-Satunya Sumber Kebenaran".

### 17.1 Kebutuhan (disetujui user, 2026-07-18)

1. `VisaProduct.price` **tetap ada sebagai field**, tapi isinya diubah jadi hasil `Math.min()` dari semua tier `durationFeeRules` — otomatis jadi "harga termurah" yang benar (bukan dihapus total sebagai field, supaya tidak perlu migrasi skema/ubah semua konsumen).
2. Hapus total jalur edit harga manual di admin (menutup Gap #5 di §13 yang sebelumnya sengaja ditunda — lihat `docs/decisions.md` 2026-07-17 "Gap #5 Sengaja Ditunda").
3. Kartu katalog publik tampilkan **"Mulai dari Rp X"** kalau ada ≥2 harga BERBEDA di antara tier produk itu; tampil polos (tanpa embel-embel) kalau cuma 1 harga atau semua tier kebetulan sama.

### 17.2 Temuan Kritis Sebelum Eksekusi (kenapa bukan sekadar hapus field)

Cache `VisaProduct.price` saat ini dihitung dari `computeSellPrice('visa', productId, DEFAULT_PROBE_DAY=1)` di `lib/pricing/refreshVisaProductCache.ts` — harga di **hari ke-1**, bukan harga termurah. Kebetulan sering sama (tier durasi pendek biasanya termurah), tapi **tidak dijamin** — kalau suatu saat ada produk dengan tier yang tidak mencakup hari-1 (mis. cuma "5-10 hari" dan "20-30 hari"), cache jadi kosong/salah. Ini harus diperbaiki sekalian sebagai bagian dari rencana ini — bukan cuma soal "boleh diedit manual atau tidak", tapi soal rumus cache-nya sendiri yang perlu benar dulu sebelum jadi dasar tampilan "Mulai dari".

### 17.3 Perubahan `refreshVisaProductCache()`

Ganti probe hari-1 dengan `Math.min(...durationFeeRules.map(r => r.fee))`, dihitung **setelah** `durationFeeRules` selesai dikumpulkan (array itu sendiri sudah difilter cuma tier dengan `sellPrice > 0`, jadi aman langsung di-`Math.min()` kalau tidak kosong). Kalau `durationFeeRules` kosong (belum ada komponen HPP valid) → `price` **tidak diupdate** (behavior sama seperti sekarang — biarkan nilai lama, bukan direset ke 0), supaya produk yang HPP-nya lagi kosong sementara tidak mendadak tampil Rp 0 di katalog. Konstanta `DEFAULT_PROBE_DAY` dan komentarnya dihapus (sudah tidak relevan).

**Backfill data lama**: setelah logic baru dipasang, panggil `refreshAllVisaProductCaches()` sekali secara manual (bukan nunggu next edit/cron) supaya semua produk yang sudah ada cache-nya langsung benar, tidak nunggu trigger berikutnya.

### 17.4 Hapus Jalur Edit Manual (Gap #5 di §13 — akhirnya ditutup, bukan ditunda lagi)

- **Halaman edit produk** (`app/[locale]/admin/(protected)/products/visa/[id]/page.tsx`, panel "Informasi Dasar"): input "Harga (Rp)" dihapus total, diganti tampilan read-only ("Harga saat ini: Rp X — dihitung otomatis dari HPP & Komponen Biaya di bawah"). State `form.price` dihapus dari form, tidak dikirim lagi di `handleSave()`.
- **Halaman buat produk baru** (`app/[locale]/admin/(protected)/products/visa/page.tsx`, form "+Tambah Produk"): input "Harga (Rp)" juga dihapus — produk baru dibuat dengan `price: 0` (default, bukan diketik admin), disertai catatan di form: harga akan otomatis terhitung setelah komponen HPP diisi di halaman edit produk setelah dibuat.
- **`PUT /api/v1/admin/products/visa/[id]`**: field `price` dihapus dari `updateSchema` — kalau ada client lama yang masih kirim `price` di body, field itu diabaikan begitu saja oleh Zod (tidak divalidasi/disimpan), bukan error.
- **`POST /api/v1/admin/products/visa`**: `price` dihapus dari `createSchema` (sebelumnya wajib `z.coerce.number().positive()`), `price: 0` di-hardcode saat `prisma.visaProduct.create()`.

**Yang TIDAK diubah** (scoping eksplisit, supaya tidak melebar dari rencana): `priceLabel` (label bebas seperti "per orang"/"per paspor", tidak terkait angka harga, tetap admin-editable) dan kolom harga di **tabel listing** admin (`products/visa/page.tsx`) — itu cuma menampilkan `v.price` (otomatis benar berkat §17.3), bukan input, tidak perlu diubah.

### 17.5 "Mulai Dari" di Katalog Publik

- `GET /api/v1/catalog/visa` (`app/api/v1/catalog/visa/route.ts`): tambah field turunan `priceIsRange: boolean` per produk — `true` kalau `new Set(durationFeeRules.map(r => r.fee)).size >= 2`. **Tidak** expose seluruh `durationFeeRules` ke publik (API katalog tetap ringkas, cuma kirim yang benar-benar dipakai tampilan).
- `app/[locale]/(public)/visa/page.tsx`: kalau `v.priceIsRange` true → prefix "Mulai dari " sebelum `formatRupiah(v.price)`; kalau false → tampil polos seperti sekarang.
- **Scoping eksplisit**: cuma kartu katalog publik yang dapat "Mulai dari" — tabel listing admin (§17.4) sengaja tidak diubah, karena admin sudah bisa lihat breakdown lengkap di halaman edit, tidak perlu embel-embel di tabel ringkas.

### 17.6 Fase Eksekusi

1. **Fase 1** — `refreshVisaProductCache()`: ganti probe hari-1 jadi `Math.min()`, backfill semua produk lewat `refreshAllVisaProductCaches()`. Verifikasi: `bun run build` 0 error + query DB langsung bandingkan `price` sebelum/sesudah backfill untuk produk yang punya >1 tier harga beda.
2. **Fase 2** — Hapus jalur edit manual: 2 halaman admin (edit + create) + 2 route (`PUT`/`POST`). Verifikasi: `bun run build` 0 error + browser (input harga tidak ada lagi di kedua form, harga tampil read-only benar di halaman edit) + test langsung: kirim `price` di body `PUT`, konfirmasi tidak berubah di database.
3. **Fase 3** — "Mulai dari" di katalog: `priceIsRange` di API + tampilan kondisional. Verifikasi: `bun run build` 0 error + browser (produk dengan tier harga campuran tampil "Mulai dari Rp X", produk 1 harga tampil polos).
4. **Fase 4** — Dokumentasi: `docs/progress.md`, `docs/decisions.md`, update §13 (Gap #5 ditutup, statusnya diubah dari "DITUNDA" jadi "DITUTUP"), §11/§12 kalau ada perubahan struktur API/UI yang perlu di-reflect.

---

## 18. Kategori Vendor: Field `category` untuk Filter per Konteks Pemakaian

> **DIGANTIKAN (vendor F5, 2026-10-26):** kategori teks bebas per modul diganti tabel `VendorCategory` yang dikelola admin (many-to-many) dan `VendorPicker` dengan konteks — lihat `docs/arsitektur-vendor.md`. Bagian ini hanya riwayat; jangan dipakai sebagai acuan implementasi.

> **Status: SELESAI & TERVERIFIKASI (2026-07-19).** Ditemukan lewat audit modul Flight (`docs/decisions.md` 2026-07-19 "Audit Ulang") + diskusi lanjutan dengan user: `Vendor` dipakai sebagai entitas generik lintas modul (Visa = "syarikah", Flight = "maskapai") lewat `ProductCost.vendorId` yang sama — ini disengaja (lihat §8.1) supaya arsitektur harga reusable tanpa model baru per modul. Tapi konsekuensinya: dropdown vendor di form HPP Flight menampilkan **semua** vendor tanpa filter, termasuk syarikah visa yang tidak relevan (dan sebaliknya). User minta solusi yang tetap murah (bukan bongkar jadi model terpisah per konteks — itu akan merusak reuse `ProductCost`/`computeSellPrice()`/`PreferredVendor` yang sudah dibuktikan jalan di 2 modul), sekaligus siap dipakai modul Hotel nanti tanpa migrasi ulang. Dieksekusi & diverifikasi lewat browser (§18.7).

### 18.1 Keputusan Desain

- **Field `category: String?`** di `Vendor` — **bebas teks, bukan enum**, konsisten prinsip anti-hardcode §2 (sama pola `costComponent` di `ProductCost`). Nilai dipakai sekarang: `"syarikah"` (vendor Visa) dan `"maskapai"` (vendor Flight). Nilai baru (mis. `"hotel"`) bisa dipakai kapan saja lewat form admin, tanpa migrasi skema — modul Hotel eksplisit **belum dikerjakan sesi ini**, cuma dipastikan field ini tidak menghalangi kalau nanti dikerjakan.
- **Nullable**, bukan wajib — vendor lama/baru yang belum dikategorikan tetap valid (`category: null`), tampil di semua dropdown tanpa filter (fallback aman, bukan hilang dari daftar).
- **Bukan model terpisah per konteks** — pertimbangan sudah dibahas di §8.1 & `docs/decisions.md` 2026-07-19: model terpisah butuh `ProductCost` jadi polimorfik ganda (`vendorType`+`vendorId`), merombak `computeSellPrice()`/`PreferredVendor` yang sekarang generik. Field kategori adalah solusi minimal yang menutup masalah filter UI tanpa bongkar infrastruktur itu.

### 18.2 Skema

```prisma
model Vendor {
  id          String   @id @default(uuid())
  name        String
  category    String?  // "syarikah" | "maskapai" | dll — bebas teks, filter UI saja, tidak dipakai logic harga
  country     String   @default("Saudi Arabia")
  contactInfo String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())

  costs ProductCost[]
  @@map("vendors")
}
```

**Backfill**: 3 vendor yang sudah ada (`BRN`, `Syarikah Almuhim`, `Syarikah Anu`) semuanya dibuat untuk Visa — di-backfill `category = 'syarikah'` sekali lewat migrasi, bukan dibiarkan `null` (supaya dropdown Visa yang sudah difilter langsung benar tanpa perlu admin edit manual satu-satu).

### 18.3 API (`app/api/v1/admin/system/settings/vendors`)

- `GET ?category=<value>` — filter opsional (`WHERE category = value`); tanpa parameter, tetap kembalikan semua vendor (dipakai halaman Settings yang memang menampilkan semua kategori sekaligus).
- `POST`/`PUT`: `category` ditambah sebagai field opsional (`z.string().optional()`) di `createSchema`/`updateSchema`.

### 18.4 UI

- **Settings** (`app/[locale]/admin/(protected)/system/settings/page.tsx`, section "Vendor/Syarikah"): tambah input `category` di form tambah vendor (datalist saran "syarikah"/"maskapai", bebas ketik nilai lain), tampilkan sebagai badge kecil di daftar vendor.
- **Visa** (`products/visa/[id]/page.tsx`, `VendorPicker`): fetch vendor dengan `?category=syarikah`; quick-add kirim `category: 'syarikah'` otomatis (admin tidak perlu pilih, karena konteksnya sudah jelas dari halaman ini).
- **Flight** (`products/flight/[id]/page.tsx`): fetch vendor dengan `?category=maskapai`; quick-add kirim `category: 'maskapai'` otomatis, sama alasan.

### 18.5 Yang TIDAK Dikerjakan Sesi Ini

- Kategori/filter untuk Hotel — field sudah generik dan siap (§18.1), tapi modul Hotel belum diaudit/diintegrasikan ke arsitektur harga ini sama sekali (masih pakai field harga manual, di luar scope perubahan ini).
- Validasi/whitelist nilai `category` di level Zod (mis. enum ketat) — sengaja dibiarkan bebas teks sesuai prinsip §2, konsisten `costComponent`.

### 18.6 Fase Eksekusi

Satu fase (perubahan kecil, aditif, tidak splitting seperti modul besar):
1. Migrasi: `ADD COLUMN category` (nullable) ke `vendors` + backfill 3 vendor existing jadi `'syarikah'`. Verifikasi: `bun run build` 0 error, row count vendor sebelum/sesudah migrasi sama, kolom baru terkonfirmasi via `\d vendors`.
2. API `vendors` (GET filter + POST/PUT terima `category`) + UI Settings (input + badge) + UI Visa picker (filter + auto-category quick-add) + UI Flight picker (filter + auto-category quick-add).
3. Verifikasi: `bun run build` 0 error + browser (dropdown Visa cuma tampil vendor `category=syarikah`, dropdown Flight cuma tampil `category=maskapai`, quick-add dari kedua sisi otomatis ter-kategori benar, Settings tampilkan semua vendor dengan badge kategori yang benar).
4. Dokumentasi: `docs/progress.md`, `docs/decisions.md`, status section ini diubah SELESAI & TERVERIFIKASI.

### 18.7 Verifikasi Aktual

**Insiden saat migrasi (tertangani, tanpa dampak):** percobaan pertama `prisma migrate diff --shadow-database-url` salah membuat URL shadow lewat `sed` yang gagal diam-diam — hasilnya shadow URL identik dengan `DATABASE_URL` produksi (bukan `saudinesia_shadow` yang terpisah). Terdeteksi sebelum lanjut, langsung dicek row count 5+ tabel kunci (termasuk data Flight nyata yang baru dibuat user) — semua utuh, `\d vendors` konfirmasi belum ada kolom `category` bocor, riwayat `_prisma_migrations` bersih tanpa entri aneh. `migrate diff --script` ternyata cuma menghasilkan file SQL tanpa mengeksekusi apa pun ke database manapun, jadi murni percobaan gagal tanpa efek samping — tapi tetap diulang dengan shadow URL yang benar-benar terverifikasi terpisah (dicek eksplisit `if [ "$DATABASE_URL" = "$SHADOW_URL" ]` sebelum lanjut) sebelum diff kedua dipakai. Pelajaran: jangan percaya hasil substitusi shell untuk membangun URL kritis — verifikasi eksplisit sebelum pakai, bukan asumsi.

**Migrasi**: `20260719143142_add_vendor_category` — murni `ALTER TABLE vendors ADD COLUMN category TEXT`, diverifikasi row count 7 tabel kunci (termasuk `flight_routes`/`flight_schedules` yang saat itu sudah berisi 1 baris data nyata milik user, bukan data uji) identik sebelum/sesudah. Backfill `UPDATE vendors SET category='syarikah' WHERE category IS NULL` — 3 baris ter-update.

**Browser**: Settings (`/admin/system/settings`) tampilkan kolom Kategori baru dengan badge "syarikah" untuk BRN/Syarikah Almuhim/Syarikah Anu. Dibuat rute+jadwal+vendor uji baru (bukan menyentuh data nyata milik user) → dropdown "Pilih maskapai" di halaman edit Flight kosong (benar, karena semua vendor lama ber-kategori "syarikah") → quick-add "Saudia TESTCAT" dari sisi Flight → dicek langsung ke database, `category` otomatis terisi `'maskapai'` → dropdown vendor di halaman edit produk Visa (dicek di produk nyata "Visa Reguler", **tanpa mengklik simpan apa pun**) tetap cuma tampilkan 3 vendor syarikah, "Saudia TESTCAT" tidak muncul — filter dua arah bekerja benar. Data uji dibersihkan; data nyata (rute Flight milik user, 3 vendor syarikah, 2 produk Visa) dicek ulang tetap utuh setelah cleanup.

**`bun run build`** — 0 error.

---

## 19. Bug: Komponen HPP Bermata Uang IDR Gagal Dihitung (DITEMUKAN & DITUTUP 2026-07-19)

> **Status: DITUTUP.** Ditemukan user lewat pemakaian nyata modul Flight — bukan lewat audit, langsung ketahuan karena dampaknya terlihat di layar (HPP/Harga Jual tampil "—" pas mata uang vendor IDR, padahal jalan normal pas USD).

### 19.1 Gejala & Akar Masalah

`computeSellPrice()` dan `simulateSellPrice()` **selalu** memanggil `getLatestRate(component.currency, 'IDR')` buat setiap komponen HPP, tanpa terkecuali. Kalau `component.currency === 'IDR'`, ini berarti mencari baris `ExchangeRate` dengan `fromCurrency:'IDR', toCurrency:'IDR'` — baris itu **tidak pernah ada**, karena cron kurs (`lib/cron/exchangeRateJob.ts`) cuma fetch 2 pasangan: USD/IDR dan SAR/IDR (§4.1). Akibatnya:
- `computeSellPrice()`: `rate` selalu `null` untuk komponen IDR → `console.error` + `continue` (skip diam-diam) → komponen itu tidak pernah menyumbang ke `hppRupiah`.
- `simulateSellPrice()`: `rate` selalu `null` → seluruh fungsi langsung `return null` (lebih parah — bukan cuma skip komponen, tapi preview total gagal).

Bug ini **bukan spesifik Flight** — `'IDR'` sudah jadi salah satu opsi di dropdown mata uang sejak awal (dipakai juga di Visa), jadi Visa juga kena kalau ada syarikah yang harganya sudah dalam Rupiah. Baru ketahuan sekarang karena kebetulan belum ada vendor Visa yang dicoba pakai IDR.

### 19.2 Perbaikan

Kalau `currency === 'IDR'`, treat sebagai identity (tidak butuh konversi sama sekali) — `hppRupiah += tier.cost` (atau `component.cost` di `simulateSellPrice`) langsung, tanpa lookup `ExchangeRate`, dan tidak dicatat ke `rateUsed` (karena memang tidak ada rate yang "dipakai").

```typescript
// computeSellPrice.ts & simulateSellPrice.ts — sebelum lookup ExchangeRate:
if (component.currency === 'IDR') {
  hppRupiah += tier.cost // atau component.cost di simulateSellPrice
  continue // (vendorUsed tetap dicatat di computeSellPrice; rateUsed TIDAK, karena tidak ada rate)
}
```

### 19.3 Verifikasi

`bun run build` 0 error. Diverifikasi langsung ke **data nyata milik user** (bukan data uji) — jadwal Flight "Cengkareng (CGK) → Madinah (MED)" dengan vendor "Saudinesia Air", `costTiers: [{cost: 19150000}]`, `currency: 'IDR'`: sebelum fix, HPP & Harga Jual tampil "—" (persis laporan user via screenshot); setelah fix, HPP tampil **Rp 19.150.000** (identik dengan input, karena memang tidak ada konversi) dan Harga Jual **Rp 23.000.000**. Disimpan ulang lewat "Simpan Harga Tiket" supaya cache `FlightSchedule.price` (yang sempat gagal ter-update karena bug ini membuat `hppRupiah` efektif 0) benar-benar ter-refresh ke Rp 23.000.000 — bukan cuma preview yang benar, data tersimpan juga dikoreksi.

**Konsekuensi buat data lain yang mungkin sudah pernah kena bug ini sebelum fix**: kalau ada produk Visa/Flight lain yang komponen HPP-nya sempat diisi mata uang IDR sebelum tanggal ini, cache harganya kemungkinan berhenti ter-update (bukan salah hitung — cuma tidak pernah ter-refresh dari nilai lama, karena `refreshFlightScheduleCache`/`refreshVisaProductCache` sama-sama punya guard "jangan reset ke 0 kalau `hppRupiah<=0`"). Tidak ada data lain yang ditemukan kena kasus ini per pengecekan 2026-07-19 (cuma 1 record Flight yang pakai IDR, sudah diperbaiki di atas) — tapi kalau nanti ketemu harga yang terlihat "macet"/tidak berubah walau HPP sudah diedit, cek dulu apakah mata uang komponennya IDR dari sebelum fix ini.

---

## 20. Generalisasi Override Harga Jual — Tidak Lagi Hardcode Nama Komponen (SELESAI & TERVERIFIKASI, 2026-07-19)

> **Status: SELESAI & TERVERIFIKASI.** Bagian dari Fase 0 refactor Hotel (`docs/arsitektur-hotel.md` §10.1 poin 4) — dikerjakan & diverifikasi terisolasi dulu sebelum skema Hotel disentuh, karena mengubah fungsi bersama yang dipakai Visa & Flight.

### 20.1 Masalah Lama

Override harga jual manual (§15) sebelumnya dicari lewat `computeSellPrice()` dengan hardcode `costComponent === 'individu'` — cuma bekerja untuk Visa (yang komponennya memang literal bernama `"individu"`). Modul lain dengan nama komponen berbeda (Flight `"tiket"`, dan calon Hotel `"kamar"`) tidak akan pernah bisa pakai fitur override ini — dicatat sebagai utang teknis eksplisit di `docs/arsitektur-tiket-pesawat.md` §4 saat modul Flight dibangun (sengaja tidak diperbaiki saat itu, di luar scope permintaan user waktu itu).

### 20.2 Perbaikan

`lib/pricing/computeSellPrice.ts` — pencarian `sellPriceOverride` dipindah dari lookup terpisah setelah loop utama (khusus komponen `'individu'`) jadi bagian dari loop utama, dicari di komponen HPP **manapun** yang preferred untuk produk itu:

```typescript
if (tier.sellPriceOverride != null && sellPriceOverride === undefined) {
  sellPriceOverride = tier.sellPriceOverride
}
```

Komponen pertama yang punya `sellPriceOverride` terisi (tidak `null`) menang — dalam praktiknya cuma ada 1 komponen per produk yang punya kolom ini terisi (Visa: cuma tier `individu` yang pernah diberi field itu oleh `cost-tiers/route.ts`, komponen BRN tidak pernah dikirim `sellPriceOverride` sama sekali — dikonfirmasi lewat baca kode sebelum eksekusi, bukan asumsi).

### 20.3 Verifikasi

`bun run build` 0 error. Test regresi terhadap **data produksi nyata** (bukan data uji) — dicek `computeSellPrice()` untuk semua `VisaProduct` aktif dan `FlightSchedule` aktif, hasilnya dibandingkan dengan `price`/`durationFeeRules.fee` yang sudah ter-cache: **identik persis** sebelum & sesudah perubahan (Visa "Non-Hotel Umroh" & "Reguler" cocok, Flight "Cengkareng→Madinah" Rp 23.000.000 cocok) — tidak ada `sellPriceOverride` nyata yang aktif di data produksi saat ini (dicek langsung, semua `null`), jadi tidak ada risiko perubahan perilaku tersembunyi. Test fungsional tambahan: dibuat `ProductCost` uji dengan `costComponent: 'kamar'` (bukan `'individu'`) dan `sellPriceOverride: 999000` → `computeSellPrice()` mengembalikan `999000` dengan benar, membuktikan generalisasi bekerja untuk nama komponen apa pun. Data & vendor uji dibersihkan setelah verifikasi.

---

## 21. Referensi Silang

- `docs/arsitektur-visa.md` §9 — `durationFeeRules` (pola day-tier yang sama dipakai di `ProductCost.costTiers`, dan sekarang jadi cache yang di-refresh dari §6 dokumen ini), dan field snapshot harga di `VisaApplication` yang saling bergantung dengan §7 dokumen ini
- `docs/arsitektur-booking.md` §2 — preseden pola polimorfik `PackageItem.productType`/`productId`
- `docs/arsitektur-umroh.md` — `BookingVisa` belum pernah diisi (Gap #1 di `arsitektur-umroh.md`); field snapshot HPP/kurs di §7 dokumen ini baru relevan setelah gap itu diperbaiki
- §14 di atas — rencana (SELESAI) redesain UI input HPP jadi tabel tier gabungan, ditulis setelah user menguji panel §12 langsung dan menemukan mismatch bentuk input (bukan salah hitung)
- §15 di atas — rencana override manual Harga Jual per tier, lanjutan langsung dari §14 setelah user minta HPP/Harga Jual jadi kolom tabel dan Harga Jual bisa diedit manual
- §16 di atas — preview HPP/Harga Jual live tanpa simpan dulu, lanjutan langsung dari §15 setelah bug "HPP Rp 0" memicu pertanyaan kenapa preview harus nunggu simpan
- §17 di atas — komponen harga jadi satu-satunya sumber kebenaran, menutup Gap #5 §13, lanjutan langsung dari diskusi soal "mulai dari" harga termurah di katalog
- Riset API kurs (2026-07-08): [Kurs Referensi JISDOR — Bank Indonesia](https://www.bi.go.id/id/moneter/informasi-kurs/referensi-jisdor/default.aspx), [wsKursBI Web Service](https://www.bi.go.id/biwebservice/wskursbi.asmx), [ExchangeRate-API Open Access](https://www.exchangerate-api.com/docs/free), [ExchangeRate-API Supported Currencies](https://www.exchangerate-api.com/docs/supported-currencies), [Frankfurter](https://frankfurter.dev/), [Frankfurter currency tracker (konfirmasi SAR tidak didukung)](https://github.com/lineofflight/frankfurter/issues/144)
- Riset peg SAR/USD (2026-07-08): [Saudi Riyal Pegged to US Dollar at 3.75](https://vision2030.ai/encyclopedia/saudi-riyal/), [Riyal Peg — SAR/USD Fixed Exchange Rate](https://investriyadh.ai/glossary/riyal-peg/)
