# Arsitektur — Komponen Biaya (komponen universal ke-6) + penerapannya di Haji

> **Status: RENCANA (2026-10-26) — belum ada kode yang diubah.** Dibuat setelah recheck langsung ke kode (SOP langkah 1) dan dua keputusan pemilik pada 2026-10-26.
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
| **F4** | Halaman edit Haji + panel; tautan dari daftar | Browser end-to-end: buat produk → tambah komponen USD/SAR/IDR → harga publik berubah → pesan via API |
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

_Belum ada — diisi per fase._
