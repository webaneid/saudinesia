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

Status per 2026-07-25: `docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`, `docs/arsitektur-umroh.md` (booking core), `docs/arsitektur-tiket-pesawat.md`, `docs/arsitektur-hotel.md`, `docs/arsitektur-ziarah.md` (Situs Wisata + Paket Ziarah), `docs/arsitektur-paket-umroh.md` (`Package`/Paket Umroh), `docs/arsitektur-booking.md` (booking engine universal — SELESAI & TERVERIFIKASI penuh 8 step, kecuali checkout Haji sengaja di luar scope), `docs/arsitektur-dokumen.md`, `docs/arsitektur-manifest.md`, `docs/arsitektur-alamat.md`, `docs/arsitektur-komponen-kontak.md`, `docs/arsitektur-komponen-biaya.md`, `docs/arsitektur-haji.md`, dan `docs/arsitektur-vendor.md` sudah dibuat. Modul lain (Katering sebagai modul mandiri, Group Booking) belum punya dokumen terpisah — masih merujuk `docs/architecture.md`/`docs/spec.md`.

`docs/arsitektur-alamat.md` — **SELESAI & TERVERIFIKASI (2026-07-23), termasuk wiring**: komponen universal ke-4 (sejajar harga/dokumen/manifest) — cascading Provinsi→Kab/Kota→Kecamatan→Desa/Kelurahan dari data resmi Kemendagri ([cahyadsn/wilayah](https://github.com/cahyadsn/wilayah), MIT, 38 provinsi/514 kab-kota/7.285 kecamatan/83.762 desa-kelurahan, dikonfirmasi persis cocok sumber). Model `Address` (bukan tabel pivot — FK `addressId` biasa) mendukung 2 mode: domestik (4 tabel wilayah) dan internasional (negara dari daftar statis ISO 3166-1, bukan tabel DB). Komponen frontend reusable `AddressPicker` (`components/shared/`) — combobox berjenjang, dipakai token shadcn standar supaya cocok di admin maupun pilgrim. Sudah diwire ke `User` (profil), `Vendor` (settings, sekaligus naik jadi create+edit penuh), `Hotel` (§9) — nested lewat `upsertAddress()`, atomik dalam satu request. `BookingPilgrim`/Manifest (`docs/arsitektur-manifest.md`, sudah dieksekusi 2026-07-24) TIDAK memakai `fieldType='address'` — belum ada field alamat di seed manifest visa hari ini, tetap kandidat masa depan kalau dibutuhkan.

`docs/arsitektur-media.md` — **SELESAI & TERVERIFIKASI as-built (2026-10-27, F1–F4)**: foto produk = SATU tabel polimorfik `ProductImage`, satu layanan penulis (`lib/media/service.ts`), satu registry (`lib/media/owners.ts`: mode `featured` = satu foto unggulan, `gallery` = banyak + satu sampul; Hotel/Paket Ziarah/Kendaraan galeri, sisanya unggulan), satu komponen admin (`MediaField` di halaman edit) dan satu komponen tampilan (`ProductImage` + `getFeaturedCards/getProductImages`). Unggahan divalidasi dari ISI berkas dan dienkode ulang ke webp (tampilan ≤1600, kartu ≤640, EXIF dibuang). **Jangan menambah kolom foto per-model atau route unggah baru**: produk bergambar baru = satu entri registry + `MediaField` + `ProductImage`; setiap penghapusan sungguhan produk bergambar WAJIB memanggil `purgeProductMedia` (dijaga `scripts/test-media.ts`).

`docs/arsitektur-vendor.md` — **SELESAI & TERVERIFIKASI as-built (2026-10-26, F1–F5, ADR-0003)**: vendor = SATU entitas (`Vendor`, kategori terkelola admin many-to-many, kontak terstruktur + alamat, `systemKey` untuk vendor sistem Saudinesia, keunikan `(nameKey, countryCode)`), satu menu **Sistem → Vendor**, satu `VendorForm`, satu `VendorPicker` (konteks `flight|hotel|transport|visa|muthowif|costComponent`), satu penulis (`lib/vendors/service.ts`), integritas rujukan di DB (FK Restrict) dan di route (`assertVendorUsable`: ada DAN aktif), hapus aman (hapus bila tak dirujuk, selain itu nonaktif). Kolom teks lama `category`/`country`/`contactInfo` sudah dibuang (migrasi kontraksi). Menggantikan `docs/arsitektur-harga.md` §3.1/§18. Menambah modul yang menyimpan `vendorId` = pakai `VendorPicker` + panggil `assertVendorUsable` di route-nya.

`docs/arsitektur-komponen-biaya.md` — **SELESAI & TERVERIFIKASI (2026-10-26, 5 fase)**: komponen universal ke-6 — "Komponen Biaya" (biaya bebas bernama: vendor + mata uang + nominal → HPP via kurs → margin tipe produk → pembulatan, **per komponen** lalu dijumlah). Satu implementasi dipakai Paket Umroh (`package`), Paket Ziarah (`tour_package`), dan Haji (`haji`): `lib/pricing/costComponents.ts` (hitung), `costComponentOwners.ts` (registry pemilik: `productType`/`exists`/`refresh`), `costComponentHandlers.ts` (handler CRUD + simulate, superadmin-only, dicakup ke produk dan modul), route modul = 6 baris re-export, UI `components/admin/pricing/CostComponentsPanel.tsx` + `VendorCurrencyField.tsx`. **Menambah pemilik baru = satu entri registry + tiga route tipis + fungsi refresh/cron + panel di halaman edit** (langkah rinci di §9.5 dokumen itu). Proses: ekuivalensi perilaku lama dibuktikan rekam-bandingkan (respons route, harga tersimpan, hasil hitung yang dipakai harga booking; HTML/teks halaman di Chrome sungguhan), bukan sekadar build hijau. Menutup SEC-63..67. Hotel/Pesawat/Transport/Visa/Muthowif TIDAK memakainya (editor tier/jadwal, model data berbeda).

`docs/arsitektur-haji.md` — **SELESAI & TERVERIFIKASI as-built (2026-10-26)**: `HajiProduct.price` adalah **cache** hasil Komponen Biaya (skema menolak `price`; produk baru berharga 0); **CRUD lengkap** di API dan UI (`products/haji/[id]`): hapus sungguhan hanya bila belum pernah dipesan (beserta baris polimorfik miliknya), selain itu nonaktif; aktifkan kembali lewat saklar. Booking Haji aman di API (harga server, produk nonaktif/berharga ≤ 0 → 422, kuota ditahan atomik). **Masih BELUM ada** (disengaja, §7 dokumen itu): checkout Haji di browser, "Visa Haji" sebagai konsep tersendiri (JANGAN pakai `visaProductId` umroh untuk Haji), dokumen/manifest Haji, galeri gambar, halaman detail publik.

`docs/arsitektur-hapus-akun.md` — **SELESAI & TERVERIFIKASI (2026-10-22, SEC-44)**: penghapusan akun UU PDP = anonimisasi dalam satu transaksi terkunci (`lib/account/deletion.ts`); Booking/Payment/Refund/ConsentLog dipertahankan, data pribadi + objek MinIO dihapus; masa tunggu 72 jam, pratinjau + konfirmasi email, penarikan oleh pemilik. Menambah kolom/tabel yang menyimpan `userId` atau PII WAJIB menambah perlakuannya di sana (pemindai di `scripts/test-deletion.ts` akan merah). Aturan retensi menunggu peninjauan hukum.

`docs/arsitektur-komponen-kontak.md` — **SELESAI & TERVERIFIKASI (2026-07-23)**: komponen universal ke-5 — blok "Data Kontak" reusable (kode negara autocomplete default Indonesia, dial code dari `COUNTRIES` yang diperluas + Nomor HP + Nomor WhatsApp dengan checkbox "Sama dengan nomor HP" yang menyamakan kode negara juga + Email prefill dari akun). Komponen frontend `ContactPicker` (`components/shared/`), diwire ke `BookingPilgrim` (+3 kolom `phoneCountryCode`/`whatsapp`/`whatsappCountryCode`) lewat wizard `bookings/new/pilgrims` — jamaah #1 (Pemesan) di-prefill dari akun. **Pembaruan 2026-10-22:** OTP sudah dihapus (ADR-0001) — `User.phone`/`User.whatsapp` kini kontak akun (E.164; WhatsApp diverifikasi lewat pesan masuk, ADR-0002) dan memakai komponen ini di daftar/"Lengkapi Data"/profil; `Vendor.contactInfo` tetap tidak disentuh. 2 bug ditemukan & ditutup saat verifikasi browser+end-to-end (checkbox tidak bisa dilepas-centang; `payment/page.tsx` tidak meneruskan field baru ke payload) — lihat §10 dokumen itu.

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
- ~~`docs/arsitektur-umroh.md` §7 Gap #1: Haji tidak bisa dibooking sama sekali~~ — **DITUTUP di sisi API/skema 2026-07-25; diperketat 2026-10-26 (SEC-66: produk nonaktif/berharga 0 ditolak 422)** (`itemType='haji'` di `createBookingSchema`, `bookingHaji.create()` + reserve/confirm/release lewat `hajiAdapter`, diverifikasi end-to-end via curl), tapi **belum ada UI/wizard yang mengirimnya** — checkout pendek Haji SENGAJA DIKELUARKAN dari `docs/arsitektur-booking.md` §6 Step 6 (dieksekusi 2026-07-25 untuk Visa-only/Transport-only saja), jadi pilgrim asli masih belum bisa booking Haji lewat browser.
- **Bug baru dicatat (2026-07-25, BELUM diperbaiki, di luar scope Step 6 sengaja)**: kalau Haji booking suatu saat dibangun dan mengikuti pola `pilgrims[].visaProductId` yang sama seperti Visa/Transport, itu SALAH — kata user: *"visa haji dengan visa yang tersedia berbeda sama sekali"*. Haji butuh konsep visa tersendiri ("Visa Haji"), bukan `VisaProduct` biasa yang dipakai Umroh. Jangan asumsikan pola manifest/visa existing otomatis berlaku untuk Haji saat modul itu akhirnya dikerjakan.
- ~~`docs/arsitektur-umroh.md` §7 Gap #2: self-cancel jamaah tidak pernah melepas kuota hotel/transport/muthowif~~ — **DITUTUP 2026-07-24**, lihat `docs/arsitektur-booking.md` §7.
- ~~`docs/arsitektur-umroh.md` §7 Gap #3: tidak ada record `Refund` yang pernah dibuat di kode~~ — **DITUTUP 2026-07-24**, lihat `docs/arsitektur-booking.md` §7.
- ~~`docs/arsitektur-umroh.md` §7 Gap #4: `totalAmount` dipercaya dari klien tanpa validasi ulang server~~ — **DITUTUP 2026-07-25**, lihat `docs/arsitektur-booking.md` §7.1.

Saat membuat dokumen baru untuk modul lain, ikuti struktur `docs/arsitektur-visa.md` sebagai template.

`docs/admin-dashboard-redesign.md` — **SELESAI & TERVERIFIKASI** (dieksekusi sebelum retrofit, status "Planning" di dokumen itu basi/dikoreksi 2026-09-10): admin dashboard unified (`/admin`, bukan `/admin`+`/superadmin` terpisah), role `manager` ditambahkan, sidebar role-based (`MANAGER_ROLES`/`SUPERADMIN_ROLES` di `lib/auth/session.ts` + `app/[locale]/admin/(protected)/layout.tsx`).

**Audit retrofit (2026-09-10):** lihat `docs/RETROFIT-GAPS.md` untuk daftar gap infra/operasional yang ditemukan lewat audit langsung ke kode (backup, observability, kepatuhan UU PDP, SEO/sitemap, staging, dst.) — belum ada yang dieksekusi, murni laporan untuk dipilih user.

**Tooling retrofit (2026-09-10):** project ini sekarang punya hooks enforcement (`.claude/hooks/`), skill `security-review`/`new-api-route`, subagent `security-auditor`, dan `docs/architecture/architecture-security.md` — semua diadaptasi dari template `master-typescript` ke stack asli project ini (Next.js Route Handler + Prisma, bukan Elysia/Drizzle). Detail lengkap di `.claude/hooks/README.md`. Skill `phase-workflow` template **sengaja tidak diadopsi** — isinya sudah redundan dengan § "Fase Eksekusi SOP"/"Milestone SOP" di bawah.

**ADR (Architecture Decision Record) — dua tingkat mulai 2026-09-10:**
- Keputusan implementasi rutin → tetap append ke `docs/decisions.md` seperti biasa (tidak berubah).
- Keputusan arsitektur BESAR/struktural ke depan → ADR baru di `docs/decisions/adr-XXXX-....md` (pakai `docs/decisions/adr-template.md`, nomor dari `bash scripts/next-adr-number.sh`) — **immutable setelah status `Accepted`**, di-enforce hard lewat `.claude/hooks/adr-guard.sh`. Belum ada migrasi retroaktif dari `docs/decisions.md` lama ke format ini.

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
| Auth | Email is the identity (ADR-0001, `docs/arsitektur-auth.md`): email + password (`bcryptjs`) with email-link verification (Resend), or Google OAuth (own PKCE implementation, Fase 2); password reset by email link; staff = password only. **No WhatsApp OTP anywhere in auth.** WhatsApp (GOWA) is a notification channel only — no NextAuth |
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
    pricing/                  # CostComponentsPanel + VendorCurrencyField — Komponen Biaya universal (Paket Umroh, Paket Ziarah, Haji)
  shared/                     # layout, header, locale switcher
lib/
  auth/                       # JWT session (httpOnly cookie), email tokens, accounts, rate limit
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

## Admin UI Kit

Detail dan alasan: `docs/admin-ui-kit.md`. Aturan praktis untuk setiap halaman admin:

- **CRUD lengkap selalu (arahan pemilik 2026-10-26: "kita ini manusia, bisa salah")**: setiap entitas admin harus bisa dibuat, dilihat, **diedit, dan dihapus** — di API *dan* UI, bukan sekadar daftar + buat. Hapus bersemantik aman: hapus sungguhan bila tak ada yang merujuk, selain itu nonaktif dengan pesan jelas + bisa diaktifkan kembali; selalu dengan konfirmasi. Contoh acuan: `docs/arsitektur-haji.md` §4-§5 (`lib/haji/delete.ts`). Saat menyentuh modul yang belum punya edit/hapus, catat sebagai gap
- **"Buat baru" = halaman khusus, bukan panel sebaris (`docs/arsitektur-admin-create.md`)**: entitas baru dibuat di `/admin/<area>/<modul>/new` dengan `components/admin/shell/CreatePage.tsx` (tombol "Tambah" di daftar = `<Link>`); sukses → halaman edit `[id]`; respons POST WAJIB diperiksa dan galat server ditampilkan (jangan menutup formulir saat gagal). Modul yang sudah termigrasi terdaftar di `scripts/test-admin-create.ts`
- **Vendor: satu pemilih, satu formulir (ADR-0003, `docs/arsitektur-vendor.md`)**: memilih vendor di editor mana pun WAJIB lewat `components/admin/vendor/VendorPicker.tsx` (`context` = `flight|hotel|transport|visa|muthowif|costComponent`; "Vendor Baru" = modal `VendorForm`, khusus superadmin); jangan membuat `<select>` vendor, formulir vendor, atau endpoint pembuatan vendor baru. Vendor dikelola di Sistem → Vendor; penulis tabel vendor hanya `lib/vendors/service.ts` (dijaga `scripts/test-vendor-{api,ui}.ts`). Editor yang menyimpan biaya wajib memeriksa respons dan menampilkan galat server
- Pakai komponen `components/admin/{shell,ui,data-table}/` (`PageHeader`, `Card`, `Badge`, `Button`, `FormField`, `DataTable`, `Pagination`) — jangan membuat tabel `<table>` mentah atau header halaman ad-hoc
- Warna hanya lewat token `admin-*` (`text-admin-muted`, `bg-admin-accent`, `border-admin-line`, …) — dilarang kelas palet mentah (`teal-`, `slate-`, `rose-`, hex) di folder admin; brand diubah di satu blok `--brand-*` di `app/globals.css`
- Form padat boleh memakai kelas komponen `admin-inp`, `admin-select`, `admin-btn-sm`, `admin-form-panel`, `admin-badge-*`
- **Halaman edit memakai tata letak editor ala WordPress** (`docs/arsitektur-admin-editor.md`): konten di kiri; kanan (lengket) Terbitkan (status + Simpan + penanda belum-disimpan) / Foto / atribut-ringkasan / Hapus. Formulir tunggal = `EditPage` + `useEditEntity` + `useDirtyForm` (isi formulir SEKALI dari data muat, foto lewat prop `media`); halaman dengan banyak kotak yang tersimpan sendiri = `EditorShell` + `MetaBox` + `PublishBox` + `useUnsavedGuard`. Jangan menumpuk panel `admin-form-panel`/kartu manual atau tombol kembali sendiri; hapus lewat `DeleteBox` (konfirmasi inline). Halaman terdaftar di `scripts/test-admin-editor.ts` (halaman baru WAJIB ditambahkan)
- Tailwind di project ini **v3.4**: modifier opacity di luar skala (mis. `/12`) tidak error tapi diam-diam tidak menghasilkan CSS — skala sudah diperluas untuk 12/14/15; di luar itu pakai nilai skala biasa
- List transaksional/yang bisa tumbuh: `parseListParams` + `paginate` dari `lib/admin/pagination.ts`, `orderBy` wajib punya tie-breaker `id`. Pengecualian: list katalog produk (master data kecil yang juga dikonsumsi picker)

---

## i18n (next-intl 4)

- The locale list lives ONLY in `i18n/routing.ts` (`defineRouting`); never re-declare `['id','en']` elsewhere. Validate any locale taken from a URL/param with `hasLocale(routing.locales, x)` before using it (e.g. the dynamic import of `i18n/messages/<locale>.json`)
- `next-intl` and `use-intl` are pinned to the same exact version (`package.json` `overrides`); bump them together and verify on the production artifact (`bun server.js`) — see `docs/rencana-next-intl-4.md`. `scripts/test-i18n-routing.ts` locks the routing/auth-gate properties (no off-origin redirects, protected routes stay protected). The middleware gate matches the CANONICAL path (`lib/auth/gatePath.ts`: decodeURI, strip tab/CR/LF, `\\`→`/`, collapse `/+`) because next-intl rewrites to that form — matching the raw path lets `/id/%61dmin` or `/id//admin` slip past (SEC-59); page/API guards remain the real access control

---

## Tiptap

- Active extensions: `StarterKit`, `Link`, `Image`, `Placeholder` — add others only when spec explicitly requires. **Tiptap is on v3 (since SEC-05, 2026-10-22; not imported anywhere yet):** v3 `StarterKit` already bundles `Link` and `Underline`, so register `Link` only via `StarterKit.configure({ link: {...} })` (or set `link: false` first) — adding it again duplicates the extension
- Always serialize to **JSON** (`editor.getJSON()`) — never HTML — and store JSON in DB
- To render saved content server-side: `generateHTML(json, extensions)`; client-side: `<EditorContent editor={editor} />`
- Tiptap editor instances live in Client Components only — never instantiate in a Server Component
- **Pakai komponen universal, jangan membuat editor baru:** `RichTextEditor` / `RichTextView` di `components/shared/rich-text/` + `richTextField()` di `lib/validators/richText.ts` (satu daftar putih node/format di `lib/rich-text/schema.ts`; rancangan dan cara pakai: `docs/arsitektur-editor-teks.md`). Tampilan memakai `RichTextView` (JSON → elemen React), bukan `generateHTML`. Kolom teks kaya WAJIB divalidasi `richTextField()` di server; kanal tanpa format (WhatsApp/email/ekspor) memakai `plainText()`. Tiptap dan `prosemirror-*` harus satu versi di `bun.lock` (dijaga `scripts/test-rich-text.ts`) — dua versi `prosemirror-model` membuat editor error saat Enter/daftar (SEC-60)

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
- Message templates in `lib/notifications/templates/whatsapp.ts`, keyed by notification type and locale. **WhatsApp scope is deliberately small** (ADR-0001): only booking submitted, payment reminders, payment confirmed/rejected (`waMessage` in `lib/notifications/events.ts`); everything else is email-only. Numbers are `User.whatsapp` (E.164) — never `phone`. **WhatsApp is sent ONLY to verified numbers** (`whatsappVerifiedAt` + `verifiedWhatsapp`, unique among verified accounts): the user proves the number by sending `VERIF <code>` to the business number and the signed GOWA webhook (`/api/v1/webhooks/whatsapp`, HMAC over the raw body, dead without `WHATSAPP_WEBHOOK_SECRET`) confirms the sender — nothing is ever sent outward to unverified numbers (ADR-0002). **Email is the guaranteed safety net**: `notify()` runs WhatsApp and email in parallel and email is sent for every event regardless of WhatsApp state (gateway down/unconfigured/blocked, no number, no consent) — a WhatsApp problem must never cost a user their notification (tested for every event type).
- Retry: 2 attempts, 2 s delay on network error — log failure to `notification_logs`, then continue
- GOWA is best-effort: a WA failure must **never** block a booking confirmation or status update
- Auth rate limiting: `lib/auth/rateLimit.ts` (Redis fixed-window counters, atomic Lua; falls back to in-process memory when Redis is unreachable — the app runs a single replica). All numbers live in `LIMITS` there: auth emails max 3 per address per 10 min and 10 per IP per hour, token preview/complete capped per IP, login failures capped per account+IP and per account, plus a per-IP ceiling. Applied in `auth/login`, `register`, `forgot-password`, `registration/preview`, `registration/complete`, `reset-password` (SEC-04), `auth/google/*`, `auth/contact`, `auth/whatsapp/verification`, `POST /bookings` and `webhooks/whatsapp` (bad signatures, per-sender, per-IP). A new auth endpoint that sends email, consumes a token or is publicly reachable must use it too

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
- Session JWT stored in `httpOnly; Secure; SameSite=Lax` cookie (`lib/auth/cookieFlags.ts`). **Lax, not Strict (decision 2026-10-22):** Strict is not sent when the redirect chain starts on another site, which breaks the Google callback (user lands on /login with a valid session) and links clicked from emails; CSRF stays closed because no state-changing route is a GET. `Secure` is on everywhere except `NODE_ENV === 'development'` (fail-closed). `JWT_SECRET` must be ≥32 chars, non-placeholder, non-low-entropy (`lib/auth/secret.ts`)
- Sessions are revocable (SEC-18, `docs/arsitektur-auth.md` §11): the JWT carries `ver` = `User.sessionVersion` and `getSession()` re-reads the account from the DB — never trust `role`/`userId` from the token itself, and never decode `snd-session` anywhere except `resolveSessionToken()` (middleware is a coarse hint only). Anything that changes a password, role, `isActive` or account ownership of an existing user MUST bump `sessionVersion` (`{ increment: 1 }`) in the same write. `createSession(userId[, expectedVersion])` takes only the id (+ the version login verified). Every admin Server Component `page.tsx` that reads Prisma must call `requireAdminPage(locale)` (`lib/auth/pageGuards.ts`) first — layouts are NOT re-rendered on soft navigation (SEC-52; a scanner in `scripts/test-session.ts` enforces it)
- Enforce role check inside every admin/superadmin Route Handler — do not rely on middleware alone
- Never log pilgrim PII (passport numbers, DOB, KTP) to application logs
- Dev-only behaviour (auth email links printed to the server log, default `APP_URL`, rate-limit bypass) is enabled **only when `NODE_ENV === 'development'` exactly** — fail-closed. Never `!== 'production'`: a wrong/empty `NODE_ENV` on any deployed environment must not leak account-takeover links (docs/lessons-learned.md SEC-02). Links/tokens never go in an HTTP response
- Never pass a request body straight into Prisma (`data: body`) — parse it with a `.strict()` Zod schema from `lib/validators/` so unknown fields are rejected (mass assignment, SEC-03)
- Auth tokens (`lib/auth/tokens.ts`): 256-bit random, only the SHA-256 hash is stored, single-use via atomic claim, short expiry; the page that shows a link must not consume it (email scanners GET links) — consume on POST. Account creation never precedes email ownership proof (no password set before the mailbox owner clicks). Email is the account identity: never let a profile endpoint change it without verifying the new address (SEC-17)
- Credential-checking limits RESERVE before they verify: `consume()` (atomic) first, `reset()` on success, layers in sequence — never `peek()`-then-`consume()` (parallel bursts slip through, SEC-26) and never parallel `consume` across layers (one IP could lock an account, S26-T01). `prisma/seed.ts` is guarded fail-closed by `prisma/seedGuard.ts` and excluded from every Docker image (SEC-27); a connection URL's `?host=` overrides its hostname in Prisma, so never trust `new URL().hostname` alone as "where we connect"
- Sensitive endpoints (login, register, forgot/reset password, token consumption) need rate limiting **and** a cap on wrong attempts. A protection function must have a caller you can `grep` — documenting a control is not the same as running it (SEC-04: `checkRateLimit()` was never called)
- Admin routes distinguish errors: `Unauthorized`/`Forbidden` → 401/403, invalid input → 400, everything else → 500 + log. Never `catch { return 403 }` for all errors — use `isAuthError`/`authFailureResponse`/`isRecordNotFound` from `lib/admin/errors.ts`; `scripts/test-routes.ts` (CI) fails on a `catch` that answers 403 without a 500/log path, on `const b = await req.json()` (parse with Zod), and on stub routes that answer `ok(null)` without auth (SEC-07/08)
- `bun audit --audit-level=critical` blocks CI; new high advisories brought in by a dependency added in a phase must be triaged in that phase
- Dependency bumps are verified on the PRODUCTION artifact, not just `next build`/dev: production runs `bun server.js` (standalone), and bumps have passed build + dev yet broken production (React 19.3.x crashes `next build` in Bun; `@react-pdf` ≥4.7 → invoice 500). CI runs `scripts/ci-invoice-smoke.ts` in the image; compare `bun.lock` before/after for transitive drift. Overrides live in `package.json` `overrides` (same-major only); rationale in `docs/lessons-learned.md` SEC-05
- Dockerfile, compose, Caddyfile, GitHub workflows, `scripts/*` and `.env*.example` are security surface too — they go through the same review (non-root, no secrets in images/layers, no published ports beyond the proxy, least-privilege workflow `permissions`)
- Process and severity policy: **Fase Eksekusi SOP langkah 5**; findings register: `docs/lessons-learned.md`

---

## Git

- Commits: Conventional Commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`
- One logical change per commit — do not mix feature work with refactors
- Link PRs to a `docs/decisions.md` entry for any architectural choice
- Repo: `github.com/webaneid/saudinesia` (private). Alur: branch → **PR ke `main`** → CI `validate` (`.github/workflows/ci.yml`) harus hijau → merge. Tidak ada commit langsung ke `main` (dijaga hook; proteksi sungguhan = branch protection GitHub)
- `prisma/migrations/` WAJIB di-commit, di PR yang sama dengan perubahan `schema.prisma` — CI gagal bila skema dan migrasi tidak sinkron
- Production/deploy/versioning: `docs/deployment.md` (alur git, CI, perbandingan dengan smart-ai, keputusan yang menunggu pemilik)

---

## Fase Eksekusi SOP (wajib diikuti untuk setiap implementasi multi-fase)

Berlaku untuk implementasi apa pun yang dipecah jadi beberapa fase/step (mis. mengeksekusi rencana di `docs/arsitektur-*.md`) — granularitas lebih kecil dari Milestone SOP di bawah, dipakai *di dalam* satu milestone.

**0. Selalu baca `CLAUDE.md` di awal dan tetap fokus pada task yang sedang dikerjakan** — jangan melebar ke perbaikan/fitur lain yang tidak diminta di fase berjalan, meski terlihat terkait.

**1. Recheck dulu — pastikan `docs/arsitektur-<modul>.md` yang ada BENAR-BENAR sama dengan kode aktual, sebelum dipakai sebagai dasar rencana upgrade apa pun.** Jangan percaya begitu saja isi dokumen lama (termasuk yang statusnya "SOURCE OF TRUTH" atau "SELESAI & TERVERIFIKASI") — dokumen bisa basi kalau ada perubahan kode yang tidak tercatat, atau audit sebelumnya salah/kurang lengkap. Baca ulang skema Prisma aktual, API routes, dan komponen kunci yang relevan, bandingkan baris per baris dengan yang tertulis di dokumen. Kalau ada gap/drift, catat dulu dan laporkan ke user sebelum lanjut — jangan lanjut merancang upgrade di atas dokumen yang belum dikonfirmasi akurat. Ini bukan langkah opsional yang boleh dilewati kalau dokumennya "kelihatan baru" — selalu verifikasi ulang, setiap kali, sebelum masuk ke poin 2.

**2. Baru buat perencanaan arsitektur, sebelum eksekusi kode apa pun.** Kalau rencananya belum ada dokumennya (`docs/arsitektur-*.md`), tulis dulu — jangan mulai coding dari rencana yang cuma ada di kepala/chat.

**3. Eksekusi satu fase pada satu waktu** — sesuai urutan yang sudah ditulis di rencana (mis. "Step 1", "Step 2" di `docs/arsitektur-harga.md` §9). Jangan lompat atau gabung beberapa fase sekaligus.

**4. Begitu satu fase selesai, cek error type dulu** — `bun run build`, harus **zero error** sebelum lanjut.

**5. Security check — sebelum dokumentasi & sebelum menutup fase** (pola langkah "Security check" pada SOP smart-ai, repo terpisah):
   - Jalankan skill `security-review` untuk SEMUA file yang diubah/ditambah fase ini: Route Handler, `lib/auth/`, upload/storage, `middleware.ts`, skema Prisma, **dan** Dockerfile/compose/Caddyfile/workflow/skrip/`.env*.example`. Skill berisi checklist per jenis file dan format laporan.
   - Fase besar (lebih dari ±10 file, lintas modul, atau menyentuh auth, pembayaran, upload, infra) → delegasikan ke subagent `security-auditor` (read-only) supaya konteks sesi utama tidak habis.
   - Jalankan `bun audit`. Critical = tidak boleh ada (CI memblokir). High baru yang masuk lewat dependency yang ditambah fase ini harus ditriase di fase itu.
   - **Klasifikasi & kewajiban:** temuan **Critical/High pada kode yang diubah atau ditambah fase ini WAJIB diperbaiki sebelum fase ditutup** — tidak ada pengecualian. **Medium/Low WAJIB dicatat** di `docs/lessons-learned.md` (Register Temuan Security: ID, severity, lokasi, rencana) — boleh ditunda, tidak boleh hilang.
   - **Temuan pre-existing** (kode lama yang ditemukan sambil lalu, bukan hasil fase ini): catat dengan severity apa adanya dan **beri tahu pemilik saat ditemukan**. Critical/High pre-existing tidak harus menghentikan fase yang sedang berjalan, tapi WAJIB dijadwalkan sebagai fase hardening dan Selesai sebelum go-live (`docs/progress.md` M15).
   - **Perbaikan dibuktikan dengan uji nyata** (curl/skrip terhadap kode yang berjalan, termasuk kasus yang harus DITOLAK), bukan hanya typecheck. Periksa juga bahwa proteksi yang diklaim punya **pemanggil** (`grep`) — dokumen yang bilang "ada rate limit" tidak membuktikan rate limit berjalan.
   - Ringkasan hasil review (jumlah temuan per severity, yang diperbaiki, yang dicatat) masuk ke entri `docs/decisions.md` fase ini dan deskripsi PR.

**6. Kalau 0 error DAN security check selesai, dokumentasikan hasil fase itu** — update `docs/progress.md` (centang item yang selesai), `docs/decisions.md` kalau ada keputusan baru yang diambil saat implementasi (bukan cuma yang direncanakan di awal), dan update dokumen arsitektur terkait kalau strukturnya berubah dari rencana.

**7. Baru lanjut ke fase berikutnya — ulangi dari nomor 3, sampai semua fase selesai.**

**Tidak boleh menutup fase selama masih ada temuan Critical/High yang belum diperbaiki pada kode yang diubah fase itu (poin 5), tidak boleh lompat ke fase berikutnya kalau build masih merah, tidak boleh eksekusi fase yang belum ada di rencana tertulis, dan tidak boleh mulai merencanakan upgrade (poin 2) sebelum poin 1 (recheck doc vs kode) selesai dan dikonfirmasi akurat.**

---

## Milestone SOP (wajib diikuti setiap selesai milestone)

1. **`bun run build`** — pastikan zero type errors sebelum lanjut. Fix semua error dulu.
   Typecheck dan dev server (Turbopack) TIDAK menangkap error bundling produksi — mis. kode khusus Node di `instrumentation.ts`/`middleware.ts` yang ikut dikompilasi untuk Edge. Perubahan di file-file itu atau `next.config.ts` hanya terbukti oleh `bun run build`. Kode khusus Node di instrumentation → `instrumentation-node.ts`, di-import dari dalam `if (process.env.NEXT_RUNTIME === 'nodejs')`.
2. **Security check** — skill `security-review` untuk file yang berubah (subagent `security-auditor` bila milestone besar) + `bun audit`. Critical/High pada kode milestone ini diperbaiki dulu; Medium/Low dicatat di `docs/lessons-learned.md`. Detail & aturan temuan pre-existing: Fase Eksekusi SOP langkah 5.
3. **Update `docs/progress.md`** — centang semua item yang selesai, catat yang masih pending.
4. **Append `docs/decisions.md`** — jika ada keputusan arsitektur baru selama implementasi (sertakan ringkasan hasil security check).
5. **Baru lanjut ke milestone berikutnya.**

Tidak boleh masuk fase berikutnya jika build masih merah atau ada temuan Critical/High yang belum diperbaiki pada kode milestone ini.

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
