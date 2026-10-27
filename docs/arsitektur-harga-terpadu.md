# Arsitektur — Harga Terpadu: Modal – Jual – Untung, Satu Sumber Kebenaran

> **Status: RENCANA DISETUJUI (2026-10-27) — keputusan pemilik di §11; Fase 0 (§13), Fase 1 (§14) dan Fase 2 (§15) dieksekusi, Fase 3+ menyusul satu per satu.** Ditulis dari recheck langsung ke kode (bukan dari dokumen lama).
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
14. **(Ditemukan Fase 1)** Tarif layanan muthowif dirancang singleton tetapi tabel `muthowif_service_price` tidak menjaganya — DB dev punya DUA baris (sisa seed + baris berbiaya). Kode lama memilih satu lewat `findFirst()` tanpa urutan, sehingga cache baris berbiaya basi diam-diam (500.000 padahal 360.000 × 1,2 = 450.000). Mesin menghitung SETIAP baris dengan biayanya sendiri. Pembaca (katalog, booking, `findFirstOrThrow`) masih memakai `findFirst()` — Fase 2 menetapkan satu baris resmi.

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
| **1 Fondasi** ✅ SELESAI & TERVERIFIKASI 2026-10-27 (§14) | Skema `PricePoint` (+ migrasi ekspansi; `PriceSnapshot` → Fase 4, `PriceChange` → Fase 3 — hanya dibuat saat dipakai); `lib/pricing/engine` + registry; **backfill** dari cache & override Visa (dikerjakan mesin, bukan SQL); penulisan ganda ke kolom lama agar pembaca lama tetap jalan; tes ekuivalensi rekam-bandingkan (harga per produk sebelum = sesudah) | pola Komponen Biaya yang terbukti |
| **2 Pembaca** ✅ SELESAI & TERVERIFIKASI 2026-10-27 (§15) | Katalog publik, quota adapter, route booking, komputasi paket membaca `PricePoint`; penjaga CI: tidak ada pembaca kolom lama (PDF invoice → Fase 4: membaca snapshot) | inventaris lewat kompiler, bukan pencarian teks |
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

## 14. As-built Fase 1 — fondasi: `PricePoint` + mesin (2026-10-27)

**Skema.** Hanya `PricePoint` (migrasi ekspansi murni `20261028120000_price_points`): `ownerType`/`ownerId`/`variantKey` (unik) + `unit`, `costIdr` (null = modal belum diisi/belum lengkap), `autoSellIdr`, `manualSellIdr`, `sellIdr`, jejak (`marginPctUsed`, `roundingUsed`, `fxRateIds`, `vendorIds`). **Invarian I2 dijaga DB**, bukan hanya kode: `CHECK sellIdr = COALESCE(manualSellIdr, autoSellIdr)` dengan salah satunya wajib terisi, dan tak ada nominal negatif. Penyimpangan dari rencana §3 (disengaja, "hanya dibuat saat dipakai"): `PriceSnapshot` dibuat di Fase 4, `PriceChange` + `manualBy/manualAt` di Fase 3 (bersama penyetel harga manual dan perlakuan UU PDP untuk kolom user-id), `PricingRule` tidak di-rename (`minMarginPercent` → `defaultMarginPercent` ikut kontraksi Fase 5 agar tak menyentuh puluhan pembaca sekarang), `lib/pricing/policy.ts` di Fase 3 (belum ada pemanggilnya).

**Mesin** (`lib/pricing/engine/`): `service.ts` (`repriceOwner`, `repriceOwnerType`, `repriceAll`, `sweepOrphanPricePoints`, pembaca `getPricePoint(s)`), `owners/` (registry `PRICE_OWNERS`: visa, flight, hotel, transport, muthowif, tour_package, package, haji — urutan dasar → paket), `types.ts`. Satu-satunya penulis `price_points` (dijaga tes sumber). Cara kerja satu `repriceOwner`: hitung varian dari modal (`computeSellPrice` / `computeCostComponents`, rumus yang SAMA dengan sebelumnya) → simpan titik harga dalam satu transaksi → **tulis ganda** ke kolom lama (`*.price`, `VisaProduct.durationFeeRules`) → pembaca lama tak berubah.
- *Modal hilang* → harga yang ada **dipertahankan**, `costIdr = null` (tanda "modal belum diisi"), tak pernah direset ke 0 dan tak lagi basi tanpa tanda (menutup §1.2-8).
- *"Jual tanpa modal"* — titik belum ada, modal kosong, kolom lama > 0 → dipungut sebagai titik bermodal null (data dev: harga Transport Rp 6.000.000 dan baris muthowif sisa seed).
- *Visa*: satu titik per tier (`days:min-max`); `sellPriceOverride` di JSON tier menjadi `manualSellIdr` varian itu (sumber manual lama, dipindah di Fase 3); tier yang dibuang → titik dibuang (`prunes`); `durationFeeRules` + `price` termurah ditulis dari titik.
- *Komposit* (Haji, Paket Umroh, Paket Ziarah): jual = Σ jual per komponen + bagian `included` (harga tersimpan, apa adanya — sama dengan sebelumnya); **modal = Σ HPP komponen + modal bagian yang dapat dipastikan** (hotel: malam × kamar × modal jadwal; kendaraan/tiket/visa-termurah: modal titik harga modulnya). Bagian included yang modalnya tak dapat dipastikan (**muthowif, katering** — satuan belum baku; atau titik harga sub-modul tanpa modal) membuat modal paket **null**: untung tak diklaim lebih besar dari kenyataan. Komposit selalu punya titik (bernilai 0 bila kosong), seperti cache lama yang selalu menulis.
- *Pemicu* tak berubah: pembungkus `refresh*Cache` (kini satu baris ke mesin) tetap dipanggil dari semua route biaya/editor; `refreshAllPricingCaches` = `repriceAll` (cron kurs + ubah margin). Putaran kurs hanya menyentuh pemilik ber-biaya mata uang itu, **kecuali paket** (`dependsOnOthers`: modalnya membaca titik harga modul lain). Hapus produk membersihkan titik harganya (`dropPolymorphic`, hapus Haji, hapus jadwal penerbangan/harga transport); yatim akibat hapus berantai (hotel → jadwal kamar) disapu di akhir `repriceAll`.
- Muthowif: setiap baris tarif dihitung dengan biayanya sendiri (temuan §1.2-14).

**Pembuktian.** (1) *Rekam-bandingkan pada data dev nyata* (skrip tidak di-commit; salinan di scratchpad sesi): kolom harga lama sebelum vs sesudah `repriceAll()` pada Visa 2, Pesawat 1, Transport 20, Haji 1, Paket Umroh 3, Paket Ziarah 2 → **identik**; satu-satunya selisih adalah harga muthowif berbiaya yang memang basi (500.000 → 450.000, §1.2-14). 14 titik harga terbentuk; 6 bermodal null (semuanya harga lama tanpa modal atau paket kosong bernilai 0). (2) `scripts/test-price-engine.ts` — 17 tes DB sungguhan (modal/jual/untung, kurs & jejak, modal hilang tak mereset, jual tanpa modal, manual menang & bertahan, 8 hitung ulang paralel → satu baris, Visa tier + override + prune, komposit Haji per-komponen vs satu margin, Paket dengan hotel/muthowif/hotel tanpa modal, Paket Ziarah, margin berubah menggeser semua titik, yatim disapu, hapus Visa membersihkan, penjaga sumber penulis tunggal) dan **13 mutasi tertangkap semua** (modal hilang jadi 0, manual diabaikan/dihapus, prune dimatikan, bagian tak diketahui dianggap 0, kolom lama tak ditulis, satu margin atas total Haji, sapu/pembersihan yatim mati, adopsi harga lama mati, modal tak ditandai kosong, hapus produk tak membersihkan, kurs tak tercatat). (3) `scripts/test-price-points-migration.ts` — migrasi pada DB pra-migrasi nyata: ekspansi murni, CHECK I2 menolak kombinasi tak konsisten/negatif/tanpa sumber, keunikan, **tanpa drift** (uji drift pindah ke migrasi terbaru; dicabut dari `test-pricing-rule-migration`). Penjaga lama yang menunjuk sumber `refresh*` diperbarui ke mesin (`test-cost-components`, `test-haji-pricing`, `test-pricing-phase0`). Seluruh rangkaian 458 PASS, build terisolasi 0 error, `bun audit` tanpa critical.

**Belum (sengaja, Fase berikut).** Pembaca masih membaca kolom lama (Fase 2); tak ada UI/penyetel harga manual (Fase 3); tak ada snapshot booking (Fase 4); kolom lama masih ada (Fase 5). `PricePoint` belum keluar ke API publik mana pun (I5 terjaga trivial — penjaga CI untuk DTO publik ditambah saat pembaca pindah di Fase 2).

## 15. Fase 2 — pembaca pindah ke `PricePoint` (2026-10-27)

**Recheck (kode aktual, 2026-10-27).** Inventaris pembaca TIDAK diambil dari pencarian teks (79 file, banyak salah sasaran) melainkan dari **kompiler**: skema salinan tanpa 9 kolom cache (`VisaProduct.price/durationFeeRules`, `FlightSchedule/HotelRoomSchedule/TransportPricing/MuthowifServicePrice/HajiProduct/Package/TourPackage.price`) → client Prisma terpisah → `tsc`; tiap galat = satu pembaca/penulis. Hasil: ±45 titik di server, terbagi (a) **logika**: `POST /bookings` (hotel, transport, muthowif, haji), adapter kuota Haji, `computePackagePrice`/`computeTourPackagePrice` (harga hidup sub-modul), jalur snapshot `included*Price` (admin paket umroh/ziarah), `lib/haji/catalog`; (b) **tampilan publik/pilgrim**: halaman beranda, hotel, penerbangan, transport, muthowif, visa (+checkout), haji, paket, tur dan 8 route `catalog/*`; (c) **tampilan admin** (route/halaman yang mengembalikan baris + `price`); (d) **penulis** (`create … price: 0`, tes, seed). Kompiler tidak melihat DTO yang mengembalikan baris utuh/`include` bersarang ke klien — itulah mengapa (c) tidak dipaksa di fase ini.

**Rencana.**
1. **Backfill SQL** (migrasi): titik harga dari kolom lama untuk baris yang belum punya (modal null; Visa dari `durationFeeRules`; komposit selalu) sehingga pembaca baru aman SEGERA setelah `migrate deploy`; **`repriceAll()` saat boot server** (`instrumentation-node`) mengisi modal & memperbaiki cache basi. Idempoten, fail-closed, diuji pada DB pra-migrasi nyata.
2. **Pembaca tunggal** `lib/pricing/engine/read.ts`: `sellPrices(ownerType, ids)`, `sellPrice`, `requireSellPrice` (tak ada titik / ≤ 0 → `ItemNotBookableError` → 422: **tak ada lagi pemesanan bergaris Rp 0** — hotel, transport, muthowif kini ikut aturan yang dulu hanya Haji), `withSellPrice(rows)` (DTO tetap bernama `price`, sumbernya titik harga), `visaFeeRules`.
3. Pindahkan (a) dan (b). (c) **sengaja ditunda ke Fase 3** (halaman admin dirombak menjadi `PriceCard` yang membaca titik harga langsung); daftarnya dibekukan sebagai **allowlist yang dijaga tes** dan wajib menyusut.
4. **Penjaga CI** `scripts/test-price-readers.ts`: mengulang percobaan kompiler di atas (client Prisma tanpa kolom cache di direktori sementara + `tsc`) dan menegaskan: tak ada galat BACA di luar mesin/tes/seed kecuali allowlist admin; allowlist tak boleh basi; penulis (`create/update`) dikecualikan sampai Fase 5. Plus penjaga DTO publik: respons `catalog/*` tak memuat kunci modal/margin (I5).

**Di luar fase ini:** invoice/snapshot booking (Fase 4), halaman admin & penyetel manual (Fase 3), katering/Layanan Hotel (Fase 3), `included*Price`/`pricePerNight` (masukan admin yang boleh disunting — nasibnya diputuskan di Fase 3/5), kolom (Fase 5).

### 15.1 As-built Fase 2

- **Migrasi backfill** `20261028140000_price_points_backfill` (SQL murni, idempoten): titik harga (modal NULL) dari kolom lama untuk Pesawat/Hotel/Transport/Muthowif bila harga > 0, Haji/Paket Umroh/Paket Ziarah selalu, Visa dari rentang tier `durationFeeRules` (fee > 0); `ON CONFLICT DO NOTHING` — titik yang sudah ditulis mesin tak pernah ditimpa. **`repriceAll()` saat boot** (`instrumentation-node`, fire-and-forget) mengisi modal dan memperbaiki cache basi. Diuji pada DB pra-migrasi nyata (data lama lewat ORM): semua pemilik, tak menimpa, idempoten (SQL dijalankan dua kali), tabel kosong / JSON bukan-array aman, tanpa drift (uji drift terbaru pindah ke berkas ini).
- **Pembaca tunggal** `lib/pricing/engine/read.ts`: `sellPrices/sellPrice/withSellPrice/getMuthowifServicePrice/visaFeeRules/visaPriceSummary/requireSellPrice`. Hanya HARGA JUAL yang keluar (I5); modal/untung hanya lewat `getPricePoint(s)` (admin).
- **Dipindah:** `POST /bookings` (hotel, transport, muthowif, haji), adapter kuota Haji, `computePackagePrice`/`computeTourPackagePrice` (harga hidup sub-modul), jalur snapshot `included*Price`/`pricePerNight` (admin paket umroh & ziarah), `lib/haji/catalog`, 8 route `catalog/*`, halaman beranda, hotel (daftar+detail), penerbangan, transport, muthowif (daftar+detail), visa (+checkout), haji, paket, tur, dan tiga route admin yang bertipe (haji/[id], harga hotel per periode, daftar jadwal kamar).
- **Perubahan perilaku yang disengaja (menutup lubang):** hotel, transport, muthowif kini ikut aturan Haji — titik harga tak ada atau ≤ 0 → `ItemNotBookableError` (422), **tak pernah dipesan seharga Rp 0** (SEC-74). Pembaca Visa: "mulai dari" = termurah di antara tier (sama seperti dulu); Visa yang semua biayanya dihapus kini tampil Rp 0 / belum berharga (dulu cache lama tertinggal basi — temuan §1.2-8).
- **Penjaga CI** `scripts/test-price-readers.ts` (±6 detik, tanpa DB): skema salinan tanpa 9 kolom cache → client Prisma sementara → `tsc` seluruh proyek; galat BACA di luar mesin/tes/seed = gagal; daftar putih admin **kosong** (semua pembaca bertipe sudah pindah); penulis (`create/update … price`) dikecualikan sampai Fase 5 (9 berkas, informasi). Tes lain: `scripts/test-price-engine.ts` (+4: pembaca, `requireSellPrice` termasuk klien transaksi, ringkasan Visa, **I5 — respons katalog publik tanpa kunci modal/margin/HPP/jejak kurs-vendor**), `test-haji-pricing` (produk berharga = titik harga).
- **Pembuktian ke server berjalan** (dev, port uji, token jamaah sungguhan; data uji dibersihkan): hotel tanpa titik harga → 422 "Harga kamar hotel belum ditetapkan", kuota tidak ikut tertahan; hotel berharga → 201, `totalAmount` 7.200.000 (1.200.000 × 3 malam × 2 kamar) dan `pricePerNight` tersimpan 1.200.000; Haji tanpa titik → 422; Haji berharga → 201 12.000.000 (6.000.000 × 2); halaman publik (penerbangan, visa, haji, paket, transport, muthowif, beranda, detail hotel) dan checkout Visa/Transport merender harga dari titik harga; katalog `visa` tak membocorkan `durationFeeRules`. Seluruh rangkaian 469 PASS; 8 mutasi pembaca/penjaga tertangkap (harga 0 lolos, MAKS bukan termurah, pembaca lama disisipkan di halaman publik / di komputasi paket, adapter Haji tanpa cek, katalog bocor tier, rentang Visa mati, `requireSellPrice` mengabaikan klien transaksi — yang terakhir awalnya LOLOS, ditutup dengan tes transaksi).
- **Belum — sengaja Fase 3:** DTO admin yang mengembalikan baris utuh / `include` bersarang ke klien (daftar & detail Visa, Pesawat, Transport, Hotel, Paket…) tidak terlihat kompiler dan masih membawa kolom `price` lama (nilainya sama selama penulisan ganda). Halaman admin dirombak menjadi `PriceCard` yang membaca titik harga langsung; kontraksi Fase 5 dilindungi tes sebelum kolom dihapus. Juga: invoice/snapshot (Fase 4); `included*Price`/`pricePerNight` tetap masukan admin yang boleh disunting.
- **Catatan data:** `hotels` publik menghitung `minPricePerNight` termasuk jadwal berharga 0 (perilaku lama, tak diubah); tarif muthowif "singleton" yang punya dua baris tetap dibaca lewat `findFirst()` (§1.2-14) — baris resmi ditetapkan bersama perapian Fase 3.

## 16. Fase 3 — UI `PriceCard`, harga manual, Kesehatan Margin, Katering & Layanan Hotel (rencana, 2026-10-27)

**Recheck (kode aktual).** Admin punya 8 editor yang masing-masing menampilkan modal/jual dengan idiom sendiri: Visa (`CostTiersTab`, kolom override jual per tier di JSON `sellPriceOverride`), Pesawat, Hotel (harga per periode), Transport (trip), Muthowif, Haji / Paket Umroh / Paket Ziarah (`CostComponentsPanel`). Role: halaman produk hanya `manager|superadmin`; editor biaya (HPP/Komponen Biaya) `requireSuperAdmin`. Katering (`CateringOption.pricePerPerson*`) dan Layanan Hotel (`HotelService.price`) murni angka manual tanpa modal. `PricingRule` tanpa batas atas (SEC-72) dan tanpa ambang peringatan. Tarif muthowif "singleton" tidak dijaga DB (§1.2-14). `scripts/test-deletion.ts` mewajibkan perlakuan eksplisit untuk setiap kolom `…userId` baru.

**Keputusan rancangan.**
1. **Harga manual hidup di `price_points`** (`manualSellIdr`, `manualNote`, `manualBy`, `manualAt`) dan diubah HANYA lewat mesin (`setManualSell` / `clearManualSell`), tiap perubahan ditulis ke `PriceChange` (siapa, kapan, dari→ke, catatan). Mesin menguncinya (`SELECT … FOR UPDATE` pada titik pemilik) agar hitung-ulang paralel tak menimpa harga manual. Validasi: > 0, ≤ batas atas wajar, **catatan wajib bila jual < modal** (§8.2) — tidak diblokir, tercatat; di atas modal boleh tanpa catatan.
2. **Override Visa di JSON dihentikan**: migrasi menyalinnya ke `manualSellIdr` (dengan catatan asal) lalu membuang kunci `sellPriceOverride` dari JSON tier; `computeSellPrice`, validator, dan route biaya tak lagi mengenalnya; kolom override di `CostTiersTab` diganti `PriceCard`. Pemesanan Visa memakai harga varian dari titik harga (HPP snapshot tetap dari perhitungan modal).
3. **Policy satu titik** `lib/pricing/policy.ts` (keputusan §7/§11-1): melihat modal/untung, mengatur harga jual manual, dan melihat Kesehatan Margin = **semua peran admin** untuk sementara; mengubah aturan margin global tetap superadmin. **Mengedit HPP/Komponen Biaya TIDAK dibuka** (pemilik membuka *melihat* dan *harga jual*, bukan penyuntingan modal) — tetap `requireSuperAdmin` sampai alur role ditetapkan; deviasi sadar dari kalimat §7 "dibuka di Fase 3".
4. **`PriceCard`** (satu komponen, `components/admin/pricing/`): tiga angka sejajar Modal · Harga Jual · Untung (Rp & %), badge Otomatis/Manual, peringatan (rugi / modal belum lengkap / margin tipis), atur & kembalikan harga manual, riwayat singkat; ditempel di kedelapan editor (rincian modal tetap editor yang ada, sebagai bagian "Modal"). Daftar produk (Visa, Haji, Paket Umroh, Paket Ziarah) mendapat kolom Modal/Untung.
5. **Kesehatan Margin** (`/admin/products/margin-health`, tautan sidebar): daftar titik harga bermasalah — rugi, di bawah ambang (`PricingRule.warnBelowPercent`, bawaan 0 = hanya rugi), modal belum diisi/lengkap, harga 0 (belum berharga) — dengan tautan ke editor. Satu service, satu route GET.
6. **Katering & Layanan Hotel masuk sistem** sebagai pemilik **manual-only** (`catering`: varian `season:regular|ramadan|hajj`, satuan orang-hari; `hotel_service`): harga jual dan (opsional) modal diisi admin langsung di `PriceCard`; penulisan ganda ke kolom lama; pembaca (`computeCateringPrice`, katalog, paket umroh) pindah ke titik harga; penjaga kompiler diperluas ke kolom ini. Tanpa Komponen Biaya untuk keduanya (model data berbeda: tiga musim).
7. **Perapian terbawa:** SEC-72 (batas atas aturan margin) + `warnBelowPercent`; tarif muthowif dijaga satu baris oleh DB (kolom `singleton` unik + CHECK, dedupe di migrasi, pembuatan tahan balapan); DTO admin yang mengembalikan baris utuh membawa `price` dari titik harga.

**Urutan eksekusi (satu PR, beberapa langkah berurutan, tiap langkah tsc + tes):** 3A skema+migrasi (PriceChange, audit manual, warnBelowPercent, singleton muthowif, pindah override Visa) → 3B mesin (manual, kunci, policy, Kesehatan Margin service) + route → 3C `PriceCard` + integrasi 8 editor + kolom daftar + halaman Kesehatan Margin → 3D Katering & Layanan Hotel → 3E DTO admin + penjaga → pembuktian (tes DB, mutasi, Chrome sungguhan, curl) → dokumen.
