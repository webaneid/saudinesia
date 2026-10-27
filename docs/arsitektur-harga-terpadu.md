# Arsitektur — Harga Terpadu: Modal – Jual – Untung, Satu Sumber Kebenaran

> **Status: RENCANA DISETUJUI (2026-10-27) — keputusan pemilik di §11; Fase 0 dieksekusi, Fase 1+ menyusul satu per satu.** Ditulis dari recheck langsung ke kode (bukan dari dokumen lama).
> Tujuan pemilik: (1) dari harga kita tahu **modal, pengeluaran, dan keuntungan** tiap order; (2) harga di bagian mana pun **seragam**: a. harga dasar (modal/vendor), b. harga jual, c. selisih = keuntungan; (3) margin default ada, tetapi **bukan patokan utama** — admin bisa menetapkan harga jual sesuai kehendaknya. Satu data yang sama menjadi dasar booking engine, invoice, dan laporan keuangan.
> Melengkapi (dan pada akhirnya menggantikan sebagian) `docs/arsitektur-harga.md` dan `docs/arsitektur-komponen-biaya.md`.

---

## 1. Recheck — kondisi kode aktual

### 1.1 Di mana harga tinggal hari ini

| Pemilik | Kolom harga (sumber kebenaran?) | Satuan | Modal (HPP) | Override harga jual | Snapshot saat dipesan |
|---|---|---|---|---|---|
| Visa | `VisaProduct.price` (cache, "mulai dari") + `durationFeeRules` (JSON cache) | per orang, tier hari | `ProductCost` 2 komponen (`individu`, `biaya_non_hotel`) | **Ya**, tapi tersembunyi di JSON tier (`sellPriceOverride`), hanya Visa | **Ya** (`VisaApplication.hppSnapshotRupiah/sellPriceSnapshot` + id kurs/vendor) — satu-satunya |
| Tiket Pesawat | `FlightSchedule.price` (cache) | per orang | `ProductCost` 1 komponen | Tidak | `BookingFlight.unitPrice/totalPrice` (jual saja) |
| Hotel | `HotelRoomSchedule.price` (cache) | per kamar-malam | `ProductCost` per jadwal kamar | Tidak | `BookingHotel.pricePerNight/totalPrice` |
| Transport | `TransportPricing.price` (cache) | per kendaraan/trip | `ProductCost` per rute×kendaraan | Tidak | `BookingTransport.unitPrice/totalPrice` |
| Muthowif | `MuthowifServicePrice.price` (cache, singleton) | per orang-hari | `ProductCost` 1 komponen | Tidak | `BookingMuthowif.totalPrice` |
| Haji | `HajiProduct.price` (cache) | per orang | Komponen Biaya | Tidak | `BookingHaji.totalPrice` |
| Paket Umroh | `Package.price` (cache) + `included*Price` ×7 (snapshot yang bisa diedit) | per paket | Komponen Biaya + sub-modul pass-through | Tidak | — (belum ada booking paket) |
| Paket Ziarah | `TourPackage.price` (cache) + `includedTransportPrice`, `TourPackageHotel.pricePerNight` | per paket | Komponen Biaya + pass-through | Tidak | `BookingTourPackage.totalPrice` |
| **Katering** | `CateringOption.pricePerPerson{Regular,Ramadan,Hajj}` — **diisi manual** | per orang-hari, 3 musim | **Tidak ada** | (semuanya manual) | `BookingCatering.totalPrice` — **dari klien** |
| **Layanan Hotel** | `HotelService.price` — manual | per layanan | **Tidak ada** | — | `BookingService` ada di skema tetapi **tak pernah dibuat** oleh kode booking |

### 1.2 Temuan (terbukti dari kode)

1. **Harga tersebar di ≥ 8 kolom cache + 3 kelompok harga manual/snapshot**, dibaca oleh **61 file** (`app/api/v1`, admin, katalog publik, PDF invoice). Lima fungsi `refresh*Cache` hampir identik (`lib/pricing/refresh{Flight,Hotel,Transport,Muthowif,Visa}…`).
2. **Hanya harga jual yang disimpan.** HPP dihitung ulang setiap kali dari `product_costs` dengan **kurs hidup**; margin tidak pernah disimpan. Akibatnya "keuntungan order X" tak bisa dijawab — dan berubah sendiri saat kurs/vendor berubah.
3. **Booking item hanya menyimpan harga jual** (`unitPrice`/`totalPrice`). Satu-satunya snapshot HPP adalah Visa. `docs/arsitektur-harga.md` §7 merencanakannya untuk semua, tetapi baru Visa yang dikerjakan. **Tanpa ini laporan keuangan tidak mungkin akurat.**
4. **Margin hanya rumus, bukan pilihan:** `PricingRule.minMarginPercent` (default 20 %, pembulatan 50.000) dipakai sebagai harga final. Satu-satunya jalan keluar adalah `sellPriceOverride` di JSON tier Visa. Nilai fallback `20`/`50000` ditulis keras di **tiga** tempat (`computeSellPrice`, `costComponents`, `simulateSellPrice`).
5. **Produk komposit membaur:** Paket Umroh/Ziarah menjumlahkan (a) Komponen Biaya custom — margin per komponen — dan (b) harga jual sub-modul (hotel, kendaraan, visa, …) **apa adanya (pass-through)**. Modal sub-modul tak terlihat di paket, dan `included*Price` adalah salinan harga jual yang bisa basi terhadap harga hidup.
6. **Harga katering dipercaya dari klien** — `lib/validators/booking.ts` (`catering.totalPrice: z.number().positive()`) dipakai langsung di `app/api/v1/bookings/route.ts` (`totalPrice: item.totalPrice`). Klaim "Gap #4 ditutup" di `docs/arsitektur-booking.md` §7.1 **tidak benar untuk katering**. Pre-existing, **High** — lihat §10 (diusulkan sebagai Fase 0).
7. **`PricingRule` global ganda:** `@@unique([productType])` dengan `productType = NULL` tidak mencegah duplikat di Postgres; DB dev punya dua baris global (`getMarginRule` memakai `findFirst` — acak).
8. **Cache bisa basi diam-diam:** `refresh*` berhenti bila HPP ≤ 0 ("jangan reset ke 0") sehingga menghapus semua biaya membiarkan harga lama tampil di katalog.
9. **Tidak ada laporan keuangan apa pun** (tak ada kode `laporan/revenue/profit`); `Booking.totalAmount`, `Payment`, `Refund` ada tetapi tidak ada modal/utang vendor.
10. **Mengubah margin global hanya menyegarkan harga Visa** (`pricing-rule` PUT memanggil `refreshAllVisaProductCaches()` saja). Hotel, Pesawat, Transport, Muthowif, Haji, Paket Umroh/Ziarah tetap memakai harga lama sampai biayanya diedit — padahal cron kurs hanya menyegarkan produk ber-biaya mata uang asing, jadi produk berbiaya IDR tak pernah ikut. Harga di katalog bisa berbeda dari aturan yang berlaku. (Ditutup di Fase 0; mesin Fase 1 menggantikan seluruhnya.)
11. **Temuan data dev (diverifikasi 2026-10-27):** satu harga Transport (Rp 6.000.000) **tanpa satu pun baris biaya** (harga yang tak punya modal — jenis "jual tanpa modal" yang harus bisa dinyatakan eksplisit, §3 `costIdr = null`), dan **8 baris `product_costs` Hotel yatim** (menunjuk jadwal kamar yang sudah tidak ada). Migrasi/backfill Fase 1 wajib menangani keduanya.
12. Katering pada Paket Umroh selalu memakai harga **Reguler** (`computePackagePrice`: `pricePerPersonRegular`), padahal katering lain memakai musim pada tanggal — tidak konsisten; Fase 1 menyatukan lewat varian musim.
13. Hak akses: Komponen Biaya/HPP superadmin-only (`requireSuperAdmin`); harga jual tampil ke semua peran admin.

### 1.3 Yang sudah baik dan dipertahankan
`ProductCost` (modal = vendor + mata uang + nominal, polimorfik), `Vendor` terpadu (ADR-0003), `ExchangeRate` append-only + cron, `PreferredVendor`, registry pemilik `costComponentOwners`, pola 3-mode "Variable Harga" (included/user_choice/none), harga dihitung ulang server-side saat booking. Rencana ini **tidak mengganti pencatatan modal**; ia menambahkan satu lapisan harga di atasnya dan membekukan hasilnya saat transaksi.

---

## 2. Prinsip (invarian yang harus selalu benar)

| # | Invarian | Penjaga |
|---|---|---|
| I1 | Setiap yang dijual punya **satu `PricePoint`**: `modal`, `jual`, `untung = jual − modal` (selalu turunan, tidak pernah jadi masukan). Seragam di semua modul. | skema + tes |
| I2 | `jual = manual ?? otomatis`. Otomatis = modal × (1 + margin default) dibulatkan. **Margin default adalah saran, bukan batas** — manual boleh di bawahnya (peringatan, bukan blokir). | CHECK DB + tes |
| I3 | **Satu penulis, satu pembaca** harga (`lib/pricing/engine`). Tidak ada kolom harga lain; katalog, booking, invoice, laporan membaca `PricePoint`/`PriceSnapshot`. | penjaga sumber CI |
| I4 | **Transaksi membekukan** modal+jual+untung per baris (`PriceSnapshot`). Laporan hanya membaca snapshot — perubahan kurs/harga kemudian tak menggeser sejarah. `Booking.totalAmount = Σ snapshot.jual`. | tes invarian |
| I5 | **Modal dan untung tidak pernah keluar** ke katalog publik/pilgrim/API publik. Hanya DTO `jual`. | penjaga CI + role |
| I6 | Perubahan harga jual manual **tercatat** (siapa, kapan, dari→ke, alasan). | `PriceChange` |

---

## 3. Model data (usulan)

```prisma
/// Satu titik harga untuk satu hal yang dijual (varian = tier hari Visa / musim Katering / kosong).
model PricePoint {
  id             String   @id @default(uuid())
  ownerType      String   // 'visa'|'flight'|'hotel'|'transport'|'muthowif'|'catering'|'hotel_service'|'package'|'tour_package'|'haji'
  ownerId        String   // polimorfik (pola ProductCost); pembersihan saat hapus lewat lib/admin/productDelete.ts
  variantKey     String   @default("")   // "" | "days:14-21" | "season:ramadan"
  unit           String   // 'person'|'person_day'|'room_night'|'vehicle'|'package'  (satuan harga, supaya qty × harga tak ambigu)
  costIdr        Decimal? @db.Decimal(14, 2)  // MODAL. null = modal belum diisi (mis. katering lama) → ditandai di laporan
  autoSellIdr    Decimal? @db.Decimal(14, 2)  // hasil rumus: modal × (1+margin) dibulatkan
  manualSellIdr  Decimal? @db.Decimal(14, 2)  // override admin
  sellIdr        Decimal  @db.Decimal(14, 2)  // JUAL efektif = manual ?? auto  — SATU-SATUNYA kolom yang dibaca katalog/booking
  // untung = sellIdr − costIdr (turunan; tidak disimpan)
  marginPctUsed  Decimal? @db.Decimal(5, 2)   // aturan yang dipakai saat otomatis dihitung (jejak)
  roundingUsed   Int?
  fxRateIds      Json     @default("[]")      // ExchangeRate.id yang membentuk modal
  vendorIds      Json     @default("[]")
  computedAt     DateTime @default(now())
  manualBy       String?                       // User.id
  manualAt       DateTime?
  manualNote     String?
  @@unique([ownerType, ownerId, variantKey])
  // CHECK (sellIdr = COALESCE(manualSellIdr, autoSellIdr))  — dijaga DB, bukan hanya kode
}

/// Beku saat transaksi: satu baris per bagian yang dijual (paket komposit = beberapa baris).
model PriceSnapshot {
  id           String   @id @default(uuid())
  bookingId    String                       // FK Booking
  itemType     String                       // kunci adapter booking (hotel, transport, visa, haji, tourPackage, …)
  itemId       String                       // id baris Booking* (polimorfik, sejalan adapter "Opsi B")
  lineKey      String   @default("main")    // "main" | nama komponen | "penyesuaian"
  pricePointId String?
  description  String
  qty          Decimal  @db.Decimal(12, 2)
  unit         String
  unitCostIdr  Decimal? @db.Decimal(14, 2)
  unitSellIdr  Decimal  @db.Decimal(14, 2)
  totalCostIdr Decimal? @db.Decimal(14, 2)
  totalSellIdr Decimal  @db.Decimal(14, 2)
  mode         String                       // 'auto'|'manual'
  fxRateIds    Json     @default("[]")
  vendorIds    Json     @default("[]")
  takenAt      DateTime @default(now())
  @@unique([itemType, itemId, lineKey])
  @@index([bookingId])
}

/// Audit perubahan harga jual manual / aturan margin.
model PriceChange { id, pricePointId?, ruleId?, byUserId, at, oldSell?, newSell?, note }
```

**`PricingRule`:** `minMarginPercent` diganti nama menjadi `defaultMarginPercent` (maknanya memang default), ditambah `warnBelowPercent` (ambang peringatan, default 0 = hanya rugi). Baris global **satu-satunya** dijamin (indeks unik parsial / kunci sentinel) — menutup duplikat §1.2-7. Fallback `20/50000` dipindah ke SATU konstanta.

**Komposit (Paket Umroh, Paket Ziarah, Haji):** `PricePoint` komposit = Σ baris anak: komponen biaya (modal dari `ProductCost`, jual otomatis per komponen seperti sekarang) + sub-modul yang dirujuk (modal dan jual diambil dari `PricePoint` sub-modul × qty — **modal sub-modul ikut terlihat**, tidak lagi pass-through buta). Admin boleh menetapkan **jual manual untuk total**; selisih terhadap jumlah otomatis menjadi baris `penyesuaian` supaya Σ baris = total dan untung per baris tetap jujur. (Override per komponen = opsional v2, §11-5.)

---

## 4. Mesin (`lib/pricing/engine/`)

- **Registry pemilik** (pola `costComponentOwners` / registry media): tiap pemilik mendeklarasikan `ownerType`, `unit`, daftar `variantKey`, `exists()`, `resolveCost(variant)` (dari `ProductCost`/kurs, atau dari anak untuk komposit), dan `onChange` hook. **Menggantikan lima fungsi `refresh*Cache` kembar + tiga `compute*`**.
- API tunggal: `getPrice(owner, variant) → { cost, sell, margin, marginPct, mode }`, `reprice(owner)`, `setManualSell(owner, variant, idr, note, by)`, `clearManualSell(...)`, `snapshotPrice(owner, variant, qty) → PriceSnapshot[]` (dipakai booking engine), `repriceAll(currencies?)` (cron kurs), `repriceRule()` (ubah margin default).
- **Pemicu hitung ulang:** baris biaya berubah, vendor pilihan berubah, kurs berubah (cron), aturan margin berubah, anak komposit berubah. Mode **manual**: jual tetap, modal & untung ikut bergerak; bila untung < `warnBelowPercent` → masuk daftar **Kesehatan Margin**.
- **Hapus-aman** (`lib/admin/productDelete.ts`) menambah pembersihan `PricePoint` pemiliknya; `PriceSnapshot` dirujuk booking sehingga produk yang pernah dipesan tetap nonaktif (aturan yang sudah ada).
- Cache yang basi (§1.2-8) hilang: tidak ada "jangan reset ke 0"; modal kosong → `costIdr = null` + `sell` tetap manual/otomatis yang ada, ditandai "modal belum diisi".

## 5. Satuan & varian per modul

| Pemilik | `unit` | `variantKey` | Modal berasal dari |
|---|---|---|---|
| Visa | `person` | `days:min-max` per tier | `ProductCost` `individu` + `biaya_non_hotel` pada tier itu. "Mulai dari" katalog = `min(sell)` (turunan, tanpa kolom cache). `sellPriceOverride` JSON dipindah ke `manualSellIdr`. |
| Pesawat / Hotel (kamar) / Transport / Muthowif | `person` / `room_night` / `vehicle` / `person_day` | `""` | `ProductCost` (1 komponen) |
| Katering | `person_day` | `season:regular\|ramadan\|hajj` | **baru:** Komponen Biaya per opsi katering; harga manual lama → `manualSellIdr`, `costIdr = null` sampai diisi |
| Layanan Hotel | `service` | `""` | baru, sama; atau tetap manual dengan `costIdr = null` |
| Haji / Paket Umroh / Paket Ziarah | `package` | `""` | komposit (§3) |

---

## 6. UI seragam — `PriceCard`

Satu komponen admin di setiap editor produk (menggantikan panel HPP/preview yang berbeda-beda): tiga angka sejajar **Modal · Harga Jual · Untung (Rp & %)**; dua mode — **Otomatis** (margin default x %, bisa dilihat) atau **Manual** (input harga jual, catatan wajib bila di bawah ambang); rincian baris modal (vendor+mata uang+nominal, memakai `CostComponentsPanel`/editor yang ada sebagai bagian "Modal"); preview langsung (`simulateSellPrice` generalisasi). Daftar produk admin mendapat kolom **Modal / Jual / Untung** (sesuai peran). Halaman **Kesehatan Margin**: harga di bawah ambang/rugi, modal kosong, kurs berubah memengaruhi jual manual.

## 7. Hak akses (keputusan 2026-10-27)

**Alur role belum ditentukan → sementara semua peran admin (admin, manager, superadmin) boleh melihat modal/untung dan mengubah harga jual manual**, sampai pemilik menetapkan alur role. Pilgrim dan publik **tidak pernah**. Agar perubahan nanti satu titik: seluruh pemeriksaan lewat satu berkas `lib/pricing/policy.ts` (`canViewCost`, `canSetSellPrice`, `canChangeMarginRule`) yang kini mengembalikan "semua peran admin"; route, halaman, dan DTO tidak boleh memeriksa peran harga sendiri-sendiri (penjaga CI). Catatan: Komponen Biaya/HPP saat ini `requireSuperAdmin` — dibuka ke peran admin lain di Fase 3 lewat policy itu, bukan di Fase 0.

## 8. Kontrak ke Booking Engine, Invoice, Laporan (membuka jalan)

- **Booking engine (akan dirombak):** tidak menghitung harga sendiri — memanggil `snapshotPrice(owner, variant, qty)` per item dan menyimpan hasilnya; `totalAmount = Σ totalSellIdr` (invarian I4 dijaga tes). Bentuk tabel item booking tetap bebas ditentukan perombakan itu; kontraknya hanya `PriceSnapshot(itemType, itemId, lineKey)`.
- **Penyesuaian per order** (diskon/negosiasi) = baris `lineKey = "penyesuaian"` bernilai ±; tidak menyentuh `PricePoint`.
- **Invoice:** `lib/pdf/invoiceData.ts` membaca `PriceSnapshot` (jual saja, tampilan pilgrim) — satu sumber, bukan hitung ulang.
- **Laporan keuangan:** pendapatan = Σ jual; modal = Σ modal; **untung = selisih**; terealisasi = proporsi `Payment` terkonfirmasi, dikurangi `Refund`; per booking/produk/vendor/periode. Semua dari snapshot → tidak berubah oleh kurs. Utang vendor aktual (pengeluaran terbayar) = fase terpisah (§11-3).

### 8.1 Pengeluaran aktual & selisih terhadap HPP (keputusan 2026-10-27)

Modal di `PriceSnapshot` adalah **rencana (HPP awal)**. Uang yang benar-benar keluar ke vendor dicatat terpisah sebagai **`CostActual`** supaya kita tahu **di mana HPP meleset**:

```prisma
model CostActual {
  id           String   @id @default(uuid())
  bookingId    String?                    // pengeluaran untuk order tertentu (bisa null = biaya umum produk)
  snapshotId   String?                    // PriceSnapshot yang dibayar (satu baris = satu komponen: apa & berapa rencananya)
  vendorId     String                     // FK Vendor
  component    String                     // "untuk apa" — nama komponen (dari lineKey/ProductCost.costComponent)
  currency     String
  amount       Decimal  @db.Decimal(14, 2)
  amountIdr    Decimal  @db.Decimal(14, 2)  // dibekukan saat dicatat (kurs saat bayar)
  paidAt       DateTime
  varianceNote String?                    // WAJIB bila amountIdr ≠ rencana (lihat di bawah)
  recordedBy   String
  // selisih = amountIdr − snapshot.totalCostIdr (turunan; positif = lebih mahal dari HPP awal)
}
```
- Komponen di snapshot memberi daftar **"untuk apa dan berapa"** — saat uang keluar, pencatat memilih baris komponen itu; sistem menampilkan rencana dan menghitung selisih.
- **Aturan catatan:** bila aktual berbeda dari rencana di luar toleransi (default 0 — sistem merekomendasikan, admin memutuskan), `varianceNote` wajib ("modal 20 jt, keluar 21 jt → catat sebabnya"). Laporan **Selisih HPP vs Aktual** per komponen/vendor/produk/periode menunjukkan sumber meleset.
- Dikerjakan **setelah** snapshot (Fase 4) — butuh baris rencana untuk dibandingkan.

### 8.2 Diskon & negosiasi (keputusan 2026-10-27)

- Diskon/nego berlaku di **total** order (baris `penyesuaian` ±, bukan mengubah harga komponen). Komponen hanya alat **perencanaan** — tampilan untung per komponen tetap ada untuk analisis.
- **Catatan wajib bila harga akhir di bawah HPP awal** (diskon melampaui seluruh margin → rugi). Berlaku sama untuk jual manual di bawah modal (`PricePoint`). Tidak diblokir ("bukan patokan utama"), tetapi alasan tercatat (`PriceChange` / `note` baris penyesuaian) dan muncul di Kesehatan Margin.

## 9. Fase eksekusi (satu fase, satu PR, SOP: recheck → build → security → dokumen)

| Fase | Isi | Catatan |
|---|---|---|
| **0** ✅ SELESAI & TERVERIFIKASI 2026-10-27 (§13) | Tutup harga katering dari klien (hitung server-side dari `CateringOption` × hari × orang, musim dari tanggal mulai); satukan baris `PricingRule` global ganda + cegah duplikat di DB (kunci `'global'`); satu konstanta fallback margin; ubah margin global menyegarkan **semua** cache harga (satu agregator, dipakai juga cron) | menutup temuan §1.2-6 (High), 7, dan 10 |
| **1 Fondasi** | Skema `PricePoint`/`PriceSnapshot`/`PriceChange` (+ migrasi ekspansi); `lib/pricing/engine` + registry; **backfill** dari cache & override Visa; penulisan ganda ke kolom lama agar pembaca lama tetap jalan; tes ekuivalensi rekam-bandingkan (harga per produk sebelum = sesudah) | pola Komponen Biaya yang terbukti |
| **2 Pembaca** | Katalog publik, quota adapter, route booking, PDF invoice membaca `PricePoint`; penjaga CI: tidak ada pembaca kolom lama | 61 file diinventaris per modul |
| **3 UI** | `PriceCard` + mode manual + peran + `PriceChange`; kolom Modal/Jual/Untung; Kesehatan Margin; Katering & Layanan Hotel masuk sistem | |
| **4 Snapshot** | `PriceSnapshot` ditulis oleh route booking (dan nanti engine baru); invarian `totalAmount`; invoice dari snapshot | selaras perombakan engine |
| **5 Kontraksi** | Hapus kolom cache/manual (`*.price`, `included*Price`, `pricePerPerson*`, `durationFeeRules`, `sellPriceOverride` JSON) dan lima `refresh*`; migrasi fail-closed + uji drift | |
| **6 Laporan** | Untung per booking/produk/vendor/periode + terealisasi | dari snapshot |
| **7 Pengeluaran aktual** | `CostActual` + catatan selisih + laporan Selisih HPP vs Aktual (§8.1); diskon di total dengan catatan wajib (§8.2) | setelah Fase 4 |

Setiap migrasi mengikuti pola proyek: ekspansi–kontraksi, fail-closed, atomik, diuji pada DB sementara; data dev disposable (fokus mesin, bukan pelestarian data).

## 10. Keamanan

- **Fase 0 menutup High yang ada** (harga katering klien-trusted — siapa pun yang login dan memanggil `POST /bookings` bisa memesan katering dengan harga positif berapa pun, termasuk Rp 1; `CateringOption.pricePerPerson*` bahkan tidak dibaca route booking).
- Manual price = aksi berprivilese: `requireManager` di awal, skema `.strict()`, `PriceChange` tak bisa dihapus lewat UI, batas wajar (> 0, ≤ batas atas), `sellIdr` CHECK di DB.
- I5: DTO publik **tanpa** `costIdr`/margin; penjaga CI memindai `app/api/v1/catalog` dan halaman `(public)`/`(pilgrim)` agar tidak memilih kolom modal; tes yang memanggil API publik dan menegaskan tak ada kunci `cost|margin|hpp`.
- Raw SQL hanya untuk CHECK/indeks parsial di migrasi (tidak ada input pengguna).

## 11. Keputusan pemilik (2026-10-27)

| # | Keputusan |
|---|---|
| 1 | **Role:** belum ada alur role → sementara semua peran admin terbuka untuk modal/untung/ubah harga jual; satu titik `lib/pricing/policy.ts` supaya mudah diatur nanti (§7). |
| 2 | **Pengeluaran:** pengeluaran **aktual** ke vendor dicatat; sistem merekomendasikan catatan bila aktual ≠ HPP awal (mis. rencana 20 jt, keluar 21 jt) supaya terlihat di mana meleset (§8.1, Fase 7). |
| 3 | **Komposit:** override jual di **total** saja; komponen tetap tampil (untuk apa & berapa) terutama saat uang keluar. |
| 4 | **Diskon/nego:** di total; komponen hanya untuk perencanaan; **catatan wajib bila harga akhir di bawah HPP awal** (§8.2). |
| 5 | **Eksekusi** mengikuti SOP ketat (satu fase satu PR; recheck → build → security → dokumen; merge atas perintah). Fase 0 lebih dulu. |

Keputusan lama yang tetap: jual manual di bawah modal **boleh** dengan peringatan + catatan; mode manual + kurs berubah → jual tetap, untung bergerak + peringatan.

## 12. Di luar scope
Perombakan bentuk data item booking (milik perombakan engine), pajak/PPN & biaya gateway, multi-mata-uang untuk harga jual (jual tetap IDR), integrasi akuntansi eksternal, dan utang vendor aktual (§11-3) sampai diputuskan.

## 13. As-built Fase 0 (2026-10-27)

- **Katering server-side** — `lib/pricing/computeCateringPrice.ts` (`computeCateringBookingPrice`, `cateringPricePerPersonPerDay`): musim ditentukan dari **tanggal mulai** (`detectSeason`), total = harga musim × hari × orang, opsi tak ada/nonaktif/harga musim ≤ 0 → `ItemNotBookableError` (422). `totalPrice` dihapus dari skema; katalog publik (API + halaman) memilih kolom musim lewat fungsi yang sama. Dibuktikan ke server berjalan: `totalPrice:1` dari klien diabaikan (tersimpan 1.200.000 = 100.000×3×4); nonaktif → 422; harga Haji 0 pada tanggal Haji → 422. (SEC-71.)
- **Aturan margin global satu-satunya** — kunci `'global'` (non-NULL, `@@unique`) menggantikan `NULL`; migrasi `20261028090000_pricing_rule_global_key` (dedupe → simpan yang terbaru, sentinel, NOT NULL; atomik, fail-closed bila `'global'` sudah ada di samping NULL). Terbukti pada DB dev yang memang punya dua baris global ganda (menjadi satu). Route memakai `upsert` atas kunci unik (atomik; 12 upsert paralel → satu baris).
- **Nilai bawaan satu tempat** — `DEFAULT_MARGIN_PERCENT = 20`, `DEFAULT_ROUNDING_INCREMENT = 50000`, `GLOBAL_RULE_KEY`, `resolveMarginRule()` di `lib/pricing/pricingHelpers.ts` (dulu ditulis keras di tiga file). Dikunci tes (mengubah bawaan = keputusan sadar).
- **Margin berubah → SEMUA cache disegarkan** — `lib/pricing/refreshAll.ts` (`refreshAllPricingCaches`, satu daftar: dasar dulu, komposit terakhir) dipakai cron kurs (menggantikan delapan blok try/catch) **dan** route perubahan margin (dulu hanya Visa). Dibuktikan lewat route: margin 20→40% menggeser harga Pesawat 23 jt→26,8 jt, Haji 4,2→4,9 jt, Paket 6,6→7,7 jt, Visa 2,65→3,1 jt, lalu kembali saat dipulihkan.
- **Tes:** `scripts/test-pricing-phase0.ts` (8 tes DB sungguhan) dan `scripts/test-pricing-rule-migration.ts` (5 skenario migrasi + uji drift terbaru); 9 mutasi tertangkap (musim diabaikan, harga 0 boleh, nonaktif boleh, refresh tanpa Hotel, margin tanpa refresh, bawaan berubah, migrasi tanpa NOT NULL / simpan yang terlama / tanpa dedupe). Uji drift dipindah dari `test-media-contraction` ke tes migrasi terbaru (pola proyek).
- **Catatan:** `docs/arsitektur-harga.md` §3.4 ("`productType` null = default global") digantikan: kunci global kini `'global'`.
