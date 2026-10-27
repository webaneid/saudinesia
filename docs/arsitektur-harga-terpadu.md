# Arsitektur — Harga Terpadu: Modal – Jual – Untung, Satu Sumber Kebenaran

> **Status: RENCANA (2026-10-27), belum dieksekusi.** Ditulis dari recheck langsung ke kode (bukan dari dokumen lama). Menunggu keputusan §11 sebelum Fase 1.
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
10. Hak akses: Komponen Biaya/HPP superadmin-only (`requireSuperAdmin`); harga jual tampil ke semua peran admin.

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

## 7. Hak akses (usulan, §11-1)

| Peran | Modal & HPP | Untung | Ubah jual manual | Ubah margin default |
|---|---|---|---|---|
| superadmin | lihat + ubah | lihat | ya | ya |
| manager | lihat | lihat | **ya** (permintaan pemilik: harga jual bisa diatur) | tidak |
| admin (operasional) | tidak | tidak | tidak | tidak |
| pilgrim/publik | tidak | tidak | — | — |

## 8. Kontrak ke Booking Engine, Invoice, Laporan (membuka jalan)

- **Booking engine (akan dirombak):** tidak menghitung harga sendiri — memanggil `snapshotPrice(owner, variant, qty)` per item dan menyimpan hasilnya; `totalAmount = Σ totalSellIdr` (invarian I4 dijaga tes). Bentuk tabel item booking tetap bebas ditentukan perombakan itu; kontraknya hanya `PriceSnapshot(itemType, itemId, lineKey)`.
- **Penyesuaian per order** (diskon/negosiasi) = baris `lineKey = "penyesuaian"` bernilai ±; tidak menyentuh `PricePoint`.
- **Invoice:** `lib/pdf/invoiceData.ts` membaca `PriceSnapshot` (jual saja, tampilan pilgrim) — satu sumber, bukan hitung ulang.
- **Laporan keuangan:** pendapatan = Σ jual; modal = Σ modal; **untung = selisih**; terealisasi = proporsi `Payment` terkonfirmasi, dikurangi `Refund`; per booking/produk/vendor/periode. Semua dari snapshot → tidak berubah oleh kurs. Utang vendor aktual (pengeluaran terbayar) = fase terpisah (§11-3).

## 9. Fase eksekusi (satu fase, satu PR, SOP: recheck → build → security → dokumen)

| Fase | Isi | Catatan |
|---|---|---|
| **0** (disarankan segera, berdiri sendiri) | Tutup harga katering dari klien (hitung server-side dari `CateringOption` × hari × orang); satukan baris `PricingRule` global ganda + cegah duplikat; satu konstanta fallback margin | menutup temuan §1.2-6 (High) & 7 |
| **1 Fondasi** | Skema `PricePoint`/`PriceSnapshot`/`PriceChange` (+ migrasi ekspansi); `lib/pricing/engine` + registry; **backfill** dari cache & override Visa; penulisan ganda ke kolom lama agar pembaca lama tetap jalan; tes ekuivalensi rekam-bandingkan (harga per produk sebelum = sesudah) | pola Komponen Biaya yang terbukti |
| **2 Pembaca** | Katalog publik, quota adapter, route booking, PDF invoice membaca `PricePoint`; penjaga CI: tidak ada pembaca kolom lama | 61 file diinventaris per modul |
| **3 UI** | `PriceCard` + mode manual + peran + `PriceChange`; kolom Modal/Jual/Untung; Kesehatan Margin; Katering & Layanan Hotel masuk sistem | |
| **4 Snapshot** | `PriceSnapshot` ditulis oleh route booking (dan nanti engine baru); invarian `totalAmount`; invoice dari snapshot | selaras perombakan engine |
| **5 Kontraksi** | Hapus kolom cache/manual (`*.price`, `included*Price`, `pricePerPerson*`, `durationFeeRules`, `sellPriceOverride` JSON) dan lima `refresh*`; migrasi fail-closed + uji drift | |
| **6 Laporan** | Untung per booking/produk/vendor/periode + terealisasi | butuh keputusan §11-3/4 |

Setiap migrasi mengikuti pola proyek: ekspansi–kontraksi, fail-closed, atomik, diuji pada DB sementara; data dev disposable (fokus mesin, bukan pelestarian data).

## 10. Keamanan

- **Fase 0 menutup High yang ada** (harga katering klien-trusted — siapa pun yang login dan memanggil `POST /bookings` bisa memesan katering dengan harga positif berapa pun, termasuk Rp 1; `CateringOption.pricePerPerson*` bahkan tidak dibaca route booking).
- Manual price = aksi berprivilese: `requireManager` di awal, skema `.strict()`, `PriceChange` tak bisa dihapus lewat UI, batas wajar (> 0, ≤ batas atas), `sellIdr` CHECK di DB.
- I5: DTO publik **tanpa** `costIdr`/margin; penjaga CI memindai `app/api/v1/catalog` dan halaman `(public)`/`(pilgrim)` agar tidak memilih kolom modal; tes yang memanggil API publik dan menegaskan tak ada kunci `cost|margin|hpp`.
- Raw SQL hanya untuk CHECK/indeks parsial di migrasi (tidak ada input pengguna).

## 11. Keputusan yang dibutuhkan (dengan rekomendasi)

1. **Siapa boleh apa?** Usulan §7 (manager boleh ubah jual & lihat untung; admin operasional tidak melihat modal/untung). Setuju atau superadmin saja?
2. **Jual manual di bawah modal (rugi):** izinkan dengan peringatan + catatan wajib (rekomendasi — "bukan patokan utama"), atau blokir?
3. **"Pengeluaran":** cukup **modal terencana** (HPP dari `ProductCost`, dibekukan saat order) — rekomendasi untuk Fase 1–5 — atau juga **pengeluaran aktual** ke vendor (tagihan/pembayaran vendor, utang vendor) sebagai modul laporan terpisah?
4. **Penyesuaian per order** (diskon/negosiasi di satu booking) masuk rancangan ini sebagai baris `penyesuaian` (rekomendasi), diuji bersamaan perombakan booking engine — setuju?
5. **Komposit:** override jual di **total** saja (rekomendasi v1) atau juga **per komponen** (margin per komponen sudah ada sekarang)?
6. **Mode manual vs kurs:** saat kurs berubah, jual manual **tetap** dan untung ikut bergerak + peringatan (rekomendasi), bukan ikut berubah.
7. **Fase 0 sekarang?** Disarankan dikerjakan lebih dulu sebagai PR kecil terpisah.

## 12. Di luar scope
Perombakan bentuk data item booking (milik perombakan engine), pajak/PPN & biaya gateway, multi-mata-uang untuk harga jual (jual tetap IDR), integrasi akuntansi eksternal, dan utang vendor aktual (§11-3) sampai diputuskan.
