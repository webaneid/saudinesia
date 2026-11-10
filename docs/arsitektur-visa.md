# Arsitektur — Modul Visa

> **Status: SOURCE OF TRUTH as-built (ditulis ulang 2026-11-04, Visa V5)** — hasil audit langsung ke kode sesudah rencana `docs/rencana-visa-produk.md`
> V1–V4c. Versi sebelumnya (2026-07-08…2026-10-31: `price`, `durationFeeRules`, `BookingVisa`, `visaProduct.requirements` JSON, wizard 7 langkah,
> pelonggaran per pelanggan) sudah tidak berlaku dan hanya ada di riwayat git. Update dokumen ini setiap kali struktur/alur visa berubah.
>
> Dokumen terkait: harga = `docs/arsitektur-harga-terpadu.md` (titik harga); aturan "wajib dibeli bersama" dan form booking = `docs/arsitektur-booking-engine-v2.md`
> §4.1/§10.2; syarat dokumen dan pemeriksaan jamaah = `docs/arsitektur-jamaah.md` §7–§8; field manifest = `docs/arsitektur-manifest.md`.

---

## 1. Konteks bisnis (kata pemilik)

1. **Visa adalah produk yang kita jual** ("KITA JUALAN VISA"), sejajar tiket/hotel/transport — dipilih di form booking dari daftar produk yang sama.
2. **Visa melekat ke JAMAAH**, bukan ke pelanggan: 4 jamaah ber-visa = 4 `VisaApplication`, satu per orang.
3. **Admin menentukan di produk visa apa yang WAJIB dibeli bersama** (daftar centang 7 jenis). Kosong = **Visa only** (stand alone, mis. "Visa BRN"); berisi =
   **Visa plus** — booking wajib memuat semua yang dicentang, produk mana pun yang cocok. Tidak ada pengecualian per pelanggan (dihapus V3).
4. **Dokumen syarat diatur admin per produk** dan dilengkapi **per jamaah**. Bukti booking hotel/tiket dari luar = dokumen biasa yang dicentang admin, tanpa aturan otomatis.
5. Syarat seorang jamaah = **gabungan** semua produk yang memuatnya (Paket Umroh → Haji → Visa, V4c).
6. **Visa Haji BUKAN `VisaProduct`** — konsep tersendiri yang belum dibangun (CLAUDE.md). Jangan memakai `visaProductId` umroh untuk Haji.

## 2. Skema data aktual (`prisma/schema.prisma`)

| Model | Kolom penting | Catatan |
|---|---|---|
| `VisaProduct` (`visa_products`) | `name`, `country` (bawaan "Saudi Arabia"), `visaType` (teks bebas admin), `description` (teks kaya JSON), `priceLabel`, `processDays`, `isActive`, `requiredComponents Json` | Relasi: `visaApplications`, `includedInPackages` (`Package.includedVisaProductId`), `packageOptions` (`PackageVisaOption`). **Tidak ada kolom harga** (harga terpadu Fase 5). |
| `VisaApplication` (`visa_applications`) | `bookingPilgrimId` (unik — satu visa per jamaah booking), `visaProductId?` (FK `SET NULL`), `visaType` (salinan tampilan), `status VisaStatus`, `submittedAt`, `issuedAt`, `rejectionReason`, `isForceMajeure`, `notes`, `selectedDurationDays?`, `plannedTravelDate? @db.Date` | Ditulis HANYA `lib/booking/lineItems.ts` (pesan) dan `lib/booking/revise.ts` (revisi); status lewat route status (§4). |
| `VisaStatus` | `pending_documents → documents_complete → submitted_to_syarikah → in_review → issued \| rejected`; `rejected → pending_documents` | Transisi = `VISA_STATUS_TRANSITIONS` (`lib/validators/visaStatus.ts`), dipakai klien (`VisaActions.tsx`) DAN server. |
| `DocumentRequirement` (`productType='visa'`) | `documentTypeId`, `label?`, `description`, `required`, `order` | Syarat dokumen produk (katalog `DocumentType`), penulis tunggal `lib/documents/requirements.ts`. |
| `ManifestFieldRequirement` (`productType='visa'`) | field data jamaah per produk | Dikelola di tab "Data jamaah" editor visa, ditulis hanya oleh `lib/manifest/fields.ts`; `POST` produk mengisi 9 kolom bawaan, `GET`/`PUT` `[id]` membawa `manifestFields` (`docs/arsitektur-manifest.md` §9). Jamaah tanpa visa memakai field "core". |
| `ProductCost` / `PreferredVendor` (`productType='visa'`) | komponen `individu` dan `biaya_non_hotel` (BRN), `costTiers` per rentang hari | Masukan HPP; harga jual hidup di `price_points` (§3). |
| `ProductImage` (`ownerType='visa'`) | satu foto unggulan | `lib/media/owners.ts` mode `featured`. |

`requiredComponents` = daftar objek dari SATU daftar jenis `REQUIRED_COMPONENT_TYPES` (`lib/validators/visa.ts`):
`flight` · `hotel_makkah` · `hotel_madinah` · `transport` (`categories?` = `TransportTrip.category`, `tripIds?`) · `muthowif` · `tour` (Paket Ziarah) · `catering`.
Bentuk dijaga `visaRequiredComponentsSchema` (`.strict()`, tiap jenis sekali); data tak sah dibaca `parseRequiredComponents` sebagai `invalid: true` → booking DITOLAK
(fail-closed). Model penjualan = TURUNAN `visaSalesModel(components)` (kosong = only; berisi = plus + label bagian), bukan kolom.

## 3. Harga

- Visa = pemilik harga `visa` (`lib/pricing/engine/owners/visa.ts`): satu **varian per rentang hari** (`days:<min>-<max>`) dari batas tier semua komponen biaya;
  modal = HPP pada hari awal rentang (`computeSellPrice`), unit `person`. Harga manual per tier lewat `setManualSell` (PriceCard).
- Jalur pesan: `takeVisaTier(tx, visaProductId, days)` (`lib/pricing/engine/snapshot.ts`) memilih tier yang memuat lama tinggal (`selectedDurationDays`,
  bawaan `DEFAULT_DURATION_PROBE_DAY`); tak ada tier/≤ 0 → `ItemNotBookableError` 422. Baris snapshot `itemType='visa'`, `itemId` = id `VisaApplication`.
- Visa yang ikut **Paket Umroh** (`included`) TIDAK punya baris harga sendiri — sudah dibayar di baris paket; `VisaApplication` tetap dibuat untuk anggota paket.
- Publik hanya harga jual: `visaPriceSummary` → "Mulai dari" bila tier berbeda harga; rincian tier tidak keluar ke publik.

## 4. API routes (aktual)

| Route | Metode | Peran | Isi |
|---|---|---|---|
| `admin/products/visa` | GET, POST | `requireManager` | daftar; buat (skema lokal `.strict()`, `requirements` opsional — tak dikirim = bawaan paspor/KTP/KK/tiket PP; produk + syarat satu transaksi, `RequirementRejected` → 400 + `meta.field`) |
| `admin/products/visa/[id]` | GET, PUT, DELETE | `requireManager` | GET + `documentRequirements`; PUT info + `requiredComponents` (`visaRequiredComponentsSchema`) + `requirements` ganti-semua (satu transaksi); DELETE = `deleteVisaProduct` (hapus bila tak dirujuk `VisaApplication`/`PackageVisaOption`/`Package.includedVisaProductId`, selain itu nonaktif; baris polimorfik + media dibersihkan) |
| `admin/products/visa/[id]/cost-tiers` | GET, PUT | `requireSuperAdmin` | HPP per tier: komponen `individu` + `biaya_non_hotel` (vendor lewat `assertVendorUsable`), lalu `repriceOwner('visa', id)` |
| `admin/products/visa/[id]/preview`, `admin/products/visa/simulate` | GET | `requireSuperAdmin` | pratinjau/simulasi HPP → jual (tanpa menulis) |
| `admin/visa/[pilgrimId]/status` | PUT | `requireAdmin` | ubah status (`.strict()`; transisi tak sah → 422); `submitted_to_syarikah` hanya bila jamaah `verified`, dibaca di dalam `FOR SHARE` (SEC-202); notifikasi `visa_status_change` (email saja — bukan WhatsApp, ADR-0001; best-effort) |
| `catalog/visa` | GET | publik | produk aktif + harga "mulai dari" + foto |
| `bookings` (POST), draf/revisi admin | — | — | visa per jamaah (`pilgrims[].visaProductId` + `selectedDurationDays`) lewat mesin booking (§5) |

## 5. Alur data end-to-end

1. **Admin menyusun produk** di Produk → Visa → edit (`products/visa/[id]/page.tsx`, tab: Informasi · Persyaratan dokumen (`RequirementsEditor`) ·
   Model penjualan (`RulesTab`: Visa only / Visa plus + daftar centang 7 jenis, filter transport) · Harga dan HPP (`CostTiersTab` + `PriceCard`)).
2. **Booking dibuat** (admin: draf `bookings/drafts/[id]` dengan baris Visa di `ItemRows` — pemetaan kelompok ↔ slot jamaah di `visaRows.ts`; revisi sesudah terbit;
   jamaah: checkout pendek `bookings/checkout/visa` hanya untuk Visa only). Semua lewat `prepareBooking` (`lib/booking/create.ts`):
   - aturan "wajib dibeli bersama" dinilai `visaRuleViolations` (`lib/booking/ruleContext.ts`: `bookingCoverage` dari item + isi Paket Umroh yang ditagih + Paket Ziarah;
     kota hotel dari `Hotel.city` di DB) → `evaluateVisaRules` (`lib/booking/rules.ts`, murni) → pelanggaran = **422 untuk semua pelanggan**;
   - visa paket `included` tidak dinilai aturannya (bundel kurasi admin); visa PILIHAN pelanggan di paket (`user_choice`) dinilai (SEC-125).
3. **Penulisan** (`lib/booking/lineItems.ts`): anggota Paket Umroh/Haji dibagi `assignMembers` (`lib/booking/members.ts`, V4a); visa paket diberikan ke anggota paket;
   anggota paket bervisa yang memegang visa sendiri → 422 (K4). Per jamaah ber-visa: `VisaApplication` (`pending_documents`, `plannedTravelDate` = tiket pergi
   paling awal di booking) + baris snapshot harga tier.
4. **Revisi** (`lib/booking/revise.ts`): visa boleh dihapus/diganti hanya bila R3 (belum ada dokumen, status `pending_documents`); visa baru pada jamaah terverifikasi
   membuka ulang pemeriksaan (SEC-201); anggota diselaraskan ulang (`syncMembers`).
5. **Dokumen & data jamaah**: syarat = `pilgrimRequirements` (`lib/documents/requirements.ts`, gabungan Paket → Haji → Visa dengan sumber "Diminta oleh");
   kelengkapan `evaluateCompleteness`; ajukan/verifikasi `lib/pilgrims/review.ts`. Admin memeriksa di halaman booking (`PilgrimReviewPanel`) dan mengubah kartu/data/dokumen di halaman Kelola jamaah `admin/bookings/[id]/pilgrims/[pilgrimId]` (sejak 2026-11-10); jamaah lewat `PilgrimTripPanel`.
6. **Proses visa**: Admin → Visa (`admin/visa/page.tsx`, daftar berpaginasi + filter status) dan tombol status di halaman booking (`VisaActions`); ke Syarikah
   hanya untuk jamaah terverifikasi; setiap perubahan status → notifikasi email lewat `notify` (tanpa WhatsApp).
7. **Batal/hangus**: visa tidak memakai kuota — `visaAdapter` no-op eksplisit di registry `lib/quota/adapters`.

## 6. Katalog publik

`(public)/visa/page.tsx`: dikelompokkan per negara; harga "Mulai dari"; syarat lewat `components/shared/RequiredDocuments`; Visa only → tombol ke checkout,
Visa plus → "Dipesan bersama: … Hubungi admin" (checkout pendek hanya memuat visa; server tetap menolak 422 bila dikirim).

## 7. Gap / ketidaksesuaian aktif (2026-11-04)

1. **Jamaah belum bisa memesan Visa plus sendiri** — butuh keranjang lengkap front-end (booking engine v2 Fase 11). Sementara dipesan lewat admin.
2. **Visa Haji** belum ada (§1 butir 6); syarat dokumen Haji milik produk Haji (V4b), bukan visa.
3. `app/api/v1/catalog/visa/route.ts` masih menghapus kunci `durationFeeRules` yang kolomnya sudah tidak ada (no-op, tidak berbahaya) — rapikan saat route itu disentuh.
4. Perubahan syarat dokumen produk TIDAK membuka ulang jamaah yang sudah terverifikasi (keputusan sadar, `docs/rencana-visa-produk.md` §3.5).

## 8. Uji yang menjaga modul ini

`scripts/test-visa-rows.ts` (baris Visa ↔ slot jamaah), `test-booking-engine-core.ts` (aturan 7 jenis, penemu sumber penilai), `test-visa-v3-migration.ts`,
`test-booking-members.ts` (+ migrasi), `test-document-requirements.ts`, `test-document-completeness.ts`, `test-pilgrim-requirements.ts`, `test-pilgrim-review.ts`
(Syarikah mensyaratkan terverifikasi), `test-admin-delete.ts` (rujukan FK visa), `test-price-engine.ts`/`test-booking-snapshot.ts` (tier).
