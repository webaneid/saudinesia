# CLAUDE.md — Saudinesia

> Hajj & Umrah booking platform for Indonesian pilgrims (WNI). Covers visa documentation, hotels (Makkah/Madinah), transport, muthowif, catering, and heritage tours. Saudinesia is the curated operator — holds all inventory, liability, and payments. See `docs/spec.md` for features and `docs/architecture.md` for DB schema, data flows, and API design. **For per-module architecture (Visa, Transport, etc.), see the section below — those files supersede `docs/architecture.md` for their module.**

---

## Dokumentasi Arsitektur per Modul

Setiap modul produk (Visa, Transport, Hotel, Muthowif, Haji, Umroh/Booking Core, Katering & Tour, Paket, Group Booking, dst.) punya dokumen arsitektur tersendiri di `docs/arsitektur-<modul>.md`. Dokumen ini:

- Ditulis berdasarkan audit langsung ke kode aktual (schema, API routes, komponen) — bukan rencana/aspirasi
- Adalah **source of truth** untuk modul itu — menggantikan bagian terkait di `docs/architecture.md` (yang jadi arsip desain awal dan overview folder structure saja)
- Wajib berisi: konteks bisnis, skema Prisma aktual dengan file:line, tabel API routes aktual, alur data end-to-end, dan seksi "Gap / Ketidaksesuaian Aktif" jika ditemukan kode yang belum sinkron dengan rencana/dokumentasi lama
- Di-update setiap kali struktur/alur modul berubah — jangan biarkan basi
- Dirujuk dari `docs/progress.md` pada section milestone modul terkait

Status per 2026-07-25: `docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`, `docs/arsitektur-umroh.md` (booking core), `docs/arsitektur-tiket-pesawat.md`, `docs/arsitektur-hotel.md`, `docs/arsitektur-ziarah.md` (Situs Wisata + Paket Ziarah), `docs/arsitektur-paket-umroh.md` (`Package`/Paket Umroh), `docs/arsitektur-booking.md` (booking engine universal — SELESAI & TERVERIFIKASI penuh 8 step, kecuali checkout Haji sengaja di luar scope), `docs/arsitektur-dokumen.md`, `docs/arsitektur-manifest.md`, `docs/arsitektur-alamat.md`, dan `docs/arsitektur-komponen-kontak.md` sudah dibuat. Modul lain (Haji sebagai produk katalog — termasuk konsep "Visa Haji" tersendiri yang masih belum digarap, Katering sebagai modul mandiri, Group Booking) belum punya dokumen terpisah — masih merujuk `docs/architecture.md`/`docs/spec.md`.

`docs/arsitektur-alamat.md` — **SELESAI & TERVERIFIKASI (2026-07-23), termasuk wiring**: komponen universal ke-4 (sejajar harga/dokumen/manifest) — cascading Provinsi→Kab/Kota→Kecamatan→Desa/Kelurahan dari data resmi Kemendagri ([cahyadsn/wilayah](https://github.com/cahyadsn/wilayah), MIT, 38 provinsi/514 kab-kota/7.285 kecamatan/83.762 desa-kelurahan, dikonfirmasi persis cocok sumber). Model `Address` (bukan tabel pivot — FK `addressId` biasa) mendukung 2 mode: domestik (4 tabel wilayah) dan internasional (negara dari daftar statis ISO 3166-1, bukan tabel DB). Komponen frontend reusable `AddressPicker` (`components/shared/`) — combobox berjenjang, dipakai token shadcn standar supaya cocok di admin maupun pilgrim. Sudah diwire ke `User` (profil), `Vendor` (settings, sekaligus naik jadi create+edit penuh), `Hotel` (§9) — nested lewat `upsertAddress()`, atomik dalam satu request. `BookingPilgrim`/Manifest (`docs/arsitektur-manifest.md`, sudah dieksekusi 2026-07-24) TIDAK memakai `fieldType='address'` — belum ada field alamat di seed manifest visa hari ini, tetap kandidat masa depan kalau dibutuhkan.

`docs/arsitektur-komponen-kontak.md` — **SELESAI & TERVERIFIKASI (2026-07-23)**: komponen universal ke-5 — blok "Data Kontak" reusable (kode negara autocomplete default Indonesia, dial code dari `COUNTRIES` yang diperluas + Nomor HP + Nomor WhatsApp dengan checkbox "Sama dengan nomor HP" yang menyamakan kode negara juga + Email prefill dari akun). Komponen frontend `ContactPicker` (`components/shared/`), diwire ke `BookingPilgrim` (+3 kolom `phoneCountryCode`/`whatsapp`/`whatsappCountryCode`) lewat wizard `bookings/new/pilgrims` — jamaah #1 (Pemesan) di-prefill dari akun. **Sengaja TIDAK menyentuh** registrasi/profil akun (nomor WA di `User` tetap identitas OTP tunggal, beda konsep dari "data kontak") maupun `Vendor.contactInfo`. 2 bug ditemukan & ditutup saat verifikasi browser+end-to-end (checkbox tidak bisa dilepas-centang; `payment/page.tsx` tidak meneruskan field baru ke payload) — lihat §10 dokumen itu.

`docs/arsitektur-manifest.md` — **SELESAI & TERVERIFIKASI untuk Visa (2026-07-24)**: form per-orang 100% custom diatur admin — `ManifestFieldRequirement` (polimorfik +`role` untuk tag sistem), `BookingPilgrim` kolom baku (`fullName`/`gender`/`email`/`phone.../passportNumber`/dst.) **DIHAPUS TOTAL**, diganti `fieldValues: Json`. Seed 9 field default untuk kedua `VisaProduct` existing. Komponen frontend `components/booking/ManifestFieldsForm.tsx` (render generik 8 fieldType) diwire ke wizard (`pilgrims/page.tsx`, Jenis Visa dipindah ke atas). `fieldType='phone'` di sini TIDAK pakai `ContactPicker`/checkbox sinkron — trade-off sadar demi generik. 11 file konsumen direwrite, baca nama/kontak via `getFieldByRole()`. UI admin builder utk `ManifestFieldRequirement` itu sendiri belum ada (cuma via seed/script) — lihat §8 dokumen untuk bukti verifikasi lengkap.

`docs/arsitektur-dokumen.md` — **SELESAI & TERVERIFIKASI untuk Visa (2026-07-24)**: syarat upload (KTP/Paspor/dst.) jadi komponen reusable — `DocumentRequirement` menggantikan `VisaProduct.requirements` (JSON lama TETAP ada, dual-write dari admin builder, dipertahankan sementara sesuai §5). 9 file konsumen dipindah ke `getDocumentRequirements()`. Baru Visa yang benar-benar pakai — produk lain menyusul saat diintegrasikan ke booking engine. Lihat §8 dokumen untuk bukti verifikasi.

`docs/arsitektur-booking.md` — **SELURUH 8 STEP SELESAI & TERVERIFIKASI (Step 1-3: 2026-07-24, Step 4: 2026-07-24, Step 5-8: 2026-07-25) — Haji SENGAJA DIKELUARKAN dari Step 6, satu-satunya pengecualian**: satu keranjang campur bebas (cart e-commerce) — satu `Booking` = satu invoice = satu konfirmasi pembayaran untuk kombinasi item apa pun, manifest orang tak terbatas jumlahnya, strategi migrasi Opsi B (adapter di atas tabel per-tipe existing, bukan `BookingItem` polimorfik). Dokumen ini SEKARANG SOURCE OF TRUTH as-built (bukan lagi rencana), sejajar dokumen modul lain. **Dieksekusi**: Step 1 (`lib/quota/adapters/` — object literal registry per tipe, 3 titik orkestrasi direfactor pakai adapter), Step 2 (`HajiProduct.pendingQuota` + `hajiAdapter`), Step 3 (`lib/booking/cancel.ts` — `cancelBooking()` satu fungsi self-cancel DAN cron, **menutup Gap #2 & #3** `docs/arsitektur-umroh.md` §7), Step 4 (`docs/arsitektur-dokumen.md` + `docs/arsitektur-manifest.md` — lihat entri masing-masing di atas), Step 5 (`lib/validators/booking.ts` diredesain jadi `items: z.array(bookingItemSchema)` discriminated union 6 tipe termasuk `haji`, `app/api/v1/bookings/route.ts` dispatch loop generik + `totalAmount` **100% server-computed** — **menutup Gap #4 KRITIS**), Step 6 (checkout pendek Visa-only + Transport-only, `bookings/checkout/{visa,transport}/page.tsx` + form component masing-masing, CTA katalog Visa/Transport diarahkan ke checkout baru bukan `/register` lagi), Step 7 (invoice PDF profesional — `lib/pdf/invoiceData.ts` normalisasi 7 tipe line item + `lib/pdf/invoice.tsx` implementasi `@react-pdf/renderer` menggantikan stub + `app/api/v1/bookings/[id]/invoice/route.ts` mengembalikan `application/pdf` + tombol "Unduh Invoice" di halaman pilgrim & admin), **Step 8** (dokumentasi akhir — `docs/arsitektur-umroh.md` §7 Gap #1 diupdate akurat, status banner dokumen ini diubah dari "SEBAGIAN DIEKSEKUSI" jadi "SELESAI & TERVERIFIKASI"). **Keputusan Step 6a men-supersede deviasi Step 5**: `visaProductId` per pilgrim sekarang OPSIONAL (bukan wajib lagi) — user eksplisit: *"tidak ada satupun product mewajibkan product lain ketika checkout .. standard onlineshop"*. Field manifest "core" (`lib/manifest/constants.ts`) dipakai pilgrim tanpa visa. **Haji dikeluarkan total dari Step 6** (kata user: *"visa haji dengan visa yang tersedia berbeda sama sekali .. catat saja bahwa itu kesalahan .. kita blm sentuh haji"*) — API/skema SUDAH menerima `itemType='haji'` sejak Step 5, tapi TIDAK ADA UI/wizard yang mengirimnya — lihat bug list di bawah. **Step 7 punya insiden non-trivial**: `@react-pdf/renderer` v3.4.4 (versi lama) tidak kompatibel React 19 (project ini) — crash total saat render, di-upgrade ke v4.5.1. Invoice visa diambil dari `pilgrims[].visaApplication`, BUKAN relasi `booking.visa`/`BookingVisa` (model itu dead code, tidak pernah dipakai kode manapun). Lihat §7/§7.1/§7.2/§7.3 dokumen itu untuk bukti verifikasi lengkap.

`docs/arsitektur-paket-umroh.md` — **SELESAI & TERVERIFIKASI (2026-07-22)**: `Package`/`PackageItem` (sebelumnya kartu marketing statis, `PackageItem` tidak pernah dipakai kode manapun — Gap #5 lama di `docs/arsitektur-ziarah.md` §6) dirombak mengikuti pola Variable Harga 3-Mode §12 yang sama dengan `TourPackage`, diperluas dari 2 komponen jadi 7: Hotel Makkah, Hotel Madinah (2 slot terpisah — beda dari Ziarah yang cuma 1 hotel), Transport, Muthowif (singleton, tanpa daftar opsi), Visa, Tiket Pesawat, Katering — plus Komponen Biaya custom. User eksplisit membatasi scope ke sisi PRODUCT saja ("abaikan dulu booking engine, kita akan refactoring total juga itu") — `BookingPackage`/wizard/reservasi kuota SENGAJA tidak disentuh, menyusul saat `docs/arsitektur-booking.md` (booking engine universal, masih rencana pending) dieksekusi.

`docs/arsitektur-ziarah.md` §8-§9 — **SELESAI & TERVERIFIKASI (2026-07-21)**: modul Ziarah di-refactor total dari `HeritageTour` (produk flat, terpisah dari `TransportTrip` kategori `city_tour` yang sudah ada dan struktural identik) jadi `TourismSite` (master data situs, reusable) + `TourPackage` (referensi `TransportTrip` yang sudah ada — reuse penuh kendaraan/harga/kuota, tidak ada data/kuota kendaraan baru) + `TourPackageSite` (many-to-many berurutan) + `BookingTourPackage`. **Pola harga BEDA dari 5 modul lain**: margin dihitung PER KOMPONEN lalu dijumlah (fungsi baru `computeTourPackagePrice()`), bukan sum-HPP-lalu-satu-margin (`computeSellPrice()`) — deviasi sengaja, didokumentasikan §8.3. §6 Gap #1 (harga tur client-trusted), Gap #2 (tidak ada kuota), Gap #3 (admin create-only), Gap #7 (belum terintegrasi harga universal) semua **DITUTUP**. Gap #5 (`Package`/`PackageItem` generik non-fungsional) **TIDAK diperbaiki, sengaja di luar scope** — beda topik dari redesain `TourPackage` ini. Lihat `docs/decisions.md` 2026-07-21 untuk bukti verifikasi (browser end-to-end: admin susun paket+breakdown → booking → kuota `TransportQuota` konsisten dengan Transport biasa).

`docs/arsitektur-ziarah.md` §10 — **SELESAI & TERVERIFIKASI (2026-07-21)**: "Hotel" ditambahkan sebagai salah satu pilihan komponen add-on opsional di Paket Ziarah (model baru `TourPackageHotel`) — referensi `HotelRoomSchedule` untuk kemudahan input harga, sejajar komponen custom manual (Guide/Makan/Minum) yang sudah ada, semua tetap bisa ditambah/dikurangi bebas (tidak ada yang wajib). Harga awal **pass-through** (nights × numRooms × `HotelRoomSchedule.price`, TIDAK dimargin lagi — sama alasan kendaraan pass-through §8.3), tapi §10.10 mengoreksi ini jadi **editable**: `pricePerNight` di-snapshot server-side saat baris dibuat, lalu admin bisa edit lagi kapan saja (nilai tersimpan di paket, tidak terikat live ke modul Hotel) — prinsip "harga referensi dari modul lain, bukan angka statis" ini berlaku umum, bukan cuma hotel. **Keputusan sadar**: TIDAK reserve kuota hotel nyata (`reserveHotelQuota()` dkk sudah ada tapi sengaja tidak dipanggil) karena hotel dipilih di level TEMPLATE paket (statis), bukan booking-time seperti kendaraan — didokumentasikan sebagai gap yang diketahui sejak desain, bukan ditemukan belakangan. Editor "Komponen Biaya" juga direstyle total (panel teal, ikon+doc-caption, kotak "Vendor & Mata Uang", live preview HPP/Harga Jual) supaya konsisten dengan pola HPP editor Flight/Muthowif/Visa/Transport/Hotel — sebelumnya tampilan menyimpang sendiri.

`docs/arsitektur-ziarah.md` §11 — **DISEMPURNAKAN OLEH §12** (diarsipkan sebagai riwayat, jangan dipakai acuan implementasi baru). Menyelesaikan Kendaraan (Transport) di Paket Ziarah jadi opsional (nullable), tapi baru satu dimensi — belum membedakan "kendaraan final" vs "kendaraan opsi", lihat §12.

`docs/arsitektur-ziarah.md` §12 — **SELESAI & TERVERIFIKASI (2026-07-21)**: model "variable harga" Transport & Hotel dirombak jadi **3 mode eksplisit** (menggantikan §11): `included` (admin kunci 1 pilihan spesifik, harga dibakukan MASUK harga jual paket, pilgrim tidak pilih apa pun), `user_choice` (admin cuma hubungkan sumber pilihan, pilgrim pilih & bayar sendiri saat booking, harga TIDAK masuk harga jual paket dasar — ditampilkan terpisah), `none` (tidak dipakai/isi manual). User menunjukkan bug konsep: implementasi sebelumnya SELALU membakukan kendaraan termurah ke harga publish begitu trip terhubung — membingungkan kalau pilgrim tidak butuh/kendaraan over price. Skema baru: enum `PriceVariableMode`, `TourPackage.transportMode`+`includedTransportPricingId`+`includedTransportPrice` (snapshot/editable, pola sama Hotel §10.10), `hotelMode`, model baru `TourPackageHotelOption`. **Booking lifecycle beda per mode**: `included` kendaraan tetap reservasi `TransportQuota` nyata (auto-resolve dari tanggal keberangkatan — cegah overbooking meski pilgrim tak memilih); `user_choice` HOTEL sekarang JUGA reservasi kuota nyata (beda dari hotel `included` §10.7 yang sengaja statis di template). Paket existing di-migrasi ke `user_choice` (dikonfirmasi user) — harga "Mulai dari" katalog turun dari Rp1.350.000 ke Rp250.000 (disengaja, bukan bug). Lihat `docs/decisions.md` 2026-07-21 untuk bukti verifikasi lengkap.

`docs/arsitektur-hotel.md` §10-§11 — **SELESAI & TERVERIFIKASI (2026-07-19)**: modul Hotel di-refactor total ke arsitektur harga universal (`RoomType`+`HotelPricePeriod`+`HotelRoomSchedule` menggantikan `HotelRoom`+`HotelQuota`, terintegrasi penuh `Vendor`/`ProductCost`/`computeSellPrice()`, periode jadi entitas terpisah supaya admin bisa isi banyak tipe kamar sekaligus per periode + tabel rate sheet di halaman publik). §8 Gap #1 (KRITIS, harga booking client-trusted) dan Gap #2 (mass-assignment) dari audit lama **DITUTUP** sebagai bagian dari refactor ini — lihat `docs/decisions.md` 2026-07-19 untuk bukti verifikasi. §8 Gap #3 (fitur "Layanan Hotel"/`HotelService` tidak punya jalur admin) **DITUTUP 2026-07-20** — CRUD admin lengkap ditambahkan, lihat `docs/decisions.md`.

`docs/arsitektur-transportasi.md` §9 — **SELESAI & TERVERIFIKASI (2026-07-20)**: modul Transport di-refactor ke arsitektur harga universal — harga per kombinasi rute×kendaraan (meniru Tiket Pesawat), `TransportTrip.origin`/`destination` jadi wajib, kolom musiman + charter/per-kursi di `TransportPricing` dihapus jadi satu `price` flat (cache `computeSellPrice()`), terintegrasi penuh `Vendor`/`ProductCost`/`PreferredVendor`. §7 Gap #1 (pickupDetail/dropoffDetail kosong di wizard), Gap #4 (KRITIS, harga booking client-trusted), dan Gap #5 (error handling `catch{...403}` polos) semua **DITUTUP** — lihat `docs/decisions.md` untuk bukti verifikasi (browser end-to-end + script test manipulasi harga).

`docs/arsitektur-tiket-pesawat.md` — **SELESAI & TERVERIFIKASI (2026-07-19)**: modul Tiket Pesawat (schema, integrasi `docs/arsitektur-harga.md`, admin UI, katalog publik, kuota infrastruktur) sudah dieksekusi 6 fase penuh dan diverifikasi (`bun run build` 0 error tiap fase + browser/script langsung). Integrasi ke wizard booking tetap di luar scope (lihat §2.1 dokumen itu) — `docs/spec.md` "Flight booking — No, Phase 2" masih berlaku untuk BOOKING penuh, bukan untuk pencatatan/kuota/harga.

`docs/arsitektur-muthowif.md` §9 — **SELESAI & TERVERIFIKASI (2026-07-20)**: modul Muthowif dirombak dari model marketplace (jamaah pilih nama saat booking) jadi booking generik + assignment admin (Saudinesia yang menentukan siapa bertugas, sesuai positioning "curated operator") — konsisten dengan pola perombakan model bisnis yang sama seperti redesain UI Transport, tapi ini perubahan arsitektur data/lifecycle, bukan cuma UI. Kapasitas jadi 2 lapis: pool (gabungan semua muthowif aktif, dicek saat booking dibuat) + individual (dicek saat admin assign, `lib/muthowif/assign.ts`). §7 Gap #1 (KRITIS, `confirmMuthowifQuota()` tidak ada), Gap #2 (foto profil, field direname `photoUrl`→`photoKey`), dan Gap #7 (pesan error kapasitas kini sebut tanggal spesifik) **DITUTUP** — lihat `docs/decisions.md` untuk bukti verifikasi. Gap #3/#5 **masih terbuka**, sengaja di luar scope (tidak diminta).

`docs/arsitektur-muthowif.md` §10 — **SELESAI & TERVERIFIKASI (2026-07-20)**: harga layanan muthowif (`MuthowifServicePrice`) diintegrasikan ke arsitektur harga universal — modul ke-5 (setelah Visa, Flight, Hotel, Transport) yang pakai `computeSellPrice()`/`ProductCost`/`PreferredVendor`. Struktur 3-season (`priceRegular`/`priceRamadan`/`priceHajj`) dihapus jadi satu `price` flat (cache, komponen HPP tunggal `"layanan"`, pola sama Flight — tidak day-based). **Beda dari 4 modul lain: Muthowif tidak punya vendor pihak ketiga sungguhan** (personal/internal — Saudinesia menetapkan sendiri harga pasaran) — dipakai satu vendor tetap "Saudinesia" (kategori `internal`, dibuat otomatis server-side), form admin tidak punya dropdown/quick-add vendor, cuma read-only. Lihat `docs/decisions.md` untuk bukti verifikasi.

**Prinsip proses wajib (ditambahkan 2026-07-20):** sebelum merencanakan upgrade modul apa pun, selalu recheck `docs/arsitektur-<modul>.md` vs kode aktual dulu — lihat "Fase Eksekusi SOP" poin 1 di bawah. Jangan percaya status "SELESAI & TERVERIFIKASI" begitu saja tanpa verifikasi ulang.

`docs/arsitektur-harga.md` — rancangan HPP/kurs/margin universal (tidak ada infrastruktur ini sama sekali di kode saat ini). Scope tahap awal: Visa saja, tapi skema (`ProductCost` polimorfik, mirip pola `PackageItem`) dirancang untuk diperluas ke modul lain nanti. Ada 1 keputusan bisnis belum final: sumber API kurs (lihat §4 — Bank Indonesia JISDOR vs API komersial gratis).

**Perhatian — bug produksi kritis ditemukan lewat audit, wajib diperbaiki sebelum deployment (M15):**
- ~~`docs/arsitektur-muthowif.md` §7 Gap #1 / `docs/arsitektur-umroh.md` §5: `confirmMuthowifQuota()` tidak ada~~ — **DITUTUP 2026-07-20**, lihat `docs/arsitektur-muthowif.md` §9.
- ~~`docs/arsitektur-umroh.md` §7 Gap #1: Haji tidak bisa dibooking sama sekali~~ — **DITUTUP di sisi API/skema 2026-07-25** (`itemType='haji'` di `createBookingSchema`, `bookingHaji.create()` + reserve/confirm/release lewat `hajiAdapter`, diverifikasi end-to-end via curl), tapi **belum ada UI/wizard yang mengirimnya** — checkout pendek Haji SENGAJA DIKELUARKAN dari `docs/arsitektur-booking.md` §6 Step 6 (dieksekusi 2026-07-25 untuk Visa-only/Transport-only saja), jadi pilgrim asli masih belum bisa booking Haji lewat browser.
- **Bug baru dicatat (2026-07-25, BELUM diperbaiki, di luar scope Step 6 sengaja)**: kalau Haji booking suatu saat dibangun dan mengikuti pola `pilgrims[].visaProductId` yang sama seperti Visa/Transport, itu SALAH — kata user: *"visa haji dengan visa yang tersedia berbeda sama sekali"*. Haji butuh konsep visa tersendiri ("Visa Haji"), bukan `VisaProduct` biasa yang dipakai Umroh. Jangan asumsikan pola manifest/visa existing otomatis berlaku untuk Haji saat modul itu akhirnya dikerjakan.
- ~~`docs/arsitektur-umroh.md` §7 Gap #2: self-cancel jamaah tidak pernah melepas kuota hotel/transport/muthowif~~ — **DITUTUP 2026-07-24**, lihat `docs/arsitektur-booking.md` §7.
- ~~`docs/arsitektur-umroh.md` §7 Gap #3: tidak ada record `Refund` yang pernah dibuat di kode~~ — **DITUTUP 2026-07-24**, lihat `docs/arsitektur-booking.md` §7.
- ~~`docs/arsitektur-umroh.md` §7 Gap #4: `totalAmount` dipercaya dari klien tanpa validasi ulang server~~ — **DITUTUP 2026-07-25**, lihat `docs/arsitektur-booking.md` §7.1.

Saat membuat dokumen baru untuk modul lain, ikuti struktur `docs/arsitektur-visa.md` sebagai template.

**Audit retrofit (2026-09-10):** lihat `docs/RETROFIT-GAPS.md` untuk daftar gap infra/operasional yang ditemukan lewat audit langsung ke kode (backup, observability, kepatuhan UU PDP, SEO/sitemap, staging, dst.) — belum ada yang dieksekusi, murni laporan untuk dipilih user.

---

## Tech Stack — Non-negotiable

| Layer | Choice |
|-------|--------|
| Runtime | Bun |
| Framework | Next.js 15 App Router |
| Language | TypeScript strict mode |
| Database | PostgreSQL — self-hosted, Hostinger VPS |
| ORM | Prisma |
| Styling | Tailwind CSS — utility-first only |
| Icons | Lucide React — no emojis anywhere in UI |
| Rich text | Tiptap |
| Auth | WhatsApp OTP via GOWA (aldinokemal, hosted on Sumopod) — no NextAuth |
| Storage | MinIO — self-hosted, Hostinger VPS |
| Images | `next/image` with custom MinIO loader |
| Package manager | Bun — `bun add`, `bun run` — never npm or yarn |
| API | REST, Next.js Route Handlers, versioned at `/api/v1/` |
| Deployment | Single Docker container, Hostinger VPS |

**Never suggest alternatives to any of the above.**

---

## Folder Structure

```
prisma/schema.prisma          # single source of truth for DB schema
app/[locale]/
  (public)/                   # catalog: hotels, transport, muthowif, haji, visa, packages
  (auth)/                     # login, register, forgot-password
  (pilgrim)/
    dashboard/
    bookings/checkout/        # checkout pendek per-produk (visa/, transport/) — wizard 7-langkah lama DIHAPUS 2026-07-25
    groups/
  admin/                      # UNIFIED admin dashboard — role-based sidebar
    bookings/                 # [admin|manager|superadmin]
    payments/                 # [admin|manager|superadmin]
    visa/                     # [admin|manager|superadmin]
    quotas/                   # [admin|manager|superadmin]
    notifications/            # [admin|manager|superadmin]
    products/                 # [manager|superadmin only]
      hotels/ transport/ muthowif/ catering/ tours/ seasons/
      haji/ visa/ packages/
    system/                   # [superadmin only]
      users/ settings/
    login/                    # public — all admin roles login here
  api/v1/                     # all Route Handlers
components/
  ui/                         # shadcn/ui primitives
  booking/                    # WizardShell, HotelPicker, DocumentUploader, PriceSidebar…
  admin/
  shared/                     # layout, header, locale switcher
lib/
  auth/                       # JWT session (httpOnly cookie), OTP helpers
  whatsapp/client.ts          # GOWA HTTP client — only place that calls GOWA
  storage/minio.ts            # MinIO client, upload, presigned URL — only place that calls MinIO
  notifications/              # dispatch, WA templates, email templates
  quota/                      # check / reserve / release (always inside Prisma transaction)
  cron/                       # auto-cancel, payment reminder jobs
  pdf/                        # invoice generation
  utils/                      # season detect, cancellation policy, booking codes
  validators/                 # all Zod schemas for API input/output
middleware.ts                 # auth + role guard
```

---

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true` — no exceptions
- Never use `any`; use `unknown` + narrowing, or define a proper type
- All API request/response shapes defined as Zod schemas in `lib/validators/`
- Infer TS types from Zod: `type X = z.infer<typeof XSchema>` — do not duplicate
- Prisma-generated types are the source of truth for DB models; never re-declare them

---

## CSS & Styling

- Tailwind utility classes only — no inline `style={{}}`, no CSS Modules
- Repeated class combos → extract to `@layer components` in `globals.css`
- No arbitrary values (`w-[743px]`) unless no Tailwind scale equivalent exists
- No magic numbers, no hardcoded hex colors — use the Tailwind config palette
- No emojis — use Lucide React icons for all visual indicators

---

## Component Conventions

- Default to Server Components; add `"use client"` only for interactivity or browser APIs
- Max 2 levels of prop drilling — beyond that, use React Context or Zustand
- Co-locate a component's custom hook in the same directory as the component
- One component per file; filename = component name in PascalCase
- Use shadcn/ui primitives as the base; extend via `className` props only
- Never import from `admin/` inside `(pilgrim)/` routes or vice versa

---

## API Conventions

- All routes under `/api/v1/`
- Every response shape: `{ success: boolean, data?: T, error?: string, meta?: Record<string, unknown> }`
- HTTP status codes: 200 OK · 201 Created · 400 Bad Request · 401 Unauthorized · 403 Forbidden · 404 Not Found · 409 Conflict (quota race) · 422 Unprocessable · 500 Internal
- Validate every input with a Zod schema before any DB call; return 400 with field-level errors on failure
- Call `lib/auth/session.ts` at the top of every protected Route Handler — middleware is not sufficient alone
- Never return Prisma errors, stack traces, or internal model names to the client

---

## Tiptap

- Active extensions: `StarterKit`, `Link`, `Image`, `Placeholder` — add others only when spec explicitly requires
- Always serialize to **JSON** (`editor.getJSON()`) — never HTML — and store JSON in DB
- To render saved content server-side: `generateHTML(json, extensions)`; client-side: `<EditorContent editor={editor} />`
- Tiptap editor instances live in Client Components only — never instantiate in a Server Component

---

## MinIO

- Single bucket: `saudinesia-docs` (private — never set to public)
- Object key format: `{entity}/{entity_id}/{doc_type}/{unix_ms}-{sanitized_filename}`
  - e.g. `pilgrims/uuid/passport/1746000000000-scan.pdf`
- Store object **keys** in DB, never full URLs — generate presigned URLs at read time
- Presigned URL TTL: 15 min for single-file preview, 60 min for ZIP downloads
- Server-side upload validation: MIME whitelist (`image/jpeg`, `image/png`, `application/pdf`), max 5 MB
- All MinIO SDK calls go through `lib/storage/minio.ts` — no raw SDK usage elsewhere

---

## Prisma

- Schema at `prisma/schema.prisma` — single source of truth; DB schema in `docs/architecture.md` is the design reference
- Model names: PascalCase singular (`BookingPilgrim`, `HotelQuota`)
- Field names: camelCase
- Every migration named descriptively: `bun prisma migrate dev --name add_passport_expiry`
- Never use `prisma db push` in production — migrations only
- Quota writes always inside `prisma.$transaction([...])` to prevent race conditions
- `$queryRaw` only when Prisma ORM genuinely cannot express the query; add a comment explaining why

---

## WhatsApp Gateway (GOWA)

- GOWA base URL from `process.env.WA_GATEWAY_URL` (Sumopod-hosted external service)
- All GOWA calls go through `lib/whatsapp/client.ts` — no direct `fetch` to GOWA anywhere else
- Message templates in `lib/notifications/templates/whatsapp.ts`, keyed by notification type and locale
- Retry: 2 attempts, 2 s delay on network error — log failure to `notification_logs`, then continue
- GOWA is best-effort: a WA failure must **never** block a booking confirmation or status update
- OTP rate limit: max 3 requests per phone number per 10 minutes, enforced via Redis counter in `lib/auth/otp.ts`

---

## Performance

- Fetch data in `async` Server Components or with React `cache()` — never `useEffect` for initial data
- Lazy-load heavy Client Components with `next/dynamic` + skeleton fallback
- All images via `next/image` with the custom MinIO loader; always set `width`/`height` or `fill`
- All admin list views must be paginated — never load unbounded result sets
- `useMemo` / `useCallback` only for measurably expensive operations — do not over-memoize

---

## Security

- Secrets in env vars only — never hardcode or commit to git
- Validate file MIME type and size **server-side** on every upload, regardless of client checks
- MinIO bucket stays private; document access via presigned URLs only
- Session JWT stored in `httpOnly; Secure; SameSite=Strict` cookie
- Enforce role check inside every admin/superadmin Route Handler — do not rely on middleware alone
- Never log pilgrim PII (passport numbers, DOB, KTP) to application logs

---

## Git

- Commits: Conventional Commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`
- One logical change per commit — do not mix feature work with refactors
- Link PRs to a `docs/decisions.md` entry for any architectural choice

---

## Fase Eksekusi SOP (wajib diikuti untuk setiap implementasi multi-fase)

Berlaku untuk implementasi apa pun yang dipecah jadi beberapa fase/step (mis. mengeksekusi rencana di `docs/arsitektur-*.md`) — granularitas lebih kecil dari Milestone SOP di bawah, dipakai *di dalam* satu milestone.

**0. Selalu baca `CLAUDE.md` di awal dan tetap fokus pada task yang sedang dikerjakan** — jangan melebar ke perbaikan/fitur lain yang tidak diminta di fase berjalan, meski terlihat terkait.

**1. Recheck dulu — pastikan `docs/arsitektur-<modul>.md` yang ada BENAR-BENAR sama dengan kode aktual, sebelum dipakai sebagai dasar rencana upgrade apa pun.** Jangan percaya begitu saja isi dokumen lama (termasuk yang statusnya "SOURCE OF TRUTH" atau "SELESAI & TERVERIFIKASI") — dokumen bisa basi kalau ada perubahan kode yang tidak tercatat, atau audit sebelumnya salah/kurang lengkap. Baca ulang skema Prisma aktual, API routes, dan komponen kunci yang relevan, bandingkan baris per baris dengan yang tertulis di dokumen. Kalau ada gap/drift, catat dulu dan laporkan ke user sebelum lanjut — jangan lanjut merancang upgrade di atas dokumen yang belum dikonfirmasi akurat. Ini bukan langkah opsional yang boleh dilewati kalau dokumennya "kelihatan baru" — selalu verifikasi ulang, setiap kali, sebelum masuk ke poin 2.

**2. Baru buat perencanaan arsitektur, sebelum eksekusi kode apa pun.** Kalau rencananya belum ada dokumennya (`docs/arsitektur-*.md`), tulis dulu — jangan mulai coding dari rencana yang cuma ada di kepala/chat.

**3. Eksekusi satu fase pada satu waktu** — sesuai urutan yang sudah ditulis di rencana (mis. "Step 1", "Step 2" di `docs/arsitektur-harga.md` §9). Jangan lompat atau gabung beberapa fase sekaligus.

**4. Begitu satu fase selesai, cek error type dulu** — `bun run build`, harus **zero error** sebelum lanjut.

**5. Kalau 0 error, dokumentasikan hasil fase itu** — update `docs/progress.md` (centang item yang selesai), `docs/decisions.md` kalau ada keputusan baru yang diambil saat implementasi (bukan cuma yang direncanakan di awal), dan update dokumen arsitektur terkait kalau strukturnya berubah dari rencana.

**6. Baru lanjut ke fase berikutnya — ulangi dari nomor 3, sampai semua fase selesai.**

**Tidak boleh lompat ke fase berikutnya kalau build masih merah, tidak boleh eksekusi fase yang belum ada di rencana tertulis, dan tidak boleh mulai merencanakan upgrade (poin 2) sebelum poin 1 (recheck doc vs kode) selesai dan dikonfirmasi akurat.**

---

## Milestone SOP (wajib diikuti setiap selesai milestone)

1. **`bun run build`** — pastikan zero type errors sebelum lanjut. Fix semua error dulu.
2. **Update `docs/progress.md`** — centang semua item yang selesai, catat yang masih pending.
3. **Append `docs/decisions.md`** — jika ada keputusan arsitektur baru selama implementasi.
4. **Baru lanjut ke milestone berikutnya.**

Tidak boleh masuk fase berikutnya jika build masih merah.

---

## Learning & Decisions

- If a better pattern is discovered during development, update the relevant section in this file **and** append an entry to `docs/decisions.md`
- `docs/decisions.md` entry format:
  ```
  ## YYYY-MM-DD — <title>
  **Decision:** what was decided
  **Rationale:** why
  **Alternatives considered:** what else was evaluated
  ```
- Never silently deviate from a logged decision — add a superseding entry instead
