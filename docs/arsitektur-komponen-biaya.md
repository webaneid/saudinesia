# Arsitektur — Komponen Biaya (komponen universal ke-6) + penerapannya di Haji

> **Status: Fase 1-4 SELESAI & TERVERIFIKASI (2026-10-26); hanya Fase 5 (dokumentasi akhir) yang tersisa.** Dibuat setelah recheck langsung ke kode (SOP langkah 1) dan dua keputusan pemilik pada 2026-10-26.
> Dokumen ini menjadi source of truth as-built setelah fase-fasenya dieksekusi (isi §9 diperbarui per fase).

## 1. Konteks dan keputusan

Pemilik meminta: "Komponen Biaya" (biaya bebas bernama — mis. Guide, Makan, Admin Fee — yang dihitung HPP-nya dari vendor + mata uang + kurs, lalu diberi margin) dijadikan komponen yang bisa dipakai di **Haji**, sehingga HPP dan komponen biaya Haji dihitung dengan mekanisme yang sama.

Keputusan (2026-10-26):

1. **Rumus Haji = margin per komponen lalu dijumlah** — sama dengan Paket Ziarah dan Paket Umroh (`ComponentBreakdown.sellPrice` per baris, `componentsTotalSellPrice` = jumlahnya), bukan "jumlah HPP dulu lalu satu margin".
2. **Ekstraksi untuk ketiganya sekaligus** — Haji, Paket Umroh (`Package`), dan Paket Ziarah (`TourPackage`) dipindah ke satu komponen bersama dalam satu rangkaian fase, perilaku modul lama tidak boleh berubah.

## 2. Hasil recheck (kode aktual, 2026-10-26)

### 2.1 Yang sudah generik (data + hitung)

| Bagian | Lokasi | Catatan |
|---|---|---|
| Penyimpanan biaya | `ProductCost` — `prisma/schema.prisma` (`productType` polimorfik, `costComponent` teks bebas, `vendorId`, `currency`, `costTiers` Json) | Dipakai 7 `productType`; Haji cukup `productType = 'haji'`, **tanpa perubahan skema untuk biaya** |
| Margin per tipe | `PricingRule` + `getMarginRule(productType)` — `lib/pricing/pricingHelpers.ts` | Jatuh ke aturan global (default 20 %, pembulatan 50.000) bila tipe belum punya aturan |
| Kurs | `getLatestRate`, cron `lib/cron/exchangeRateJob.ts` | Cron memanggil satu `refreshAll…` per modul (didaftarkan manual) |
| Preview HPP | `simulateSellPrice(productType, komponen[])` — `lib/pricing/simulateSellPrice.ts` | Menerima `productType` sembarang |

### 2.2 Yang BELUM menjadi komponen (disalin per modul)

- **Hitung per komponen**: blok yang mengubah baris `ProductCost` menjadi `ComponentBreakdown[]` ditulis identik di `lib/pricing/computePackagePrice.ts:90-135` dan `lib/pricing/computeTourPackagePrice.ts:78-122` (hanya `productType` berbeda); tipe `ComponentBreakdown` juga dideklarasikan dua kali.
- **Route CRUD**: empat berkas hampir identik — `app/api/v1/admin/products/{packages,tour-packages}/[id]/costs/route.ts` (GET/POST) dan `…/costs/[costId]/route.ts` (PUT/DELETE). Selisih hanya string `productType`, fungsi refresh, dan komentar. Semua `requireSuperAdmin()` (seluruh endpoint biaya di 7 modul superadmin-only — HPP rahasia; ini dipertahankan).
- **Refresh cache + cron**: `refresh{Package,TourPackage}PriceCache` dan `refreshAll…` ditulis ulang per modul; `exchangeRateJob.ts` memanggil masing-masing.
- **UI**: panel "Komponen Biaya" tertanam langsung di dua halaman besar (`products/packages/[id]/page.tsx` 1025 baris, `products/tour-packages/[id]/page.tsx` 740 baris): daftar baris, form (nama, vendor + tambah-vendor-cepat, mata uang, nominal), kolom HPP/Harga Jual, hapus, total. Tidak ada berkas di `components/admin/`.

### 2.3 Haji hari ini

- `HajiProduct.price` = **satu angka manual** (`price: z.number().min(0)` di `lib/validators/adminUpdates.ts`); tidak ada HPP, vendor, mata uang, kurs; cron tidak menyentuhnya; margin `'haji'` belum ada (jatuh ke global).
- Admin: hanya `products/haji/page.tsx` (daftar + buat, 105 baris) dan `PUT /admin/products/haji/[id]`; **belum ada halaman edit**.
- Booking membaca `product.price` di server (`app/api/v1/bookings/route.ts:238-241`, `totalPrice = price × numPersons`) — kompatibel bila `price` menjadi cache.
- Katalog publik (`/haji`, `catalog/haji`) menampilkan `price` apa adanya.

### 2.4 Celah yang ditemukan (pre-existing; ditutup oleh ekstraksi bila disebut)

| ID | Severity | Temuan | Penutupan |
|---|---|---|---|
| G1 | Low (integritas, superadmin-only) | `PUT/DELETE …/costs/[costId]` memanggil `productCost.update/delete({ where: { id: costId } })` **tanpa memastikan baris itu milik produk di path** — superadmin bisa mengubah/menghapus `ProductCost` modul lain lewat URL paket mana pun, lalu cache paket yang salah dihitung ulang | Handler bersama memakai `where: { id, productType, productId }` (cocok → 404) |
| G2 | Low | `POST …/costs` tidak memeriksa produk induk ada: baris `ProductCost` yatim dibuat, lalu `refresh…` (`findUniqueOrThrow`) melempar → 500 | Handler bersama memeriksa induk dulu (404) sebelum menulis |
| G3 | Low | `vendorId` tak divalidasi keberadaannya: id ngawur → galat FK Prisma → 500 | Cek vendor ada (400) |
| G4 | Low (kebenaran) | Preview HPP di halaman **Paket Umroh** memanggil `/admin/products/tour-packages/simulate` (margin `tour_package`), sedangkan harga tersimpan memakai margin `package` — beda bila kedua aturan berbeda | Panel bersama memakai preview milik pemiliknya sendiri |
| G5 | **Medium** (baru bila Haji berharga turunan) | `reserveHaji`/booking Haji tidak menolak produk berharga 0 → Haji tanpa komponen (price 0) bisa dipesan gratis; skema juga tidak memeriksa `isActive` | Booking menolak `price <= 0` (422) dan produk tak aktif; katalog menampilkan "Harga belum ditetapkan" |

G1–G4 dicatat di `docs/lessons-learned.md` (ID baru) saat fase terkait selesai; G5 wajib selesai di fase Haji (menyentuh kode yang diubah fase itu).

## 3. Rancangan

### 3.1 Backend bersama — `lib/pricing/`

- **`costComponents.ts`** (baru)
  - tipe `ComponentBreakdown` (satu definisi; `computePackagePrice`/`computeTourPackagePrice` mengimpornya, re-export untuk kompatibilitas).
  - `computeCostComponents(productType, productId)` → `{ components: ComponentBreakdown[], totalSellPrice }` — memindahkan blok identik di §2.2 apa adanya (logika dipertahankan: tier datar, skip komponen tanpa kurs, `roundToNearest(hpp × (1+margin))`).
  - skema Zod `.strict()`: `costComponentCreateSchema`, `costComponentUpdateSchema` (nominal positif, mata uang, vendor).
- **`costComponentOwners.ts`** (baru) — registry `productType → { exists(id), refresh(id), label }` untuk `'package' | 'tour_package' | 'haji'`. Menambah modul lain nanti = satu entri.
- **`costComponentHandlers.ts`** (baru) — `createCostComponentHandlers(owner)` mengembalikan `{ collectionGET, collectionPOST, itemPUT, itemDELETE, simulateGET }` yang sudah memuat: `requireSuperAdmin()`, validasi Zod, cek induk (G2), cek vendor (G3), scoping `(productType, productId, id)` (G1), `refresh`, serta galat lewat `authFailureResponse`/`isRecordNotFound`. Berkas route per modul menjadi re-export tipis (3 modul × `costs/route.ts`, `costs/[costId]/route.ts`, `costs/simulate/route.ts`).
- **Hitung harga Haji**: `computeHajiPrice.ts` — `price = computeCostComponents('haji', id).totalSellPrice`; `refreshHajiPriceCache(id)` / `refreshAllHajiPriceCaches(currencies?)` (pola persis `refreshTourPackagePriceCache`), didaftarkan di `lib/cron/exchangeRateJob.ts`.

### 3.2 Frontend bersama — `components/admin/pricing/`

- **`CostComponentsPanel.tsx`** — props: `apiBase` (mis. `/api/v1/admin/products/haji/${id}/costs`), `vendorCategory`, `title`/`hint`, `onChanged()` (induk memuat ulang ringkasan harga). Memuat daftar sendiri (GET), form tambah/ubah, pratinjau HPP→Harga Jual langsung (`${apiBase}/simulate`), hapus dengan konfirmasi, baris total. Mempertahankan idiom visual yang sudah baku (`admin-form-panel`, ikon `Wallet`, kotak "Vendor & Mata Uang", pratinjau HPP/Harga Jual) — **tidak boleh tampil sebagai varian baru**.
- **`VendorSelect.tsx`** — dropdown vendor + tambah-vendor-cepat, memakai `vendorQuickAddError` (SEC-61b). Hanya dipakai panel ini; halaman Hotel/Pesawat/Transport/Visa (editor tier/jadwal, bukan komponen bebas) **tidak dimigrasi** di rangkaian ini.

### 3.3 Haji

- `HajiProduct.price` tetap kolom (cache): bukan lagi masukan admin. `hajiProductCreateSchema`/`UpdateSchema` kehilangan `price`; produk baru mulai 0 sampai ada komponen.
- **CRUD lengkap, selalu (arahan pemilik 2026-10-26: "kita ini manusia, bisa salah")**: Create (sudah), Read (daftar + `GET /admin/products/haji/[id]` baru), **Update** (halaman edit: semua bidang inti bisa dikoreksi kapan saja), **Delete** — hapus sungguhan bila produk belum punya booking (`BookingHaji` = 0; komponen biayanya ikut dihapus dalam satu transaksi), dan bila sudah ada booking produk **dinonaktifkan** dengan pesan yang menjelaskan alasannya (data booking/invoice tidak boleh yatim); produk nonaktif dapat **diaktifkan kembali**. Tombol hapus meminta konfirmasi. Route `DELETE` saat ini hanya menonaktifkan (`isActive=false`) — diganti semantik di atas (Fase 3 API, Fase 4 UI), dengan tes untuk kedua cabang.
- Halaman edit admin baru `products/haji/[id]/page.tsx`: bidang inti yang sudah ada di `hajiProductUpdateSchema` (nama, jenis, tahun, tanggal, durasi, deskripsi teks kaya, `includes`, kuota total, aktif) + `CostComponentsPanel` + ringkasan "Harga Jual (per orang)". Galeri gambar **tidak** termasuk (di luar scope; `images` tetap).
- G5: booking Haji menolak `price <= 0` dan produk tak aktif; katalog/halaman publik menampilkan "Harga belum ditetapkan" untuk `price <= 0` dan menyembunyikan tombol pesan.
- Margin Haji: `PricingRule` tipe `'haji'` opsional; tanpa itu jatuh ke global (perilaku yang sama dengan modul lain).
- **Di luar scope (dicatat)**: "Visa Haji" sebagai konsep tersendiri, checkout Haji di browser, galeri gambar Haji, dokumen/manifest Haji — lihat `CLAUDE.md` dan `docs/arsitektur-booking.md`.

## 4. Fase eksekusi (satu fase satu waktu; tiap fase: tsc → `bun run build` terisolasi → uji nyata termasuk kasus ditolak → security check → dokumentasi → PR)

| Fase | Isi | Bukti utama |
|---|---|---|
| **F1** | `costComponents.ts`, registry, handler bersama; route `package` + `tour_package` jadi re-export tipis; `computeXBreakdown` memakai `computeCostComponents`; tutup G1–G3 | **Uji ekuivalensi**: sebelum mengubah, rekam keluaran GET `costs`, `breakdown`, dan `price` tersimpan untuk data uji kedua modul; sesudahnya harus identik. Uji ditolak: costId milik modul lain → 404, induk tak ada → 404 tanpa baris yatim, vendor ngawur → 400, manager/tanpa login → 403. Tes DB `scripts/test-cost-components.ts` + mutasi penjaga |
| **F2** | `CostComponentsPanel` + `VendorSelect`; halaman Paket Umroh dan Paket Ziarah memakainya (hapus kode salinan); tutup G4 | Browser: tambah/ubah/hapus komponen di kedua halaman, angka identik dengan sebelum migrasi (tangkapan sebelum/sesudah), tampilan lama tak berubah; ukuran halaman turun |
| **F3** | Backend Haji: `computeHajiPrice`/refresh/cron, route `haji/[id]/costs…`, skema tanpa `price`, G5 (booking + katalog + halaman publik) | Uji nyata: booking Haji berharga 0 ditolak; komponen → harga cache benar; kurs naik → cron memperbarui; invoice Haji tetap benar |
| **F4** | Halaman edit Haji (update semua bidang inti) + panel + tombol hapus/nonaktif/aktifkan kembali + tautan dari daftar | Chrome end-to-end: buat produk → **ubah** → tambah komponen USD/SAR/IDR → harga publik berubah → pesan via API → **hapus** (tanpa booking = hilang; dengan booking = nonaktif + pesan) → aktifkan kembali |
| **F5** | Dokumentasi akhir: dokumen ini jadi as-built, `docs/arsitektur-haji.md` (as-built Haji, termasuk gap Visa Haji), `CLAUDE.md` (komponen universal ke-6), register temuan, `docs/decisions.md` | — |

Tiap fase satu PR ke `main` (CI `validate` + `docker` hijau, merge setelah persetujuan pemilik).

## 5. Risiko dan mitigasi

- **Regresi harga pada dua modul terverifikasi** — mitigasi: uji ekuivalensi F1 (rekam→bandingkan), bukan hanya "build lulus"; F2 dibandingkan tampilan sebelum/sesudah.
- **Harga Haji 0 untuk produk lama** — produk uji/seed saja (server belum live, belum ada booking nyata); G5 mencegah dipesan; admin mengisi komponen untuk menghidupkan harga.
- **Satu margin per tipe produk** — per-komponen memakai aturan margin tipe produk yang sama untuk semua komponennya (sama seperti Ziarah/Paket); margin per baris tidak ada di rangkaian ini.

## 6. Verifikasi yang wajib (ringkas)

`bun run build` 0 error (dist terpisah) tiap fase; `bun run test` (suite baru ikut CI); uji HTTP nyata termasuk penolakan; mutasi penjaga; `bun audit` tidak memburuk; cek `grep` bahwa tiap proteksi punya pemanggil; browser untuk F2/F4.

## 7. Pertanyaan terbuka (default yang saya ambil, bisa diubah sebelum F3/F4)

1. **Harga manual Haji**: dihapus total (harga hanya dari komponen) — default. Alternatif: tetap boleh manual bila belum ada komponen.
2. **Produk Haji berharga 0**: tetap tampil di katalog sebagai "Harga belum ditetapkan", tidak bisa dipesan — default. Alternatif: disembunyikan dari katalog.
3. **Halaman edit Haji**: bidang inti saja tanpa galeri gambar — default.

## 8. Referensi

`docs/arsitektur-harga.md` (HPP/kurs/margin universal), `docs/arsitektur-ziarah.md` §8.3 (margin per komponen), `docs/arsitektur-paket-umroh.md` §3/§5 (Komponen Biaya custom), `docs/arsitektur-booking.md` (booking Haji di API), `docs/lessons-learned.md` (register).

## 9. As-built

### 9.1 Fase 1 — backend bersama (2026-10-26)

**Dibuat:** `lib/pricing/costComponents.ts` (`ComponentBreakdown`, `computeCostComponents(productType, productId)`), `lib/pricing/costComponentOwners.ts` (registry `package`, `tour_package`), `lib/pricing/costComponentHandlers.ts` (`createCostComponentHandlers(key, { authorize? })` → `collectionGET/POST`, `itemPUT/DELETE`, `simulateGET`), `lib/validators/costComponent.ts` (Zod `.strict()`), `scripts/test-cost-components.ts` (masuk `bun run test`/CI).
**Diubah:** `computePackagePrice.ts` dan `computeTourPackagePrice.ts` memanggil `computeCostComponents` (blok salinan + import/konstanta yang tak terpakai dihapus; tipe `ComponentBreakdown` di-re-export); empat route `…/costs` menjadi 6 baris re-export; **ditambah** `…/costs/simulate/route.ts` per modul (dipakai UI mulai Fase 2).
**Disengaja berbeda dari perilaku lama (semua pengetatan):** komponen milik produk lain → 404 (SEC-63); induk/vendor tak ada → 404/400 tanpa baris yatim (SEC-64); body kini `.strict()` — kolom liar (mis. `productType`) → 400 (dulu diabaikan diam-diam); `costComponent` ≤ 120 dan `currency` ≤ 8 karakter; preview memakai margin tipe pemiliknya (SEC-65).
**Dipertahankan persis:** kontrak respons (GET/POST/PUT/DELETE), urutan pengecekan (auth → body → …), superadmin-only, margin per komponen + pembulatan, komponen tanpa kurs/tier dilewati, urutan baris (tanpa `orderBy` pada `computeCostComponents`).

**Bukti (rekam-lalu-bandingkan, pada DB uji dengan aturan margin berbeda per tipe — package 25 %/100.000, tour_package 30 %/50.000):** snapshot SEBELUM refactor vs SESUDAH — respons `GET costs`, `GET breakdown`, harga tersimpan, skenario POST→PUT→DELETE (harga tiap langkah), 11 kasus penolakan per modul (manager/tanpa login 403, body rusak 400, cost 0 400, id komponen tak ada 404, dst.), `tour-packages/simulate`, katalog `hotel-options`, dan **keluaran `computePackageBreakdown`/`computeTourPackageBreakdown` (dipakai harga booking Ziarah)** — **identik** (snapshot dijalankan dua kali sebelum untuk membuktikan deterministik). Probe celah: G1 PUT lintas modul 200 → 404; G2 500 + 1 baris yatim → 404 + 0; G3 500 → 400. HTTP nyata untuk route `simulate` baru (USD 25: package → 500.000, tour_package → 550.000; manager/tanpa login 403; cost=0 400) dan kolom liar (400).
**Tes:** `scripts/test-cost-components.ts` 14 uji; 5 mutasi tertangkap (hapus scoping PUT, hapus cek induk, simulate salah tipe, hapus `authorize()` di DELETE, margin atas total bukan per komponen). `bun run test` 14 suite lulus; build produksi terisolasi 0 error; `bun audit` tidak berubah (5).
**Catatan proses:** `bun run build` menangkap galat tipe di berkas tes (tsc penuh mencakup `scripts/`) — diperbaiki sebelum PR.

### 9.2 Fase 2 — panel UI bersama (2026-10-26)

**Dibuat:** `components/admin/pricing/CostComponentsPanel.tsx` (props `apiBase`, `vendorCategory`, `hint`, `namePlaceholder`, `onChanged`; memuat daftar + vendor sendiri; CRUD penuh dengan konfirmasi hapus, pratinjau HPP → Harga Jual langsung lewat `${apiBase}/simulate`, total komponen) dan `VendorCurrencyField.tsx` (kotak "Vendor & Mata Uang" + tambah-vendor-cepat dengan `vendorQuickAddError`).
**Diubah:** halaman `products/packages/[id]` (1025 → 837 baris) dan `products/tour-packages/[id]` (740 → 552 baris) memakai panel; state/handler/efek/tipe biaya & vendor inline, `loadCosts`, dan fetch vendor dihapus. Route `tour-packages/simulate` (dipakai salah oleh Paket Umroh) **dihapus** — SEC-65 tuntas.
**Disengaja berbeda dari UI lama (semua perbaikan):** (1) pratinjau di Paket Umroh kini memakai margin `package` — sebelumnya Rp 550.000 padahal tersimpan Rp 500.000; (2) kegagalan simpan/hapus menampilkan pesan server (dulu diam; mis. komponen sudah dihapus admin lain → "Komponen biaya tidak ditemukan", form tetap terbuka); (3) manager yang membuka halaman produk melihat "Komponen biaya (HPP) hanya dapat dilihat dan diubah oleh superadmin", bukan daftar kosong yang menyesatkan; (4) tombol ubah/hapus punya `aria-label`.
**Bukti (Chrome headless asli digerakkan lewat protokol DevTools, DB uji dengan margin berbeda per tipe):** snapshot sebelum/sesudah pada kedua halaman — HTML panel (daftar dan form terbuka) **identik** setelah `aria-label` dibuang; teks halaman penuh identik; skenario tambah → pratinjau → simpan → ubah → hapus menghasilkan baris, ringkasan "Harga Jual Paket", dan harga tersimpan yang sama persis; satu-satunya selisih angka = pratinjau Paket Umroh (550.000 → 500.000, bukti SEC-65). Jalur galat diuji di UI sungguhan: manager (pesan, tanpa tombol Tambah), simpan dan hapus baris yang sudah hilang (galat 404 tampil). Tangkapan layar diperiksa.
**Tes:** `scripts/test-cost-components.ts` +1 uji penjaga UI (halaman memakai panel dengan `apiBase`/`vendorCategory` yang benar, tanpa logika inline, route lama hilang; dimutasi); penjaga SEC-61(b)/UI di `scripts/test-routes.ts` diperbarui ke `VendorCurrencyField` (dimutasi). `bun run test` 14 suite lulus; build produksi terisolasi 0 error; `bun audit` tidak berubah.
**Catatan proses:** browser pane menolak localhost pada sesi ini — verifikasi dilakukan dengan Chrome terpasang yang digerakkan lewat protokol DevTools (skrip sementara, tidak di-commit).

### 9.3 Fase 3 — backend Haji (2026-10-26)

**Dibuat:** `lib/pricing/computeHajiPrice.ts` (`computeHajiBreakdown`, `refreshHajiPriceCache`, `refreshAllHajiPriceCaches` — memproses SEMUA produk termasuk nonaktif), entri `haji` di registry pemilik, route `haji/[id]/costs`, `costs/[costId]`, `costs/simulate` (6 baris re-export), `lib/haji/delete.ts` (`deleteOrDeactivateHaji`), `lib/haji/catalog.ts` (`toCatalogHaji`, `hajiAvailable`, `hajiPriced`), `lib/booking/errors.ts` (`ItemNotBookableError`), `scripts/test-haji-pricing.ts` (15 uji → masuk CI).
**Diubah:** `HajiProduct.price` kini cache — skema buat/ubah **menolak** `price` (`.strict()`), `POST` membuat `price: 0`; `reserveHaji` menolak produk nonaktif/berharga ≤ 0 (SEC-66) dan route booking memetakannya ke 422; `GET /admin/products/haji/[id]` baru (+`bookingCount`); `PUT` mengembalikan harga sebagai angka dan dapat mengaktifkan kembali; `DELETE` bersemantik aman — hapus sungguhan bila belum pernah dipesan (komponen biaya, vendor pilihan, syarat dokumen, field manifest ikut terhapus dalam satu transaksi; baris produk lain tak tersentuh), selain itu nonaktif + pesan jumlah booking; katalog publik dan halaman `/haji` memakai peta eksplisit, `available` memperhitungkan `pending` (SEC-67), 'Harga belum ditetapkan' untuk produk belum berharga; cron kurs memanggil `refreshAllHajiPriceCaches`; halaman daftar admin Haji tak lagi mengirim `price` dan menampilkan 'Belum diatur'.
**Bukti — HTTP nyata (dev server + DB uji, pilgrim/manager/superadmin sungguhan):** buat 201 (price 0), `price` di body 400, tanpa login/pilgrim 403; GET [id] 200 / id tak ada 404; **booking Haji berharga 0 → 422, kuota pending tetap 0, tak ada baris booking**; manager tambah komponen 403 (HPP superadmin-only), superadmin USD 5000 → harga tersimpan 98.400.000 (kurs 16.400 × margin global 20 % → bulat 50.000), ubah ke 6000 → 118.100.000; booking 2 orang 201 dengan `totalAmount` = 236.200.000 (harga × orang, server), pending 2; booking lagi melebihi kuota 409 tanpa mengubah pending; PUT nama 200, `price` 400, `totalQuota` di bawah pending 409, body rusak 400; katalog tanpa kunci kuota, available=1 (3 − 2 pending); **DELETE dengan booking → dinonaktifkan** (produk dan komponen utuh, hilang dari katalog, booking baru 422), **PUT isActive true → aktif lagi dan kembali di katalog**; **DELETE tanpa booking → terhapus beserta komponennya**, GET/DELETE ulang 404, pilgrim 403; halaman `/id/haji` menampilkan 'Harga belum ditetapkan' (dan bukan 'Rp 0').
**Tes:** `scripts/test-haji-pricing.ts` — 7 mutasi pengaman tertangkap (guard nonaktif, guard harga 0, pembersihan komponen saat hapus, cron tak memanggil refresh, katalog bocor kuota, refresh massal melewati nonaktif, pemetaan 422). `scripts/test-rich-text.ts` diperbarui (payload form Haji tanpa `price`; `price` kini ditolak). `bun run test` 15 suite lulus; build produksi terisolasi 0 error; `bun audit` tidak berubah (5).
**Batas pengujian yang jujur:** jalur balapan hapus (booking masuk di antara pemeriksaan dan penghapusan → FK P2003 → jatuh ke nonaktif) hanya dijaga oleh pemeriksaan sumber, tidak disimulasikan.
**Keadaan antara (sudah berakhir di Fase 4):** setelah Fase 3 sebelum Fase 4, produk Haji baru belum bisa diberi komponen biaya lewat UI.

### 9.4 Fase 4 — UI Haji: edit, komponen biaya, hapus aman (2026-10-26)

**Dibuat:** `app/[locale]/admin/(protected)/products/haji/[id]/page.tsx` — header (kembali, nama, badge status), **Info Produk** (nama, jenis, tahun, tanggal berangkat/kembali, durasi, kuota total dengan ringkasan Ditahan/Terjual/Sisa, deskripsi teks kaya, "Yang Termasuk", saklar Aktif, Simpan), `CostComponentsPanel` (`vendorCategory="haji"`), kartu **Harga Jual per Orang** (cache; "Belum ditetapkan … tidak dapat dipesan" bila 0), dan **Zona Berbahaya** (tombol "Hapus Produk" bila belum pernah dipesan, "Nonaktifkan Produk" bila ada booking — dengan konfirmasi dan penjelasan; aktifkan kembali lewat saklar Aktif).
**Diubah:** daftar `products/haji` — nama dan tombol "Kelola" menuju halaman edit (di samping Nonaktifkan/Aktifkan); pesan validasi skema Haji berbahasa Indonesia (dulu teks Zod bawaan seperti "Number must be greater than or equal to 0"); galat/pesan lama dibuang saat pengguna mengubah form atau panel biaya berubah.
**Bukti — Chrome headless asli (protokol DevTools; superadmin dan manager sungguhan; DB uji):** buat dari daftar (tanpa kolom harga; muncul "Belum diatur") → Kelola → form terisi dari server → ubah nama/kuota/durasi/"termasuk" (tersimpan di DB) → kuota negatif menampilkan "Kuota total tidak boleh negatif" → tambah komponen USD 5000 (pratinjau HPP Rp 82.000.000 / Harga Jual Rp 98.400.000; ringkasan dan cache DB 98.400.000) → ubah ke 6000 (118.100.000) → **produk berbooking:** tombol "Nonaktifkan Produk", penjelasan jumlah booking, pesan hasil, status DB nonaktif, komponen tetap ada, lalu **aktif kembali** lewat saklar → **produk tanpa booking:** "Hapus Produk" → kembali ke daftar, produk dan komponen terhapus di DB (0/0), membuka URL yang sudah dihapus menampilkan "Produk haji tidak ditemukan" → **manager:** halaman terbuka, panel menampilkan "hanya dapat dilihat dan diubah oleh superadmin", harga tetap terlihat, info tetap bisa diedit. Tangkapan layar diperiksa.
**Tes:** `scripts/test-haji-pricing.ts` +1 penjaga UI (halaman edit memakai panel Haji, PUT/DELETE, konfirmasi, tanpa input harga; daftar menaut ke edit) — 2 mutasi tertangkap. `bun run test` 15 suite lulus; build produksi terisolasi 0 error; `bun audit` tidak berubah (5).
**Cacat yang ditemukan lewat verifikasi UI dan diperbaiki di fase ini:** pesan galat berbahasa Inggris dari Zod; banner galat basi yang bertahan setelah tindakan lain berhasil.
**Di luar scope (dicatat):** galeri gambar Haji; "Visa Haji" sebagai konsep tersendiri; checkout Haji di browser.
