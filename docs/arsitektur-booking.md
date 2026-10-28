# Arsitektur — Booking Engine Universal (SELESAI & TERVERIFIKASI — kecuali checkout Haji, sengaja di luar scope)

> **Status per 2026-07-25: Seluruh 8 step (§6) SUDAH DIEKSEKUSI & DIVERIFIKASI** — menutup Gap #1 (sebagian, lihat catatan Haji di bawah), #2, #3, dan #4 (`docs/arsitektur-umroh.md` §7), plus Dokumen & Manifest Universal, checkout pendek per-produk tanpa saling mewajibkan (Visa-only & Transport-only), dan invoice PDF profesional. Lihat §7 untuk bukti verifikasi Step 1-3, `docs/arsitektur-dokumen.md` §8 dan `docs/arsitektur-manifest.md` §8 untuk bukti Step 4, §7.1 untuk Step 5, §7.2 untuk Step 6, §7.3 untuk Step 7. **Yang SENGAJA di luar scope, bukan terlewat**: checkout Haji (Step 6) — API/skema-nya SUDAH menerima `itemType='haji'` sejak Step 5, tapi TIDAK ADA wizard/UI yang pernah mengirimnya, jadi pilgrim asli belum bisa booking Haji lewat browser. Haji butuh konsep "Visa Haji" tersendiri yang beda dari `VisaProduct` biasa (kata user eksplisit) — follow-up terpisah, belum dijadwalkan, dicatat di `CLAUDE.md` bug list dan `docs/arsitektur-umroh.md` §7 Gap #1. **Deviasi/keputusan penting sepanjang eksekusi, dicatat bukan silent**: (1) Step 5 sempat mewajibkan `visaProductId` per pilgrim, TAPI ini **DISUPERSEDE oleh Step 6a** — `visaProductId` sekarang OPSIONAL, pilgrim tanpa visa pakai field manifest "core" (lihat §6 Step 6a, `docs/decisions.md` 2026-07-25); (2) `@react-pdf/renderer` di-upgrade dari v3.4.4 ke v4.5.1 di Step 7 — v3.x tidak kompatibel dengan React 19 (project ini), crash saat render, bukan pilihan sengaja. Berbeda dengan `docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`, `docs/arsitektur-umroh.md` (semuanya audit as-built), dokumen ini SEKARANG JUGA audit as-built (bukan lagi rencana) untuk booking engine universal (Umroh, Package/Paket Umroh, Visa-only, Transport-only) — **satu booking engine, satu invoice, satu konfirmasi pembayaran universal** — sesuai arahan user 2026-07-08, dipertegas 2026-07-22. Haji tetap parsial (lihat di atas).
>
> Prasyarat baca: `docs/arsitektur-umroh.md` §7 (audit 2026-07-08 — Gap #1 Haji tidak bisa dibooking, Gap #2 self-cancel tidak melepas kuota, Gap #3 refund tidak pernah tercatat, Gap #4 totalAmount dipercaya dari client — **keempatnya dikonfirmasi ULANG masih terbuka lewat audit kode langsung 2026-07-22**, lihat §0 di bawah untuk baseline lengkap termasuk yang sudah berubah sejak audit 2026-07-08). Dokumen ini adalah **rencana perbaikan struktural** untuk akar masalah di balik semua gap itu, bukan sekadar tambal satu-satu.
>
> **Revisi 2026-07-08 (setelah draft pertama):** draf awal §3-§6 di bawah ini masih berasumsi bahwa "booking" selalu berbentuk satu trip Umroh dengan komponen opsional (hotel + transport + muthowif + catering + tour dibundel jadi satu). User mengoreksi asumsi ini — lihat §1.5.
>
> **Keputusan 2026-07-22 (menutup §1.5):** user memilih **satu keranjang campur bebas, mirip cart e-commerce** — bukan beberapa alur/endpoint terpisah per jenis produk. Artinya: satu `Booking` = satu invoice = satu konfirmasi pembayaran, isinya bisa kombinasi bebas item apa pun (cuma visa, cuma transport, trip Umroh penuh, atau campuran), bukan payload dengan field tetap per jenis. Lihat §1.5 untuk detail keputusan dan implikasinya ke skema.
>
> **Perluasan keputusan 2026-07-22 (§1.6, "total rewrite"):** user menegaskan ini bukan sekadar keranjang bebas, tapi rombak total model orang & dokumen dalam booking — analoginya booking kereta/pesawat: satu orang booking untuk siapa saja, jumlah tidak dibatasi (`totalPilgrims.max(500)` dihapus), form per-orang (manifest) **100% custom diatur admin** termasuk field paling dasar (lihat **`docs/arsitektur-manifest.md`**), dan dokumen (KTP/Paspor/dst.) jadi **komponen universal** lintas produk (bukan monopoli Visa, lihat **`docs/arsitektur-dokumen.md`**) — tiga dokumen terpisah, baca berdampingan. Invoice tetap ditujukan ke 1 orang (pembeli), manifest di dalamnya boleh banyak orang. Kekhususan booking per-produk (mis. Transport: jemput/antar/kontak/assign supir) **sengaja ditunda detailnya** — cukup dipastikan arsitektur Opsi B sudah mendukung, bukan didesain penuh sekarang. Lihat §1.6 untuk detail lengkap.

---

## 0. Baseline As-Built (audit ulang 2026-07-22 — sebelum eksekusi apa pun di dokumen ini)

`docs/arsitektur-umroh.md` ditulis 2026-07-08 dan **belum diperbarui** sejak itu — beberapa modul produk berubah signifikan di antaranya (Ziarah/`TourPackage`, Muthowif §9/§10, Variable Harga 3-Mode, Paket Umroh/`Package`). Audit langsung ke kode 2026-07-22 mengonfirmasi:

**4 Gap KRITIS di `docs/arsitektur-umroh.md` §7 masih PERSIS terbuka, tidak ada yang berubah:**
- Gap #1 (Haji tidak bisa dibooking, `HajiProduct` tanpa `pendingQuota`) — `createBookingSchema` masih tidak punya field `haji`, tidak ada `bookingHaji.create()` di kode manapun.
- Gap #2 (self-cancel tidak melepas kuota) — `DELETE /api/v1/bookings/[id]` masih tanpa `$transaction`, tanpa pemanggilan release apa pun.
- Gap #3 (refund tidak pernah tercatat) — tidak ada satu pun `prisma.refund.create()` di seluruh kode.
- Gap #4 (`totalAmount` dipercaya dari client) — **catatan penting**: hampir SEMUA harga individual lain (hotel, transport, paket ziarah, muthowif, visa) SEKARANG dihitung server-side di dalam `$transaction` yang sama (`app/api/v1/bookings/route.ts`) — tapi angka agregat `Booking.totalAmount` itu sendiri tetap diambil mentah dari `data.totalAmount` payload klien tanpa dicocokkan ulang ke jumlah item yang baru saja dihitung.

**Yang SUDAH berubah sejak audit 2026-07-08 (belum tercatat di `docs/arsitektur-umroh.md`, jadi dokumen itu sendiri sudah agak basi meski gap-nya sendiri masih valid):**
- Muthowif payment-confirm **SUDAH DITUTUP** 2026-07-20 — `admin/payments/[id]/confirm/route.ts` sekarang memanggil `confirmPoolMuthowifQuota()`/`confirmMuthowifQuota()`. Narasi §5 `arsitektur-umroh.md` yang bilang ini "bug aktif" sudah tidak akurat.
- `Booking.tours: BookingTour[]` di skema **sudah diganti total** jadi `Booking.tourPackages: BookingTourPackage[]` (refactor Ziarah 2026-07-21) — seluruh alur reserve/confirm/release untuk Paket Ziarah (termasuk auto-resolve kuota transport mode `included`, reservasi kuota hotel mode `user_choice`) sudah ada di 3 dari 4 titik orkestrasi (`bookings/route.ts`, `payments/[id]/confirm/route.ts`, `autocancelJob.ts`) — TAPI TIDAK di titik ke-4 (self-cancel DELETE, karena titik itu memang tidak melepas kuota apa pun sama sekali, Gap #2).
- Relasi `Booking.flights: BookingFlight[]` sudah ada di skema (modul Tiket Pesawat) tapi belum ada satu pun kode yang mengisinya — konsisten dengan `docs/arsitektur-tiket-pesawat.md` §2.1 yang memang menyatakan integrasi wizard di luar scope sampai sekarang.
- `Package`/Paket Umroh (`docs/arsitektur-paket-umroh.md`, selesai 2026-07-22) **sengaja dibangun TANPA integrasi booking sama sekali** — tidak ada `BookingPackage`, tidak direferensikan di `bookings/route.ts` atau titik orkestrasi manapun. Ini bukan gap yang lupa ditutup — ini keputusan sadar supaya modul produk itu tidak keburu terikat ke bentuk booking lama sebelum engine universal ini (dokumen ini) jadi.
- Dead code lama yang disebut Gap #10 (`app/api/v1/internal/autocancel/route.ts`, `.../reminders/route.ts`) **sudah tidak ada** — sudah dibersihkan di suatu titik antara 2026-07-08 dan sekarang, sudah tidak perlu jadi temuan aktif.

**Implikasi untuk dokumen ini:** baseline yang benar bukan cuma "5 tabel per-tipe + Umroh wizard" seperti asumsi draf 2026-07-08 — sekarang ada **7 baris kategori booking** yang perlu masuk adapter registry (§3.2): Hotel, Transport, Muthowif, Katering, TourPackage (Ziarah — BUKAN `BookingTour` lama), Haji (belum ada implementasi apa pun), Visa. Flight dan Package sengaja belum masuk hitungan — keduanya memang belum py jalur booking sama sekali by design, akan ditambahkan sebagai adapter baru saat masing-masing diintegrasikan (bukan pekerjaan tambahan dari dokumen ini, tinggal registrasi adapter baru begitu waktunya tiba).

**Recheck 2026-07-24 (sebelum eksekusi Step 1 dimulai):** audit ulang kode langsung (bukan cuma baca dokumen) mengonfirmasi seluruh baseline §0 di atas MASIH PERSIS akurat — 4 Gap kritis, daftar fungsi quota di `lib/quota/index.ts` (15 fungsi, tidak ada `lib/quota/adapters/` sama sekali), `bookings/route.ts`/`payments/[id]/confirm/route.ts`/`bookings/[id]/route.ts` DELETE/`autocancelJob.ts` semuanya persis seperti dideskripsikan. **Satu drift baru ditemukan** yang belum tercatat di sini: `BookingPilgrim` sekarang punya 3 kolom baku TAMBAHAN sejak `docs/arsitektur-komponen-kontak.md` dieksekusi 2026-07-23 — `phoneCountryCode`, `whatsapp`, `whatsappCountryCode` (`prisma/schema.prisma:744-746`), di luar kolom baku lama (`fullName`, `phone`, `email`, `passportNumber`, dst.) yang sudah tercatat di `docs/arsitektur-manifest.md`. **Implikasi:** saat Step 4 (Manifest) dieksekusi nanti, migrasi "kolom baku lama → `fieldValues: Json`" dan seed default `ManifestFieldRequirement` HARUS ikut menyertakan 3 kolom baru ini (kemungkinan `role: 'whatsapp'` untuk `whatsapp`+`whatsappCountryCode`, field custom untuk `phoneCountryCode`) — dicatat di sini supaya tidak terlewat saat itu terjadi, TIDAK memblokir Step 1-3 (tidak menyentuh `BookingPilgrim` sama sekali). Address (`addressId`) dikonfirmasi BELUM ada di `BookingPilgrim` — konsisten dengan rencana, tidak ada konflik tambahan.

---

## 1. Masalah Akar: Kenapa Umroh dan Booking Menyatu Sekarang

Saat ini hanya ada **satu jalur booking**, dan jalur itu adalah bentuk Umroh: `createBookingSchema` (Zod) hardcoded ke `hotelMakkah`, `hotelMadinah`, `transports[]`, `muthowif`, `catering`, `tours[]`. Setiap kali sebuah layanan (hotel/transport/muthowif/dst) perlu masuk ke siklus hidup booking, developer harus **mengingat untuk mengedit 4 tempat terpisah secara manual**:

1. `app/api/v1/bookings/route.ts` — reserve kuota + create line item
2. `app/api/v1/admin/payments/[id]/confirm/route.ts` — confirm kuota (pending → booked)
3. `app/api/v1/bookings/[id]/route.ts` (DELETE, self-cancel) — release kuota
4. `lib/cron/autocancelJob.ts` — release kuota (auto-cancel)

**Ini bukan hipotesis — ini persis pola yang menyebabkan setiap bug kritis yang sudah ditemukan:**
- Muthowif dapat #1 dan #2 (reserve, release cron) tapi terlupa di #2 confirm (`docs/arsitektur-muthowif.md` §7 Gap #1)
- Haji tidak dapat SEMUA — tidak ada di titik manapun, karena tidak ada yang pernah menulis kodenya (`docs/arsitektur-umroh.md` §7 Gap #1)
- Self-cancel (#3) tidak melepas kuota apa pun, padahal cron (#4) melakukannya dengan benar (`docs/arsitektur-umroh.md` §7 Gap #2)

Selama pola "4 tempat terpisah, per-tipe, ditulis tangan" ini dipertahankan, **setiap produk baru (Package, standalone Visa purchase, dst.) akan mengulangi kelas bug yang sama**. Ini alasan struktural untuk membangun booking engine universal, bukan estetika semata.

---

## 1.5 Masalah Tambahan: Booking Bukan Satu Bentuk Tetap

Draf pertama rencana ini (§3-§6) memperbaiki *plumbing* kuota **di bawah** wizard Umroh yang sudah ada — tapi diam-diam tetap mengasumsikan bahwa setiap booking adalah satu bentuk tetap: satu trip dengan hotel + transport + muthowif + catering + tour sebagai komponen opsional, ditambah Haji sebagai "step tambahan" di wizard yang sama (§6 Step 5). Ini asumsi yang keliru.

Kenyataan bisnisnya: seorang pelanggan mungkin **hanya** ingin membeli satu hal, bukan merakit satu trip lengkap:
- **Visa-only** — beli produk visa saja, tanpa hotel/transport/trip apa pun (mis. jamaah yang travelnya diatur travel agent lain, hanya butuh dokumen visa dari Saudinesia)
- **Transport-only** — jamaah sudah punya hotel sendiri, hanya butuh sewa kendaraan
- **Umroh penuh** — bentuk wizard 7-langkah yang sekarang ada (hotel + transport + muthowif + catering + tour + visa dokumen)
- **Haji** — paket all-inclusive (`HajiProduct.includes` sudah membundel semua layanan), alur pembeliannya realistisnya "pilih paket + jumlah orang", bukan rakit sendiri (lihat diskusi di `docs/arsitektur-umroh.md`)

Ini bukan satu wizard linear dengan langkah-langkah opsional (yang sudah ada sekarang), tapi **beberapa alur pembelian dengan bentuk payload yang berbeda-beda**, yang semuanya perlu bermuara ke satu engine yang sama di lapisan bawah.

**Implikasi ke desain di bawah:**
- `BookingItem` + adapter registry kuota (§3.1, §3.2) **tetap relevan dan valid** sebagai lapisan bawah — di situlah reserve/confirm/release terjadi per item, apa pun kombinasi item yang dibeli. Ini tidak berubah.
- Yang **perlu didesain ulang**: bagaimana `createBookingSchema` dan lapisan API/wizard di atasnya merepresentasikan "keranjang" berisi kombinasi item apa pun (satu visa saja, atau satu transport saja, atau kombinasi penuh) — bukan payload dengan field tetap per jenis (`hotelMakkah`, `hotelMadinah`, `muthowif`, dst. seperti `createBookingSchema` sekarang).

**Keputusan 2026-07-22 (menutup pertanyaan §1.5):**
- **Satu `Booking` = satu keranjang campuran bebas**, mirip cart e-commerce — BUKAN beberapa endpoint/alur terpisah per jenis produk (`POST /api/v1/bookings/visa`, `/transport`, dst. — opsi itu ditolak). Semua jenis pembelian (visa-only, transport-only, Umroh penuh, Haji, kombinasi apa pun) lewat **satu** `POST /api/v1/bookings` yang sama, dengan payload `items: BookingItemInput[]` generik — bukan field tetap per jenis.
- Satu `Booking` = satu invoice = satu konfirmasi pembayaran, apa pun isi keranjangnya (satu item atau banyak item campuran) — `totalAmount`, `paymentDeadline`, dan status lifecycle (§4 `arsitektur-umroh.md`) berlaku identik tanpa cabang logika berdasarkan "jenis alur."
- Wizard Umroh 7-langkah yang sekarang **berubah peran** dari "satu-satunya cara booking" jadi "satu cara mengisi keranjang" — UI-nya boleh tetap wizard multi-step untuk kasus "rakit trip sendiri", tapi di baliknya cuma menyusun array `items[]` yang sama yang dipakai checkout Visa-only/Transport-only/Haji (yang UI-nya bisa jauh lebih pendek, mirip checkout produk tunggal). Detail redesain schema & wizard ada di §3.3 (revisi) dan §6 Step 5 (revisi).

---

## 1.6 Total Rewrite: Manifest, Dokumen Universal, Invoice-ke-1-Orang (2026-07-22)

**Keputusan 2026-07-22 (memperluas §1.5 — bukan sekadar "keranjang bebas", tapi total rombak model orang dalam booking):** user eksplisit: *"kita ubah total .. booking engine yg sekarang tidak sesuai dengan yang saya mau"*. Analoginya: **booking kereta api atau pesawat** — satu orang bisa booking untuk dirinya sendiri, keluarganya, atau teman-temannya, bebas berapa pun jumlahnya, dan tiap orang di situ punya identitas + dokumen sendiri.

### 1.6.1 Setiap produk adalah entitas mandiri

Semua produk (Hotel, Transport, Muthowif, Katering, Visa, Tiket Pesawat, Haji, Paket Ziarah, Paket Umroh) bisa dibooking **berdiri sendiri** (satu produk saja) ATAU **digabung bebas** dalam satu booking yang sama — konsisten dengan keputusan keranjang §1.5, dipertegas di sini sebagai prinsip yang berlaku ke SEMUA produk tanpa kecuali, termasuk yang belum py jalur booking sama sekali hari ini (Package/Paket Umroh, Flight).

### 1.6.2 Manifest — daftar orang, tidak terbatas jumlahnya, form per-orang 100% custom

Satu `Booking` py **manifest**: daftar orang (`BookingPilgrim` — nama tetap dipakai apa adanya untuk minim-churn, lihat catatan penamaan di bawah) yang **tidak dibatasi jumlahnya** oleh aturan bisnis (`totalPilgrims.max(500)` di `createBookingSchema` **dihapus** — batas teknis wajar boleh tetap ada di validasi input demi mencegah payload abuse, tapi bukan aturan bisnis "maksimal 500 orang"). Satu orang bisa booking untuk dirinya sendiri, keluarga, atau siapa pun — manifest-nya bebas berapa pun. UI-nya berbentuk **repeater** ("+ Tambah Orang", tiap baris satu form, bisa dihapus).

**Keputusan 2026-07-22 (diperluas):** form per-orang **bukan kolom baku hardcode** — TERMASUK field paling dasar (Nama, No. HP, dst.) — semuanya 100% didefinisikan admin, bisa diedit/ditambah tanpa perubahan kode. Desain lengkap (skema `ManifestFieldRequirement`, kenapa tetap butuh beberapa kolom struktural minimal, mekanisme "peran field" supaya sistem tetap tahu mana nomor HP/nama tanpa hardcode) ada di **`docs/arsitektur-manifest.md` (dokumen terpisah, baca berdampingan)**.

**Catatan penamaan:** model `BookingPilgrim` **tidak direname** ke istilah lebih generik (mis. "Traveler") di fase ini — nama itu tetap menggambarkan >95% kasus pakai nyata (jamaah Umroh/Haji), dan rename model inti menyentuh puluhan file lintas modul untuk manfaat kosmetik semata. Kalau nanti ada kasus nyata "booking visa-only untuk teman yang jelas bukan jamaah" dan istilah "pilgrim" terasa mengganggu di UI, itu cukup soal **label tampilan**, bukan alasan rename model.

### 1.6.3 Dokumen — komponen universal, bukan monopoli Visa

Syarat dokumen (KTP, Paspor, KK, dst.) sekarang bisa berlaku untuk **produk apa pun** (Visa, Paket Umroh, Tiket Pesawat, Haji), bukan cuma Visa — dibangun sebagai **komponen reusable**, pola yang sama seperti infrastruktur harga universal (`docs/arsitektur-harga.md`). Desain lengkap ada di **`docs/arsitektur-dokumen.md` (dokumen terpisah, baca berdampingan dengan ini)** — ringkasnya: `DocumentRequirement` (polimorfik `productType`+`productId`, menggantikan `VisaProduct.requirements: Json` yang tertanam), `Document` (model existing, sudah cukup generik, tidak berubah).

**Implikasi ke keranjang & manifest:** dokumen yang wajib diupload untuk satu orang di manifest ditentukan oleh **item apa saja di keranjang yang menyertakan orang itu** — bukan lagi otomatis "semua orang di booking wajib visa" seperti sekarang (`VisaApplication` 1:1 wajib per pilgrim, lihat `docs/arsitektur-dokumen.md` §2). Kalau keranjang berisi 4 orang tapi Visa cuma dipilih untuk 2 dari mereka (2 lainnya sudah punya visa sendiri), cuma 2 orang itu yang dapat requirement dokumen visa — item lain (mis. Paket Umroh) yang menyertakan ke-4 orang itu bisa punya requirement dokumennya sendiri yang berlaku ke semuanya. Ini berarti **item butuh linkage eksplisit ke SEBAGIAN atau SEMUA orang di manifest**, bukan cuma angka `quantity`/`numPeople` seperti kebanyakan item sekarang (hotel/transport/muthowif tetap boleh berbasis kuantitas agregat tanpa linkage-per-orang, KECUALI kalau produk itu py syarat dokumen — maka wajib linkage eksplisit ke orang mana).

**Keputusan 2026-07-22 (menutup linkage — TIDAK bikin tabel generik baru):** `VisaApplication.bookingPilgrimId` **sudah** merupakan linkage item↔orang (1 baris = 1 pilgrim, sudah ada di schema hari ini) — yang perlu diubah bukan strukturnya, tapi **cara pembuatannya**: bukan lagi otomatis untuk SEMUA pilgrim di `data.pilgrims`, tapi cuma untuk pilgrim yang eksplisit disertakan di `pilgrimIds[]` pada item `{ itemType: 'visa', visaProductId, pilgrimIds: string[] }` — satu `VisaApplication` dibuat per id di array itu. `quantity` item Visa = `pilgrimIds.length` (dihitung dari array yang sama, bukan angka terpisah yang bisa tidak sinkron — mencegah kelas bug Gap #4 yang sama). Kalau nanti ada tipe item LAIN yang juga butuh syarat dokumen per orang (mis. Haji, Paket Umroh), pola yang SAMA diulang: tambah kolom `bookingPilgrimId` (nullable, bisa multi-baris per booking) ke tabel per-tipe-nya sendiri saat itu benar-benar dibutuhkan — **bukan** tabel linkage generik `BookingItemPilgrim` yang dibuat di muka untuk semua tipe sekaligus (over-engineering sebelum ada kebutuhan nyata, konsisten dengan alasan Opsi B di §5). Item kuantitas-agregat (hotel/transport/muthowif/catering/tourPackage/haji — SELAMA belum py syarat dokumen sendiri) tidak tersentuh sama sekali, tetap seperti sekarang.

**UI:** manifest diisi SEKALI (satu daftar orang bersama, §1.6.2), lalu item yang butuh linkage (Visa) punya kontrol terpisah untuk **memilih dari manifest yang sudah ada** siapa saja yang dicakup — bukan input ulang data orang per item.

### 1.6.4 Invoice ke 1 orang, manifest bisa banyak

Invoice/tagihan pembayaran **ditujukan ke 1 orang** — pembeli/akun yang membuat booking (`Booking.userId`) — meskipun manifest di dalamnya berisi banyak orang. Ini sudah konsisten dengan model `Payment`/`Booking` yang ada (satu `userId` per booking) — tidak perlu perubahan struktural, cuma ditegaskan di sini supaya jelas bedanya dengan manifest yang memang boleh banyak orang.

### 1.6.5 Kekhususan per-produk — hook, detail DITUNDA

User eksplisit: kekhususan booking per-jenis produk (mis. Transport: dijemput di mana, diantar ke mana, kontak siapa, assign supir; kemungkinan produk lain punya kekhususan serupa) **"itu nanti"** — bukan dikerjakan detail di rencana ini. Yang perlu dipastikan SEKARANG cuma: arsitektur Opsi B (§5 — tabel per-tipe existing, `BookingTransport` dkk.) **sudah secara natural mendukung** ini, karena tiap tabel per-tipe boleh punya kolom spesifik sendiri (`BookingTransport.pickupDetail`/`dropoffDetail` sudah ada persis contohnya) — tidak perlu desain tambahan di fase ini, cukup dicatat sebagai properti arsitektur yang sudah terpenuhi, bukan pekerjaan baru.

---

## 2. Preseden yang Sudah Ada di Codebase

`PackageItem` (`prisma/schema.prisma:301-312`) **sudah memakai pola polimorfik** untuk menyusun isi sebuah paket:

```prisma
model PackageItem {
  id          String  @id @default(uuid())
  packageId   String
  productType String  // 'hotel' | 'transport' | 'muthowif' | 'catering' | 'tour' | 'haji' | 'visa'
  productId   String  // FK ke tabel produk terkait (tidak di-enforce di level DB, demi fleksibilitas)
  quantity    Int     @default(1)
  notes       String?
}
```

Ini bukti bahwa pola "satu tabel, `productType` + `productId` polimorfik" **sudah diterima sebagai idiom di proyek ini** — booking engine universal yang diusulkan di sini adalah perluasan alami dari pola yang sama, bukan konsep asing.

---

## 3. Arsitektur yang Diusulkan

### 3.1 `BookingItem` — line item generik (Opsi A, visi opsional — TIDAK dibuat di Step 1-4 §6, lihat §5)

> Model di bawah ini menggambarkan Opsi A (§5) untuk ilustrasi bentuk ideal jangka panjang. **Yang benar-benar dibuat di §6 Step 1-4 adalah Opsi B** — enum `BookingItemType` di bawah tetap dipakai konseptual sebagai discriminator `itemType` di `createBookingSchema` (§3.3 "Bentuk Konkret"), tapi TANPA tabel `BookingItem` fisik ini — line item tetap masuk ke `BookingHotel`/`BookingTransport`/`BookingMuthowif`/`BookingCatering`/`BookingTourPackage` yang sudah ada.

```prisma
model BookingItem {
  id          String            @id @default(uuid())
  bookingId   String
  itemType    BookingItemType   // hotel | transport | muthowif | catering | tourPackage | haji | visa
  refId       String            // FK polimorfik: hotelRoomScheduleId | transportQuotaId | muthowifId | cateringOptionId | tourPackageId | hajiProductId | visaProductId
  quantity    Int               // rooms | seats | people | packages — makna tergantung itemType
  unitPrice   Decimal @db.Decimal(12, 2)
  totalPrice  Decimal @db.Decimal(14, 2)
  startDate   DateTime? @db.Date  // checkIn / travelDate / startDate — makna tergantung itemType
  endDate     DateTime? @db.Date  // checkOut / endDate — null jika tidak relevan (mis. transport sekali jalan)
  meta        Json      @default("{}")  // field spesifik-tipe: { hotelRoomId, isCharter, pickupDetail, dropoffDetail, ... }
  status      BookingItemStatus @default(pending)  // pending | confirmed | released

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  @@map("booking_items")
}

enum BookingItemType {
  hotel
  transport
  muthowif
  catering
  tourPackage
  haji
  visa
}

enum BookingItemStatus {
  pending    // direservasi, menunggu bayar
  confirmed  // pembayaran lunas, kuota sudah pending→booked
  released   // dibatalkan/expired, kuota sudah dilepas
}
```

**Kenapa `status` per-item, bukan diturunkan dari tabel kuota terpisah:** ini menutup akar masalah Gap #2/#3 di `arsitektur-umroh.md` — status hidup langsung di baris yang sama dengan line item, jadi tidak mungkin ada line item yang "lupa" di-confirm/release karena orkestrasi tidak lagi menulis tangan per tipe, tapi loop generik (lihat §3.2).

**Catatan migrasi data:** `BookingHotel.hotelRoomId`, `BookingTransport.isCharter/pickupDetail/dropoffDetail`, dll. yang tidak generik masuk ke `meta: Json` — pola yang sama seperti `VisaProduct.requirements` (JSON terstruktur, di-parse dengan helper mirip `parseRequirements()`).

### 3.2 Quota Adapter — satu interface untuk semua tipe produk

```typescript
// lib/quota/adapters/types.ts
export type QuotaAdapter = {
  reserve(tx: Tx, item: BookingItemInput): Promise<void>   // throw jika kapasitas kurang
  confirm(tx: Tx, item: BookingItem): Promise<void>          // pending → booked
  release(tx: Tx, item: BookingItem): Promise<void>           // lepas reservasi
}

// lib/quota/adapters/index.ts
export const quotaAdapters: Record<BookingItemType, QuotaAdapter> = {
  hotel:       hotelAdapter,
  transport:   transportAdapter,
  muthowif:    muthowifAdapter,
  catering:    cateringAdapter,     // no-op reserve/confirm/release — tidak ada kuota, tapi tetap harus ADA agar loop generik tidak crash
  tourPackage: tourPackageAdapter,  // TIDAK sepenuhnya no-op — transport (mode included, auto-resolve) & hotel (mode user_choice) sudah reservasi kuota nyata sejak docs/arsitektur-ziarah.md §12.6, adapter ini membungkus logic itu, bukan bikin baru
  haji:        hajiAdapter,         // BARU — memaksa keputusan skema pendingQuota diselesaikan (lihat §4)
  visa:        visaAdapter,         // no-op untuk kuota — visa tidak pakai kuota, tapi membuat VisaApplication HANYA untuk pilgrimIds[] yang disertakan di item ini (§1.6.3, BUKAN otomatis semua pilgrim seperti kode lama)
}
```

**Poin krusial:** karena `Record<BookingItemType, QuotaAdapter>` adalah type yang **lengkap secara statis** (TypeScript akan error compile-time jika satu `itemType` di enum tidak punya adapter terdaftar), **tidak mungkin lagi ada tipe yang "terlupa"** seperti Muthowif kemarin — TypeScript sendiri yang memaksa developer mengisi ketujuh adapter sebelum kode bisa build. Ini bukan disiplin manual, ini jaminan struktural.

### 3.3 Transaksi Universal

> **Catatan 2026-07-22:** kode di §3.3-§3.4 di bawah ini adalah **bentuk konseptual/ideal** (gaya Opsi A, §5 — satu tabel `BookingItem` generik) untuk ilustrasi interface adapter. Rekomendasi migrasi tetap **Opsi B** (§5) — implementasi nyata di §6 Step 1-4 TIDAK membuat tabel `BookingItem` baru, adapter mendispatch ke tabel per-tipe yang SUDAH ADA (`BookingHotel`, `BookingTransport`, dst., termasuk `BookingTourPackage` yang sudah ada sejak refactor Ziarah 2026-07-21) berdasarkan `itemType`. Ini tetap mewujudkan keputusan §1.5 (satu keranjang campur bebas, satu invoice, satu konfirmasi) — "keranjang" itu konsep di lapisan `createBookingSchema`/API (array item generik masuk, dispatch ke tabel yang tepat), bukan berarti storage-nya harus jadi satu tabel fisik. Lihat "Bentuk Konkret (Opsi B)" di bawah tiap contoh untuk versi yang benar-benar dieksekusi.

**Create** (`POST /api/v1/bookings`, generalisasi dari `app/api/v1/bookings/route.ts` yang ada):
```typescript
await prisma.$transaction(async (tx) => {
  for (const item of data.items) {
    await quotaAdapters[item.itemType].reserve(tx, item)
  }
  const totalAmount = data.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  // ↑ dihitung ulang SERVER-SIDE dari item yang sama yang baru direserve —
  //   menutup Gap #4 arsitektur-umroh.md (totalAmount tidak lagi dipercaya mentah dari klien)
  const bk = await tx.booking.create({ data: { ..., totalAmount } })
  for (const item of data.items) {
    await tx.bookingItem.create({ data: { bookingId: bk.id, ...item, status: 'pending' } })
  }
}, { isolationLevel: 'Serializable' })
```

**Bentuk Konkret (Opsi B — yang benar-benar dieksekusi §6):**
```typescript
// createBookingSchema baru: items generik, bukan field tetap (hotelMakkah/transports/dst.)
items: z.array(z.discriminatedUnion('itemType', [
  z.object({ itemType: z.literal('hotel'), hotelRoomScheduleId: z.string().uuid(), checkIn: z.string().date(), checkOut: z.string().date(), nights: z.number().int().min(1), numRooms: z.number().int().min(1) }),
  z.object({ itemType: z.literal('transport'), transportQuotaId: z.string().uuid(), numPassengers: z.number().int().min(1), pickupDetail: z.string().optional(), dropoffDetail: z.string().optional() }),
  z.object({ itemType: z.literal('muthowif'), startDate: z.string().date(), endDate: z.string().date(), numDays: z.number().int().min(1), numPeople: z.number().int().min(1) }),
  z.object({ itemType: z.literal('catering'), cateringOptionId: z.string().uuid(), startDate: z.string().date(), endDate: z.string().date(), numDays: z.number().int().min(1), numPeople: z.number().int().min(1) }),
  z.object({ itemType: z.literal('tourPackage'), tourPackageId: z.string().uuid(), transportQuotaId: z.string().uuid().optional(), numPeople: z.number().int().min(1), chosenHotelRoomScheduleId: z.string().uuid().optional(), chosenHotelNumRooms: z.number().int().min(1).optional() }),
  z.object({ itemType: z.literal('haji'), hajiProductId: z.string().uuid(), numPeople: z.number().int().min(1) }),
  z.object({ itemType: z.literal('visa'), visaProductId: z.string().uuid(), pilgrimIds: z.array(z.string().uuid()).min(1), selectedDurationDaysByPilgrim: z.record(z.string().uuid(), z.number().int().min(1)).optional() }),
])).min(1, 'Keranjang minimal 1 item')
// pilgrimIds WAJIB (§1.6.3) — menentukan pilgrim mana saja yang dapat VisaApplication dari item
// ini, sekaligus quantity (pilgrimIds.length) untuk hitung totalPrice server-side.

// Orkestrasi — adapter reserve() menulis ke tabel spesifik-tipe yang sudah ada, BUKAN ke BookingItem baru:
await prisma.$transaction(async (tx) => {
  const created: { itemType: BookingItemType; row: unknown; unitPrice: number }[] = []
  for (const item of data.items) {
    const row = await quotaAdapters[item.itemType].reserveAndCreate(tx, bookingIdPlaceholder, item) // adapter tahu tabel mana (tx.bookingHotel / tx.bookingTransport / tx.bookingTourPackage / dst.), harga DIHITUNG SERVER-SIDE di dalam adapter (bukan dari payload)
    created.push({ itemType: item.itemType, row, unitPrice: row.totalPrice })
  }
  const totalAmount = created.reduce((sum, c) => sum + c.unitPrice, 0) // menutup Gap #4 — dihitung dari row yang BARU dibuat, bukan dari data.totalAmount client
  await tx.booking.update({ where: { id: bookingIdPlaceholder }, data: { totalAmount } })
}, { isolationLevel: 'Serializable' })
```
Pilgrims/`VisaApplication` tetap field terpisah di `createBookingSchema` (bukan `itemType: 'visa'` — visa selalu per-jamaah, bukan per-booking, beda bentuk dari 6 tipe lain), konsisten dengan kode `bookings/route.ts` yang sudah ada sekarang.

**Confirm** (payment confirm, generalisasi dari `admin/payments/[id]/confirm/route.ts`):
```typescript
await prisma.$transaction(async (tx) => {
  await tx.payment.update({ where: { id }, data: { status: 'confirmed', ... } })
  await tx.booking.update({ where: { id: booking.id }, data: { status: 'confirmed' } })
  for (const item of booking.items) {
    await quotaAdapters[item.itemType].confirm(tx, item)
    await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'confirmed' } })
  }
})
```

**Cancel** (self-cancel DAN auto-cancel cron — SATU fungsi dipakai keduanya, bukan dua implementasi terpisah seperti sekarang):
```typescript
export async function cancelBooking(tx: Tx, booking: BookingWithItems, reason: string) {
  await tx.booking.update({ where: { id: booking.id }, data: { status: 'cancelled' } })
  for (const item of booking.items) {
    await quotaAdapters[item.itemType].release(tx, item)
    await tx.bookingItem.update({ where: { id: item.id }, data: { status: 'released' } })
  }
  const refund = computeRefundAmount(Number(booking.totalAmount), booking.departureDate)
  if (refund > 0) {
    await tx.refund.create({ data: { bookingId: booking.id, amount: refund, reason, status: 'pending' } })
    // ↑ menutup Gap #3 arsitektur-umroh.md — refund SELALU tercatat, tidak pernah lagi cuma dihitung-lalu-hilang
  }
}
```
Dipanggil dari `DELETE /api/v1/bookings/[id]` (dalam `$transaction`, beda dari sekarang yang tidak transaksional — menutup Gap #2) dan dari `lib/cron/autocancelJob.ts` — **kode yang persis sama**, bukan dua implementasi yang bisa divergen lagi.

### 3.4 Invoice Universal

`lib/pdf/invoice.tsx` (saat ini stub kosong) generate PDF dengan **satu fungsi render**, bukan satu komponen per tipe layanan. Versi konseptual (Opsi A) loop generik atas `booking.items` dikelompokkan per `itemType`. **Bentuk konkret Opsi B** (§6 Step 6): loop atas tiap relasi per-tipe yang sudah ada (`booking.hotels`, `.transports`, `.muthowif`, `.catering`, `.tourPackages`, `.haji`, `.visa`), tapi tetap satu fungsi render generik yang menerima daftar `{ label, description, amount }` yang sudah diseragamkan oleh masing-masing adapter — bukan satu blok render hardcoded per tipe di dalam `invoice.tsx` sendiri.

---

## 4. Yang Ini Selesaikan Sekaligus (menutup gap `arsitektur-umroh.md` §7)

| Gap lama | Bagaimana arsitektur ini menutupnya |
|---|---|
| #1 Haji tidak bisa dibooking, `HajiProduct` tanpa `pendingQuota` | Menulis `hajiAdapter` **memaksa** keputusan skema `pendingQuota` diambil eksplisit (tidak bisa dihindari lagi seperti sekarang) |
| #2 Self-cancel tidak melepas kuota | `cancelBooking()` satu fungsi dipakai self-cancel & cron — tidak mungkin lagi divergen |
| #3 Refund tidak pernah tercatat | `cancelBooking()` selalu membuat record `Refund` jika `refund > 0` |
| #4 `totalAmount` dipercaya dari klien | Dihitung ulang server-side dari `item.unitPrice * item.quantity` sebelum booking dibuat |
| Muthowif confirm terlupa | `Record<BookingItemType, QuotaAdapter>` lengkap secara statis — TypeScript menolak build jika ada tipe tanpa adapter |
| Katering/Tour tanpa kuota | Tetap tidak berkapasitas (sesuai model bisnis saat ini), tapi sekarang eksplisit sebagai no-op adapter, bukan "lupa ditambahkan" |

---

## 5. Strategi Migrasi — Dua Opsi

### Opsi A — Big Bang: ganti semua tabel `BookingX` dengan `BookingItem` tunggal

Migrasi data satu kali: pindahkan semua baris `BookingHotel`/`BookingTransport`/`BookingMuthowif`/`BookingCatering`/`BookingTour` ke `BookingItem` dengan `meta` terisi dari kolom lama. Semua query di modul lain (`docs/arsitektur-visa.md`, `arsitektur-transportasi.md`, `arsitektur-muthowif.md` yang mereferensikan `booking.hotels`, `booking.transports`, dst.) perlu ditulis ulang ke `booking.items.filter(i => i.itemType === 'hotel')`.

**Risiko:** migrasi data produksi, breaking change ke banyak halaman admin/pilgrim yang sudah query relasi lama, butuh update ulang 3 dokumen arsitektur produk yang sudah ditulis.

### Opsi B — Inkremental (REKOMENDASI): pertahankan tabel per-tipe, tambahkan HANYA lapisan orkestrasi

Tabel `BookingHotel`, `BookingTransport`, `BookingMuthowif`, dst. **tetap seperti sekarang** — tidak ada migrasi data, tidak ada breaking change ke halaman yang sudah ada. Yang ditambahkan **hanya** lapisan adapter (`lib/quota/adapters/`) dan fungsi `cancelBooking()` universal, lalu 4 titik orkestrasi (`bookings/route.ts`, `payments/[id]/confirm/route.ts`, `bookings/[id]/route.ts` DELETE, `autocancelJob.ts`) di-refactor untuk memanggil registry adapter alih-alih menulis blok per-tipe secara manual — tapi tabel line-item hasil akhirnya **tetap tabel spesifik-tipe yang sudah ada**, adapter cuma jadi lapisan tipis di atasnya.

`BookingItem` polimorfik (Opsi A) jadi **visi jangka panjang opsional** — baru benar-benar dibutuhkan kalau nanti ada jenis produk yang sungguh tidak cocok pola manapun (mis. tiket pesawat, asuransi perjalanan), bukan kebutuhan mendesak sekarang.

**Rekomendasi: Opsi B.** Menutup semua gap kritis di §4 dengan risiko jauh lebih rendah (tidak ada migrasi data, tidak ada perubahan skema yang breaking, dokumen arsitektur produk yang sudah ditulis tetap akurat tanpa revisi) — **dan tetap sepenuhnya mewujudkan keputusan §1.5** (satu keranjang campur bebas, satu invoice, satu konfirmasi). "Keranjang" adalah bentuk `createBookingSchema`/API (array `items[]` generik masuk, adapter dispatch ke tabel yang tepat) — bukan berarti storage-nya wajib satu tabel fisik. `BookingItem` polimorfik (Opsi A) tetap didokumentasikan sebagai visi jangka panjang opsional (§8 poin 7), belum jadi kebutuhan mendesak.

**Keputusan 2026-07-22 (menutup):** `Booking.departureDate`/`returnDate` **TETAP wajib diisi** (`DateTime`, bukan nullable), apa pun isi keranjangnya — termasuk booking Visa-only/Transport-only yang belum tentu py "tanggal keberangkatan trip" yang jelas secara konsep, pemesan tetap mengisi tanggal itu secara manual. **Tidak ada perubahan skema untuk field ini** — kebijakan refund (`computeRefundAmount`, §6 Umroh) tetap berjalan apa adanya tanpa perlu kasus khusus.

---

## 6. Urutan Implementasi (siap eksekusi bertahap — §1.5 sudah dijawab 2026-07-22)

**Seluruh 8 step DIEKSEKUSI & DIVERIFIKASI (Step 1-3: 2026-07-24, Step 4: 2026-07-24, Step 5-8: 2026-07-25) — Haji SENGAJA DIKELUARKAN dari Step 6, lihat §7.2.** Lihat §7/§7.1/§7.2/§7.3 untuk bukti masing-masing.

```
Step 1 — Adapter interface & implementasi per tipe [x] SELESAI 2026-07-24
  - lib/quota/adapters/types.ts — definisikan QuotaAdapter
  - lib/quota/adapters/{hotel,transport,muthowif,catering,tourPackage,haji,visa}.ts
    (BUKAN "tour" — itemType yang benar adalah tourPackage/BookingTourPackage, model BookingTour
    lama sudah tidak ada sejak refactor Ziarah 2026-07-21, lihat §0)
  - Migrasi isi lib/quota/index.ts yang sudah ada (reserveHotelQuota dst.) jadi implementasi hotelAdapter.reserve, dst. — TIDAK menulis ulang logic, hanya membungkus fungsi yang sudah benar
  - tourPackageAdapter membungkus logic auto-resolve kuota mode included + reservasi hotel mode
    user_choice yang sudah ada di bookings/route.ts (docs/arsitektur-ziarah.md §12.6) — pindah lokasi, bukan tulis ulang
  - Tulis hajiAdapter BARU — ini titik yang memaksa keputusan skema HajiProduct.pendingQuota
  - visaAdapter tetap no-op untuk kuota (visa tidak pakai kuota), tapi TETAP membuat BookingPilgrim
    + VisaApplication seperti kode sekarang (bukan dihilangkan)

Step 2 — Migration: tambah pendingQuota ke HajiProduct [x] SELESAI 2026-07-24
  - bun prisma migrate dev --name add_haji_pending_quota (ikuti workflow shadow-DB non-interaktif, lihat memory project-prisma-migration-non-interactive-env)
  - Migrasi aktual: 20260724100000_haji_pending_quota

Step 3 — cancelBooking() universal [x] SELESAI 2026-07-24
  - lib/booking/cancel.ts — satu fungsi, dipanggil dari DELETE route dan cron

Step 4 — Komponen Dokumen + Manifest Universal [x] SELESAI 2026-07-24 (docs/arsitektur-dokumen.md §8, docs/arsitektur-manifest.md §8 — bukti verifikasi lengkap di sana)
  - Schema: model DocumentRequirement (polimorfik productType+productId, lihat docs/arsitektur-dokumen.md §3)
  - Schema: model ManifestFieldRequirement + BookingPilgrim disederhanakan jadi fieldValues: Json
    (lihat docs/arsitektur-manifest.md §3) — kolom baku lama (fullName, passportNumber, dst.)
    DIHAPUS dari BookingPilgrim, migrasi data lama ke fieldValues + seed ManifestFieldRequirement
    default yang meniru kolom lama (docs/arsitektur-manifest.md §6) supaya tidak breaking
  - Migrasi data: VisaProduct.requirements (Json) → baris DocumentRequirement productType='visa'
    (field lama TETAP ADA dulu, deprecated — tidak langsung dihapus, lihat docs/arsitektur-dokumen.md §5)
  - lib/documents/getRequirements.ts — getDocumentRequirements(productType, productId)
  - lib/manifest/getRequirements.ts — getManifestFieldRequirements(productType, productId),
    getFieldByRole() (docs/arsitektur-manifest.md §4)
  - Komponen frontend <ManifestRepeater> — render field dinamis dari getManifestFieldRequirements(),
    union field kalau booking berisi >1 produk (docs/arsitektur-manifest.md §5)
  - Endpoint upload dokumen pilgrim (pilgrims/[bookingId]/[pilgrimId]/documents) — ganti sumber
    validasi dari visaApp.visaProduct.requirements ke getDocumentRequirements() berdasarkan
    SEMUA item booking yang menyertakan pilgrim itu (bukan cuma visa)
  - Semua tempat yang baca kolom baku BookingPilgrim langsung (admin bookings list/detail,
    dashboard pilgrim, notifikasi WA, invoice) — ganti ke getFieldByRole(pilgrim.fieldValues, role)

Step 5 — Redesain createBookingSchema jadi array items[] generik + Manifest + refactor 4 titik orkestrasi [x] SELESAI 2026-07-25
  - lib/validators/booking.ts — ganti field tetap (hotelMakkah/transports/muthowif/dst.) jadi
    items: z.array(discriminated union per itemType) — lihat bentuk konkret di §3.3. Termasuk
    itemType='haji' BARU (hajiProductId, numPersons) — registry §1-2 sudah siap, cuma belum ada
    yang mengirimnya sampai sekarang.
  - totalPilgrims.max(500) DIHAPUS (§1.6.2), diganti .max(2000) — batas TEKNIS anti-abuse murni,
    bukan aturan bisnis (§8 Keputusan #9)
  - **DEVIASI dari rencana ini**: Visa TETAP WAJIB per pilgrim (`visaProductId` required, BUKAN
    dihapus dari pilgrim schema seperti direncanakan baris ini semula). Field manifest (nama,
    kontak, dst.) hari ini 100% bersumber dari `ManifestFieldRequirement` yang di-keyed oleh
    `visaProductId` (`docs/arsitektur-manifest.md`) — kalau visa dibuat opsional sekarang, pilgrim
    yang tidak pilih visa tidak akan punya field apa pun untuk diisi (termasuk nama). Mendecouple
    manifest fields dari `visaProductId` (mis. `productType='core'` generik) adalah pekerjaan
    tersendiri, sengaja BELUM dikerjakan — lihat `docs/decisions.md` 2026-07-25 untuk rationale
    lengkap dan §7.1 di bawah untuk detail scope. Sebagai konsekuensi, `itemType='visa'` (§3.3
    baris 233, versi konseptual) TIDAK dipakai — visa tetap field `pilgrims[]` terpisah dari
    `items[]`, konsisten dengan keputusan final §3.3 baris 249 (bukan versi konseptual §3.3 atas).
  - Booking.departureDate/returnDate TETAP wajib diisi manual, tidak ada perubahan skema (§5, sudah diputuskan)
  - app/api/v1/bookings/route.ts — reserve loop + create loop pakai satu switch generik atas
    items[] (dispatch per itemType), totalAmount diakumulasi dari totalPrice tiap item YANG BARU
    DIBUAT (bukan dari payload) + sellPriceSnapshot visa tiap pilgrim — menutup Gap #4 KRITIS
    (docs/arsitektur-umroh.md §7) yang belum tertutup Step 1-4 (field individual sudah server-side,
    tapi totalAmount agregat masih lolos dari client sampai putaran ini)
  - app/api/v1/admin/payments/[id]/confirm/route.ts — tambah include+confirm loop untuk `haji`
    (sebelumnya cuma hotels/transports/muthowif/tourPackages — celah ini baru relevan begitu Haji
    genuinely bookable lewat items[])
  - app/api/v1/bookings/[id]/route.ts (DELETE) — TIDAK PERLU diubah, sudah include+release `haji`
    sejak Step 1-3
  - lib/cron/autocancelJob.ts — TIDAK PERLU diubah, sudah include+release `haji` sejak Step 1-3
  - lib/booking/draft.ts + wizard step pages (dates/hotel/transport/muthowif/addons/pilgrims) —
    TIDAK DIUBAH SAMA SEKALI (bentuk internal draft tetap field tetap, wizard 7-langkah TETAP ADA
    secara UI, §1.5). Satu-satunya titik terjemahan: app/[locale]/(pilgrim)/bookings/new/payment/page.tsx
    meratakan draft jadi items[] SAAT SUBMIT — blast radius seminimal mungkin, tidak ada perubahan
    UX di step manapun.

Step 6 — Checkout pendek untuk Visa-only / Transport-only [x] SELESAI 2026-07-25 (Haji TIDAK
dikerjakan, sengaja dikeluarkan dari scope — lihat §7.2)
  - **Step 6a — Decouple manifest dari visaProductId (prasyarat, TIDAK ada di rencana awal)**:
    user eksplisit — "tidak ada satupun product mewajibkan product lain ketika checkout ..
    semua berdasarkan product checkout sesuai dengan standard onlineshop". `pilgrims[].visaProductId`
    jadi OPSIONAL (supersede keputusan Step 5 yang mewajibkannya). Field manifest "core"
    (lib/manifest/constants.ts — productType='core', productId='default', 5 field: fullName/
    gender/email/phone/whatsapp) untuk pilgrim TANPA visa. `superRefine` direstrukturisasi —
    early-return lama dihapus (bug: booking 0-visa akan skip semua validasi kalau dibiarkan).
    `bookings/route.ts` — VisaApplication + kontribusi totalAmount HANYA kalau `p.visaProductId`
    ada. 2 halaman detail booking (admin+pilgrim) — cabang `else` untuk render nama pilgrim
    tanpa visa (sebelumnya fallback ke 'Jamaah').
  - **Step 6b — Checkout pendek Visa-only**: `bookings/checkout/visa/page.tsx` +
    `VisaCheckoutForm.tsx` (state lokal, BUKAN draft.ts) — pilih produk visa (bisa preselect dari
    query `?productId=`), repeater jamaah pakai `ManifestFieldsForm` yang sudah reusable, submit
    `items: []` + `pilgrims[]` ke `POST /api/v1/bookings` yang SAMA (Step 5), bukan endpoint terpisah.
  - **Step 6c — Checkout pendek Transport-only**: `bookings/checkout/transport/page.tsx` +
    `TransportCheckoutForm.tsx` — pilih trip+tanggal+kendaraan (reuse `GET /api/v1/catalog/transport`
    existing), repeater penumpang pakai field manifest "core" (TANPA visaProductId sama sekali),
    submit `items: [{itemType:'transport',...}]` + `pilgrims[]` tanpa key `visaProductId`.
  - **Step 6d — Wiring CTA**: `(public)/visa/page.tsx` ("Ajukan Sekarang") dan
    `components/shared/TransportSearch.tsx` ("Pesan sekarang") diarahkan ke checkout baru
    (sebelumnya keduanya ke `/register`, tidak terhubung ke booking apa pun).
  - **Bug ditemukan & ditutup selama verifikasi** (bukan bagian rencana awal): `DocumentGrid`/
    `PilgrimDocuments` jatuh ke `REQUIRED_DOCUMENTS` (daftar hardcode paspor/KTP/dst.) kalau
    `requirements` prop `undefined` — sebelum Step 6a ini dead code (setiap pilgrim selalu punya
    visa, jadi requirements selalu ter-set), tapi jadi tereksekusi nyata begitu pilgrim tanpa visa
    mungkin ada. Fix: kedua halaman detail booking set `[]` eksplisit (bukan biarkan `undefined`)
    untuk pilgrim tanpa visa — nol dokumen wajib, bukan daftar visa/haji yang tidak relevan.
  - **Haji dikeluarkan total dari scope ini** — kata user: "visa haji dengan visa yang tersedia
    berbeda sama sekali, jika haji mewajibkan berarti catat saja bahwa itu kesalahan dan harus
    diperbaiki, kita blm sentuh haji, karena blm masuk dalam rencana kita sekarang." Dicatat
    sebagai bug/gap terpisah (Haji butuh konsep "Visa Haji" sendiri, bukan `VisaProduct` biasa)
    — BUKAN dikerjakan, lihat CLAUDE.md bug list.

Step 7 — Invoice PDF profesional [x] SELESAI 2026-07-25
  - **lib/pdf/invoiceData.ts** (baru) — `buildInvoiceData(booking)`, satu tempat normalisasi 7
    relasi per-tipe existing (Opsi B — hotels/transports/muthowif/catering/tourPackages/haji +
    visa dari `pilgrims[].visaApplication`, BUKAN `booking.visa`/`BookingVisa` (model ini DIHAPUS 2026-10-30) yang tidak pernah
    dipakai kode manapun) jadi bentuk seragam `{label, description, qty, unitPrice, amount}[]`.
  - **lib/pdf/invoice.tsx** — implementasi nyata menggantikan stub, `@react-pdf/renderer`
    (di-upgrade v3.4.4→v4.5.1, lihat §8 Keputusan #15 — v3.x tidak kompatibel React 19). Satu
    fungsi render generik `generateInvoicePdf(data): Promise<Buffer>`, layout profesional (kop
    +logo opsional, Bill To, status badge, tabel item, subtotal/total/sisa tagihan TANPA
    discount/tax — platform ini tidak punya konsep itu, terms pembayaran dari
    `getPaymentConfig()`).
  - **Nomor invoice** = turunan `Booking.bookingCode` (`INV-${bookingCode}`) — TIDAK ada field/
    migrasi baru, konsisten prinsip 1 booking = 1 invoice yang sudah jadi arsitektur §1.5.
  - **app/api/v1/bookings/[id]/invoice/route.ts** — GET mengembalikan `application/pdf`
    langsung (bukan JSON), auth pola sama persis `pilgrims/[bookingId]/[pilgrimId]/documents/route.ts`
    (`getSession()`+`ADMIN_ROLES`+cek `booking.userId`).
  - Invoice ditujukan ke 1 orang (Booking.userId, §1.6.4), manifest ditampilkan sebagai lampiran/detail
  - Tombol "Unduh Invoice" di halaman detail booking pilgrim DAN admin — link biasa ke endpoint,
    browser handle download natural.

Step 8 — Build + dokumentasi [x] SELESAI 2026-07-25
  - `docs/arsitektur-umroh.md` §7 Gap #1 diupdate — status akurat: DITUTUP di sisi API/skema
    (Step 5), UI/wizard SENGAJA belum (Step 6 exclude Haji, bukan terlewat). Gap #2/#3/#4 sudah
    DITUTUP sejak Step 1-3/5 (tanggal sudah tercatat di masing-masing entri).
  - Status banner dokumen ini (§1 atas) diupdate dari "SEBAGIAN DIEKSEKUSI" jadi "SELESAI &
    TERVERIFIKASI — kecuali checkout Haji, sengaja di luar scope" — 7 dari 8 step benar-benar
    tuntas, 1 pengecualian (Haji) didokumentasikan eksplisit, bukan diam-diam dianggap selesai.
```

---

## 7. Verifikasi Step 1-3 (2026-07-24)

**Deviasi dari pseudo-code §3.2**: `quotaAdapters` diimplementasikan sebagai object literal dengan tipe konkret per key (bukan `Record<BookingItemType, QuotaAdapter>` generik seragam) — tiap adapter beroperasi atas baris tipenya sendiri (`BookingHotel`, `BookingTransport`, dst.) yang bentuknya beda-beda, jadi generic tunggal `QuotaAdapter<T>` cuma dipakai per adapter, bukan dipaksa satu bentuk untuk semua. Kelengkapan key tetap dijamin TypeScript (object literal type checking menolak build kalau satu key hilang dari `quotaAdapters` — sama efeknya dengan `Record<>`, tanpa perlu unifikasi paksa yang tidak natural).

**Fase 1 — Adapter layer + refactor 3 titik orkestrasi** (`lib/quota/adapters/{types,hotel,transport,muthowif,catering,tourPackage,visa}.ts` + `index.ts`): murni bungkus fungsi `lib/quota/index.ts` yang sudah ada, zero behavior change. `bookings/route.ts` (reserve), `payments/[id]/confirm/route.ts` (confirm), `autocancelJob.ts` (release) direfactor pakai adapter. `bun run build` 0 error.

**Fase 2 — HajiProduct.pendingQuota + hajiAdapter**: migrasi `20260724100000_haji_pending_quota` (kolom `pendingQuota Int @default(0)`, pola identik `HotelRoomSchedule`). `lib/quota/adapters/haji.ts` (`reserveHaji`/`confirm`/`release`) ditulis dan didaftarkan di registry — TAPI belum dipanggil dari titik mana pun (booking Haji sendiri belum ada, itu pekerjaan Step 5).

**Fase 3 — `cancelBooking()` universal** (`lib/booking/cancel.ts`): dipanggil dari `DELETE /api/v1/bookings/[id]` (dalam `$transaction`, sebelumnya TIDAK transaksional dan TIDAK melepas kuota sama sekali) DAN `lib/cron/autocancelJob.ts` (sebelumnya implementasi terpisah) — sekarang fungsi yang sama persis.

**Verifikasi end-to-end (curl + query DB langsung, server dev nyata di `bun run dev`)**:
1. Booking dibuat dengan `hotelMakkah` 2 kamar (`hotelRoomScheduleId` real) → `HotelRoomSchedule.pendingQuota` naik dari 0 ke 2 (reserve via adapter bekerja).
2. `DELETE /api/v1/bookings/[id]` (self-cancel, `departureDate` sudah lewat) → response `{refundAmount: 0}` (sesuai `computeRefundAmount()` — <30 hari = 0%), `pendingQuota` kembali ke 0, `booking.status = 'cancelled'`, TIDAK ada row `Refund` (benar, karena refund 0).
3. Booking kedua dibuat dengan `departureDate` 2026-10-15 (>60 hari dari tanggal sistem 2026-07-24), `totalAmount` 20.000.000 → self-cancel → response `{refundAmount: 20000000}`, row `Refund` dikonfirmasi tercipta di DB: `amount: 20000000`, `status: 'pending'`, `reason: 'Dibatalkan oleh pilgrim'`.
4. Data test (booking, pilgrim, visa application, hotel line item, refund) dibersihkan setelah verifikasi.

`bun run build` 0 error di setiap fase. Detail lengkap di `docs/decisions.md` 2026-07-24, `docs/arsitektur-umroh.md` §7 Gap #2/#3 ditandai DITUTUP.

**Yang BELUM dikerjakan (Step 4-8, tetap rencana)**: Manifest + Dokumen universal (prasyarat Step 5), redesain `createBookingSchema` jadi `items[]` generik + refactor penuh 4 titik orkestrasi ke bentuk final, booking Haji itu sendiri (field `haji` di schema + `bookingHaji.create()`), checkout pendek Visa-only/Transport-only/Haji, invoice generik. Lihat §6 Step 4-8 untuk detail masing-masing.

---

## 7.1 Verifikasi Step 5 (2026-07-25)

**Recheck sebelum eksekusi (poin 1 SOP)**: baca ulang `lib/validators/booking.ts`, `app/api/v1/bookings/route.ts`, `app/api/v1/admin/payments/[id]/confirm/route.ts` langsung — dikonfirmasi masih persis bentuk lama (field tetap `hotelMakkah`/`hotelMadinah`/`transports`/`muthowif`/`catering`/`tourPackages`, `totalAmount` dari client, confirm route belum include `haji`) sebelum redesain dimulai. Tidak ada drift lain ditemukan dari status Step 1-4.

**5a — `lib/validators/booking.ts`**: `createBookingSchema.items` jadi `z.array(bookingItemSchema).default([])`, `bookingItemSchema` discriminated union 6 tipe (hotel/transport/muthowif/catering/tourPackage/haji — persis §3.3 baris 227-233, minus `visa` yang sengaja tidak dipakai sebagai itemType, lihat §6 Step 5 di atas). `totalAmount` dihapus total dari input. `totalPilgrims.max(500)` → `.max(2000)`. `superRefine` async query `VisaProduct`+`ManifestFieldRequirement` dipertahankan APA ADANYA dari sebelumnya (validasi required-field per fieldKey, validasi requiredComponents hotel/transport) — cuma sumber `data.hotelMakkah`/`data.transports` di dalam `superRefine` diganti `data.items.some(i => i.itemType === '...')`.

**5b — `app/api/v1/bookings/route.ts`**: reserve loop dan create loop masing-masing jadi SATU `for (const item of data.items) { switch (item.itemType) { ... } }` — TypeScript `switch` tanpa `default` menolak build kalau ada `itemType` baru yang belum ditangani di kedua loop (properti exhaustiveness yang sama seperti `quotaAdapters` registry Step 1). `totalAmount` diakumulasi sebagai variabel `let totalAmount = 0` yang bertambah dari `totalPrice` tiap item YANG BARU DIBUAT server-side (bukan dari payload) ditambah `sellPriceSnapshot` tiap pilgrim yang lolos `computeSellPrice()` — booking dibuat dulu dengan `totalAmount: 0`, di-`update()` di akhir transaksi setelah semua item & pilgrim selesai diproses (perlu tahu total dulu sebelum bisa ditulis, tapi row `Booking` harus ada duluan untuk FK line item). Logic harga PER TIPE tidak berubah sama sekali dari kode lama — cuma dipindah dari blok `if` terpisah ke `case` di switch yang sama.

**5c — `app/api/v1/admin/payments/[id]/confirm/route.ts`**: tambah `haji: true` ke `include`, tambah `for (const bh of booking.haji) await quotaAdapters.haji.confirm(tx, bh)` ke loop confirm — menutup celah yang baru relevan begitu Haji genuinely bookable.

**5d — Wizard**: HANYA `app/[locale]/(pilgrim)/bookings/new/payment/page.tsx` diubah — `handleConfirm()` membangun array `items: BookingItemInput[]` dari state draft yang TIDAK BERUBAH (`draft.hotelMakkah`, `draft.transports`, dst.), lalu kirim `{ ...existing fields, items, pilgrims }` tanpa `totalAmount`. `lib/booking/draft.ts` dan seluruh step wizard (dates/hotel/transport/muthowif/addons/pilgrims) TIDAK disentuh — dikonfirmasi lewat diff, bukan diasumsikan.

**Verifikasi end-to-end (curl + JWT session dibuat manual dari `JWT_SECRET` + query DB langsung, server dev nyata)**:
1. **Kombinasi hotel+transport+visa**: booking dibuat via `POST /api/v1/bookings` dengan `items: [{itemType:'hotel',...}, {itemType:'transport',...}]` + 1 pilgrim. `HotelRoomSchedule.pendingQuota` 0→1, `TransportQuota.pendingSeats` 0→1 (reserve lewat adapter tetap jalan). `booking.totalAmount` (Rp90.750.000) dikonfirmasi PERSIS SAMA DENGAN `hotel.totalPrice + transport.totalPrice + visa.sellPriceSnapshot` dihitung manual dari DB (Rp82.000.000 + Rp6.000.000 + Rp2.750.000) — closes Gap #4.
2. **Haji-only via `itemType='haji'`** (jalur yang genuinely tidak bisa diakses sebelum Step 5): `HajiProduct` test dibuat (`totalQuota=10`), booking dibuat dengan `items: [{itemType:'haji', hajiProductId, numPersons:2}]` + 2 pilgrim. `HajiProduct.pendingQuota` 0→2 (reserve jalan meski belum ada UI wizard yang pernah mengirim tipe ini). `totalAmount` (Rp195.500.000) dikonfirmasi = `bookingHaji.totalPrice` (Rp190.000.000) + jumlah `sellPriceSnapshot` 2 pilgrim (Rp5.500.000).
3. **Confirm route dengan haji** (5c): `Payment` dibuat untuk booking Haji di atas, `POST /api/v1/admin/payments/[id]/confirm` (`action:'confirm'`) dengan JWT admin → response sukses, `HajiProduct.pendingQuota` 2→0 DAN `bookedQuota` 0→2 (quotaAdapters.haji.confirm jalan), `booking.status` → `confirmed`.
4. **Self-cancel tetap jalan tanpa perubahan** (regresi check untuk Step 1-3 lewat perubahan Step 5): booking #1 di-`DELETE` → `pendingQuota`/`pendingSeats` kembali ke 0, `booking.status` → `cancelled` — mengonfirmasi `cancelBooking()` (beroperasi di relasi `booking.hotels`/`.transports`/dst., bukan `items[]` payload) tidak terpengaruh sama sekali oleh perubahan bentuk `createBookingSchema`.
5. Semua data test (2 booking, 1 payment, 1 HajiProduct, 1 user pilgrim, notification log terkait) dibersihkan setelah verifikasi.

`bun run build` 0 error di tiap sub-step (5a, 5b+5c digabung, 5d) — dijalankan terpisah, bukan sekali di akhir, sesuai SOP poin 4.

**Yang BELUM dikerjakan (Step 6-8, tetap rencana)**: checkout pendek Haji/Visa-only/Transport-only (Step 5 baru menyiapkan API/schema-nya, belum ada UI-nya), invoice generik (`lib/pdf/invoice.tsx` masih stub), dokumentasi akhir §8. Lihat §6 Step 6-8.

---

## 7.2 Verifikasi Step 6 (2026-07-25)

**Recheck sebelum eksekusi (poin 1 SOP)**: baca ulang katalog publik Visa/Transport (CTA masih ke `/register`), wizard `pilgrims/page.tsx` (visa selalu required, tidak ada mode "tanpa visa"), `lib/booking/draft.ts` (bentuk tetap, tidak ada konsep single-item), `ManifestFieldsForm.tsx` (dikonfirmasi stateless & reusable, TIDAK bergantung `DraftProvider`), `prisma/seed.ts` (belum menyentuh `ManifestFieldRequirement` sama sekali), `middleware.ts` (`PROTECTED` include `/bookings`). Semua dikonfirmasi akurat sebelum rencana Step 6 ditulis.

**Klarifikasi scope dari user (sebelum eksekusi, via pertanyaan terarah)**: dua putaran tanya-jawab mengubah scope dari rencana tertulis awal (`Haji: "pilih paket + jumlah orang"`) — user eksplisit (1) tidak ada produk yang boleh mewajibkan produk lain saat checkout (standard online-shop), dan (2) Haji dikeluarkan total dari putaran ini karena "Visa Haji" adalah konsep berbeda dari `VisaProduct` biasa dan belum waktunya disentuh. Ini mengubah Step 6a dari "opsional" jadi prasyarat wajib untuk Step 6c (Transport-only baru bisa genuinely tanpa visa kalau `visaProductId` opsional).

**6a — Decouple manifest dari `visaProductId`**: `lib/manifest/constants.ts` (baru, sentinel `productType='core'`/`productId='default'` — bukan UUID asli, sengaja human-readable supaya tidak dikira baris seed asli). 5 field core di-seed lewat `prisma/seed.ts` (bukan `bun -e` ephemeral seperti presedan Step 4 — ini konsep permanen, harus reproducible di DB manapun). `lib/validators/booking.ts`: `visaProductId` opsional, `superRefine` direstrukturisasi total — early-return `if (ids.length === 0) return` DIHAPUS (kalau dibiarkan, booking 100% tanpa visa skip semua validasi termasuk core-field wajib — dibuktikan lewat test #5 di bawah). `app/api/v1/bookings/route.ts`: blok `VisaApplication` dibungkus `if (p.visaProductId)`. 2 halaman detail booking: cabang `else` render field manifest core.

**6b — Checkout Visa-only**: `bookings/checkout/visa/page.tsx` (server component, baca `searchParams.productId`) + `VisaCheckoutForm.tsx` (client, state lokal — TIDAK pakai `draft.ts`/`DraftProvider`). Reuse penuh: `ManifestFieldsForm`, `GET /api/v1/manifest/requirements?productType=visa&productId=X` (endpoint publik existing).

**6c — Checkout Transport-only**: `bookings/checkout/transport/page.tsx` + `TransportCheckoutForm.tsx`. Reuse `GET /api/v1/catalog/transport` existing untuk pilih kendaraan. Pilgrim manifest pakai `GET /api/v1/manifest/requirements?productType=core&productId=default` — payload `pilgrims[]` TIDAK PERNAH menyertakan key `visaProductId` sama sekali (bukan string kosong).

**6d — Wiring CTA**: `(public)/visa/page.tsx` baris ~165 dan `components/shared/TransportSearch.tsx` baris ~197 — `href` dari `/register` ke `/bookings/checkout/visa?productId=${v.id}` / `/bookings/checkout/transport?tripId=${trip.id}`.

**Bug ditemukan & ditutup selama verifikasi browser** (bukan direncanakan, ditemukan lewat testing nyata): booking Transport-only pertama yang dites menampilkan "0 dari 5 dokumen wajib" (Paspor/KTP/KK/Sertifikat Vaksin/E-Tiket) — salah total untuk booking tanpa visa. Root cause: `DocumentGrid`/`PilgrimDocuments` jatuh ke konstanta `REQUIRED_DOCUMENTS` (hardcode) setiap kali prop `requirements` bernilai `undefined` — ini SUDAH ada sebelum Step 6, tapi sebelumnya dead code (setiap pilgrim SELALU punya `visaApplication`, jadi `requirementsByPilgrim.get(p.id)` tidak pernah `undefined`). Step 6a membuat kondisi ini genuinely tercapai untuk pertama kali. Fix: kedua halaman detail booking set `requirementsByPilgrim.set(p.id, [])` eksplisit di cabang `else` — `[]` truthy di JS jadi tidak memicu fallback, hasilnya nol dokumen wajib untuk pilgrim tanpa visa. Diverifikasi ulang setelah fix: "0 dari 0 dokumen wajib" tampil benar di kedua halaman.

**Insiden non-kode selama sesi ini (dicatat, sudah dikonfirmasi aman oleh user)**: `bun run db:seed` dijalankan sebagai gate untuk menambah seed core field — ternyata skrip ini juga men-deleteMany() tabel Hotel/Transport/dst. dan mereset `TransportPricing.price`/menghapus `HotelRoomSchedule` yang sudah dikonfigurasi dari sesi-sesi sebelumnya. User dikonfirmasi ini tidak masalah (data dev/test). Dicatat sebagai memory project (`project-seed-script-destructive`) supaya tidak terulang tanpa peringatan di masa depan.

**Verifikasi end-to-end** (curl + JWT session manual dari `JWT_SECRET`, DAN browser sungguhan untuk 2 halaman checkout baru — bukan cuma curl, sesuai rencana):
1. Transport-only via curl tanpa `visaProductId` sama sekali → 201, `VisaApplication` count = 0, `totalAmount` = harga transport persis.
2. Booking dengan 0-visa dan field core wajib (`fullName`) kosong → 400 "Nama Lengkap wajib diisi" (membuktikan early-return bug di §6a benar-benar hilang).
3. Booking campur (1 pilgrim visa + 1 tanpa) → hanya pilgrim bervisa dapat `VisaApplication`+kontribusi total, `requiredComponents` visa TIDAK bocor ke pilgrim lain. Render admin+pilgrim detail page → kedua nama tampil benar (bukan `'Jamaah'`).
4. **Browser sungguhan** (`bookings/checkout/visa`): isi 1 jamaah dengan produk "Visa Reguler", submit → redirect ke `/bookings/[id]`, total Rp2.500.000 cocok, nama jamaah + 3 syarat dokumen visa tampil benar.
5. **Browser sungguhan** (`bookings/checkout/transport`): pilih trip+tanggal+kendaraan (Bus Pariwisata 49, Rp6.000.000), isi 1 penumpang tanpa visa, submit → redirect sukses, total cocok, `VisaApplication` = null, dokumen wajib = 0 (setelah fix bug di atas).
6. Redirect logged-out ke `/login` dikonfirmasi untuk kedua route checkout baru (curl, 307).
7. CTA katalog publik Visa & Transport dikonfirmasi mengarah ke checkout baru dengan product/trip ID benar (curl + grep `href`, semua 2 produk visa dan 6 trip transport).
8. Semua data test dibersihkan setelah tiap sub-fase (termasuk reset `TransportQuota.pendingSeats` yang sempat orphan akibat cleanup manual via `prisma.booking.delete()` — dicatat sebagai pengingat untuk selalu pakai jalur cancel resmi kalau memungkinkan).

`bun run build` 0 error di tiap sub-fase (6a, 6b, 6c, 6d dipisah — 1 iterasi fix untuk `category: string | null` di `TransportCheckoutForm.tsx`).

**Yang BELUM dikerjakan**: Step 7 (invoice generik), Step 8 (dokumentasi akhir §8 penutup). Checkout Haji sengaja tidak dikerjakan — lihat catatan scope di atas dan `CLAUDE.md` bug list.

---

## 7.3 Verifikasi Step 7 (2026-07-25)

**Recheck sebelum eksekusi (poin 1 SOP)**: baca ulang `lib/pdf/invoice.tsx` (stub kosong 3 baris) dan `app/api/v1/bookings/[id]/invoice/route.ts` (stub, cuma `return NextResponse.json(ok(null))`) langsung — dikonfirmasi belum ada implementasi apa pun. `@react-pdf/renderer` terinstall (v3.4.4) tapi belum dipakai di mana pun. Tidak ada `invoiceNumber` di schema — `Booking.bookingCode` satu-satunya identifier unik. `getPaymentConfig()` cuma punya `businessName`/`businessWa`/`banks`. **Temuan penting**: `model BookingVisa` (relasi `Booking.visa`) TIDAK PERNAH dipakai kode manapun (grep — cuma disebut di komentar no-op `lib/quota/adapters/visa.ts`) — visa asli hidup di `BookingPilgrim.visaApplication`. Kalau invoice dibangun dari `booking.visa` alih-alih `pilgrims[].visaApplication`, baris visa akan SELALU KOSONG di setiap invoice — bug tersembunyi yang berhasil dihindari lewat recheck ini, bukan ditemukan belakangan lewat testing.

**Keputusan dikonfirmasi user sebelum eksekusi**: (1) nomor invoice = turunan `bookingCode` (`INV-${bookingCode}`), tanpa field/migrasi baru; (2) kop invoice termasuk logo (file statis `public/logo.png`, opsional — invoice tetap render tanpa logo kalau file belum ada). Keputusan tambahan yang diambil tanpa bertanya (risiko rendah, reversibel): baris Discount/Tax dihilangkan total dari tabel (platform tidak punya konsep itu di schema manapun — baris Rp0 permanen cuma UI palsu); alamat+telepon perusahaan lewat env var baru (`NEXT_PUBLIC_BUSINESS_ADDRESS`, reuse `NEXT_PUBLIC_BUSINESS_WA`); invoice HANYA endpoint PDF download, tidak ada halaman preview HTML terpisah.

**Insiden ditemukan saat eksekusi (bukan diprediksi rencana)**: `@react-pdf/renderer@3.4.4` **crash** (`TypeError: undefined is not an object (evaluating 'q.hasOwnProperty')` — internal React reconciler) saat dipanggil dari script test pertama. Root cause: peer dependency `@react-pdf/renderer` v3.x cuma mendukung React 16-18, project ini React 19.2.6. Fix: upgrade ke v4.5.1 (peer dep resmi mendukung React 19) via `bun add @react-pdf/renderer@^4.5.1` — bukan downgrade React (non-negotiable stack), bukan workaround, upgrade dependency yang genuinely diperlukan supaya fitur ini bisa berjalan sama sekali.

**7a — `lib/pdf/invoiceData.ts`**: normalisasi 7 line-item type + `getPaymentConfig()` +`businessAddress`. `balanceDue` = 0 kalau ada `Payment.status='confirmed'`, else `totalAmount`. Status badge di-map dari `Booking.status` (5 nilai enum, termasuk `payment_review` yang sempat terlewat draf awal, ditambahkan setelah cek `enum BookingStatus` langsung).

**7b — `lib/pdf/invoice.tsx`**: layout kop (logo opsional dari `public/logo.png` via `fs.existsSync`)+nama/alamat/telp perusahaan, Bill To, status badge berwarna (UNPAID amber/MENUNGGU KONFIRMASI biru/LUNAS hijau/DIBATALKAN abu-abu), tabel item, Subtotal/Total/Sisa Tagihan (tanpa Discount/Tax), terms bank. Diverifikasi visual (bukan cuma "tidak error") — generate PDF dummy via `bun -e`, dibaca langsung sebagai gambar: 2 iterasi perbaikan ditemukan lewat cek visual (kolom Item/Deskripsi terlalu rapat tanpa gap → tambah `paddingRight`; warna "Sisa Tagihan Rp 0" merah waktu lunas terlihat seperti alarm padahal itu kabar baik → warna kondisional hijau kalau `balanceDue === 0`).

**7c — Route handler**: auth pola sama persis `pilgrims/[bookingId]/[pilgrimId]/documents/route.ts` (`getSession()`+`ADMIN_ROLES`+cek `booking.userId`). Bug tipe ditemukan saat build: Node `Buffer` dari `renderToBuffer()` tidak langsung assignable ke `BodyInit`/`BlobPart` NextResponse — fix `new Blob([Uint8Array.from(pdfBuffer)])`.

**7d — Wiring UI**: tombol "Unduh Invoice" (anchor biasa, `target="_blank"`) di header halaman detail booking pilgrim (di sebelah badge status) dan admin (di sebelah badge status, gaya `admin-*` utility class existing). **Bug ditemukan lewat verifikasi PDF sungguhan** (bukan direncanakan): label visa jadi "Visa Visa Non-Hotel Umroh — ..." (kata "Visa" dobel) karena nama produk sudah mengandung kata "Visa" — fix: regex check `/visa/i.test(productName)` sebelum menambah prefix "Visa ".

**Verifikasi end-to-end** (curl + JWT session manual + browser sungguhan + baca PDF langsung sebagai gambar, server dev nyata):
1. Booking test (transport Rp6.000.000 + visa Rp2.750.000) → unduh invoice via curl → `200`, `Content-Type: application/pdf`, `Content-Disposition: inline; filename="INV-....pdf"` benar. PDF dibaca langsung (bukan cuma cek ukuran file) — nomor invoice, item, subtotal, total (Rp8.750.000) semua cocok persis data booking.
2. Payment `status='confirmed'` + `Booking.status='confirmed'` dibuat manual → unduh ulang invoice yang SAMA → badge berubah "LUNAS" (hijau), "Tanggal Lunas" muncul menggantikan "Jatuh Tempo", Sisa Tagihan "Rp 0" hijau (bukan merah), Total tetap Rp8.750.000 (benar — Total ≠ Sisa Tagihan setelah lunas).
3. Auth: request tanpa cookie → 401; JWT pilgrim LAIN (bukan pemilik booking) → 401; JWT admin → 200 (bisa akses booking siapa pun).
4. Browser sungguhan: tombol "Unduh Invoice" dikonfirmasi ter-render dengan `href` benar (`/api/v1/bookings/[id]/invoice`) di halaman detail admin.
5. Semua data test (booking, payment, 2 user pilgrim, notification log) dibersihkan, termasuk reset `TransportQuota.pendingSeats` yang sempat orphan (pengingat sama seperti §7.2 — cleanup manual `prisma.booking.delete()` tidak melepas kuota, harus di-reset manual).

`bun run build` 0 error di tiap sub-fase (7a/7b/7c/7d terpisah, plus 1 iterasi fix upgrade `@react-pdf/renderer` sebelum 7b bisa lanjut).

**Yang BELUM dikerjakan**: Step 8 (dokumentasi akhir §8 penutup) — satu-satunya sisa dari 8 step total.

---

## 8. Keputusan Arsitektur

| # | Keputusan | Alasan |
|---|-----------|--------|
| 1 | Adapter registry (`Record<BookingItemType, QuotaAdapter>`) sebagai lapisan orkestrasi tunggal | TypeScript memaksa kelengkapan secara statis — kelas bug "satu tipe terlupa di satu titik" (persis penyebab semua gap kritis yang ditemukan) menjadi mustahil, bukan cuma didisiplinkan manual |
| 2 | `cancelBooking()` satu fungsi dipakai self-cancel & auto-cancel cron | Dua implementasi terpisah untuk hal yang sama adalah sumber gap #2 (`arsitektur-umroh.md`) — satu fungsi menghilangkan kemungkinan divergensi |
| 3 | `totalAmount` dihitung ulang server-side dari item yang direservasi, bukan dari payload klien | Menutup Gap #4; server sudah punya semua `unitPrice` dari data yang sama yang dipakai reservasi kuota, tidak ada alasan mempercayai angka dari klien |
| 4 | Refund record dibuat otomatis di dalam `cancelBooking()`, bukan langkah terpisah yang bisa dilupakan | Gap #3 terjadi justru karena ini "langkah terpisah" yang tidak pernah ditulis — menyatukannya ke satu fungsi wajib menghilangkan opsi untuk lupa |
| 5 | Opsi B (adapter di atas tabel existing) dipilih atas Opsi A (tabel polimorfik tunggal) untuk saat ini | Menutup semua gap kritis dengan risiko jauh lebih rendah — tidak ada migrasi data, tidak breaking ke 3 dokumen arsitektur produk yang sudah ditulis |
| 6 | Katering tetap tanpa kuota (no-op adapter); TourPackage TIDAK no-op — transport (included) & hotel (user_choice) sudah reservasi kuota nyata | Sesuai model bisnis saat ini (kapasitas Katering tidak dibatasi sistem) — no-op eksplisit lebih baik dari "lupa ditambahkan"; TourPackage sudah py kuota nyata sejak `docs/arsitektur-ziarah.md` §12.6, bukan hipotesis |
| 7 | `BookingItem` polimorfik (Opsi A) didokumentasikan sebagai visi, bukan langkah wajib | Menghindari over-engineering sebelum ada kebutuhan nyata (produk yang benar-benar tidak cocok pola tabel-per-tipe) |
| 8 | Dokumen (KTP/Paspor/dst.) jadi komponen universal (`DocumentRequirement`, `docs/arsitektur-dokumen.md`), bukan monopoli Visa | User eksplisit — pola sama infrastruktur harga universal; produk lain (Paket Umroh, Haji, Flight) realistisnya juga punya syarat dokumen sendiri |
| 9 | Manifest (`BookingPilgrim`) tidak dibatasi jumlah oleh aturan bisnis — `totalPilgrims.max(500)` dihapus | Analogi booking kereta/pesawat — satu orang bisa booking untuk siapa saja, jumlah tidak wajar dibatasi angka bisnis sembarang |
| 10 | Visa tidak lagi wajib 1:1 per pilgrim — `VisaApplication` cuma dibuat untuk pilgrim yang benar-benar di-link ke item `itemType='visa'` | Visa sekarang produk opsional di keranjang (§1.5/§1.6.3), bukan lagi field wajib yang otomatis berlaku ke semua orang di booking |
| 11 | Model `BookingPilgrim` TIDAK di-rename ke istilah lebih generik meski konsepnya meluas | Nama sudah menggambarkan >95% kasus pakai nyata; rename model inti menyentuh puluhan file untuk manfaat kosmetik semata — bisa direvisit kalau ada kasus nyata yang benar-benar butuh |
| 12 | Kekhususan booking per-produk (jemput/antar Transport, dst.) TIDAK didesain detail di rencana ini | User eksplisit "itu nanti" — cukup dipastikan Opsi B (tabel per-tipe) sudah mendukung kolom spesifik-tipe (sudah terbukti, `BookingTransport.pickupDetail` dkk.), bukan pekerjaan baru sekarang |
| 13 | Form per-orang (manifest) 100% custom diatur admin, termasuk field paling dasar (Nama, No. HP) — bukan cuma field tambahan | User eksplisit memilih opsi ini atas alternatif "field dasar baku + tambahan configurable" — `BookingPilgrim` kolom baku diganti `ManifestFieldRequirement` (`docs/arsitektur-manifest.md`) |
| 14 | Tetap ada mekanisme "peran field" (`role`) opsional di `ManifestFieldRequirement` meski semua field custom | Sistem (notifikasi WA, dashboard, invoice) tetap perlu tahu field mana berisi nomor HP/nama TANPA hardcode `fieldKey` yang bebas diatur admin — solusi yang mempertahankan fleksibilitas penuh sambil tetap memberi sistem cukup informasi untuk berfungsi |
| 15 | `@react-pdf/renderer` di-upgrade v3.4.4→v4.5.1 (Step 7) | v3.x peer dep cuma React 16-18, project ini React 19.2.6 — crash nyata saat render (`ReactCurrentDispatcher` internal error), bukan downgrade React (non-negotiable), upgrade dependency yang genuinely diperlukan |
| 16 | Nomor invoice = turunan `Booking.bookingCode` (`INV-${bookingCode}`), bukan field/migrasi baru | Konsisten prinsip 1 booking = 1 invoice; `bookingCode` sudah unik dan human-readable, tidak ada kebutuhan nyata untuk penomoran independen (reissue/credit note) saat ini |
| 17 | Baris Discount & Tax dihilangkan total dari tabel invoice (bukan ditampilkan Rp0) | Platform tidak punya konsep diskon/pajak di schema manapun — baris kosong permanen cuma UI palsu tanpa fungsi, bukan kelengkapan |
| 18 | Line item Visa di invoice diambil dari `pilgrims[].visaApplication`, BUKAN relasi `booking.visa` (`BookingVisa`) | `BookingVisa` tidak pernah dipakai kode manapun (dead model) — kalau dipakai, baris visa invoice akan selalu kosong; ditemukan lewat recheck sebelum eksekusi (poin 1 SOP), bukan bug yang lolos ke produksi |

---

## 9. Referensi Silang

- **`docs/arsitektur-dokumen.md`** (baru, 2026-07-22) — komponen dokumen universal, prasyarat langsung untuk §1.6/§6 Step 4, baca berdampingan
- **`docs/arsitektur-manifest.md`** (baru, 2026-07-22) — komponen form-orang universal (`ManifestFieldRequirement`, repeater UI), prasyarat langsung untuk §1.6.2/§6 Step 4, baca berdampingan
- Gap yang mendorong rencana ini: `docs/arsitektur-umroh.md` §7 (Gap #1-#4, dikonfirmasi ulang masih terbuka via audit 2026-07-22, lihat §0), `docs/arsitektur-muthowif.md` §7 Gap #1 (DITUTUP 2026-07-20)
- Preseden pola polimorfik: `PackageItem` — **CATATAN 2026-07-22: model ini sudah DIHAPUS** saat refactor `docs/arsitektur-paket-umroh.md` (Package/PackageItem generik yang tidak pernah dipakai kode manapun diganti variable harga 3-mode). Preseden historisnya tetap valid sebagai justifikasi konsep (pola `productType`+`productId` polimorfik terbukti diterima di proyek ini), tapi jangan merujuk ke schema.prisma dengan nomor baris itu lagi — modelnya sudah tidak ada.
- Modul produk yang belum py adapter sama sekali by design (bukan gap): Flight (`docs/arsitektur-tiket-pesawat.md` §2.1 — integrasi wizard sengaja di luar scope), Package/Paket Umroh (`docs/arsitektur-paket-umroh.md` — sengaja tanpa booking sampai dokumen ini dieksekusi)
- **Status final (2026-07-25)**: seluruh 8 step dieksekusi & diverifikasi — dokumen ini SEKARANG SOURCE OF TRUTH as-built untuk booking engine universal (Umroh, Package/Paket Umroh, Visa-only, Transport-only), bukan lagi rencana murni. Satu pengecualian eksplisit: checkout Haji (bagian dari Step 6) sengaja TIDAK dikerjakan — API/skema sudah siap (`itemType='haji'` sejak Step 5), tapi tidak ada UI/wizard yang mengirimnya. Kalau modul Haji akhirnya dikerjakan, dokumen ini TETAP jadi rujukan pola (adapter registry, `items[]`, manifest core) — tapi jangan asumsikan pola manifest/visa existing otomatis cocok untuk Haji (butuh "Visa Haji" tersendiri, lihat `docs/arsitektur-umroh.md` §7 Gap #1 dan `CLAUDE.md` bug list).

---

## 10. Wizard 7-Langkah Lama Dihapus Total (2026-07-25)

**Keputusan:** setelah Step 1-8 selesai, user eksplisit minta wizard booking 7-langkah lama (`app/[locale]/(pilgrim)/bookings/new/*`) dihapus TOTAL dari codebase — bukan dinonaktifkan/dibiarkan sebagai dead code — supaya lebih mudah mengembangkan booking engine baru (checkout pendek per-produk, pola Step 6). Dikonfirmasi lewat pertanyaan langsung sebelum eksekusi: user paham dan menerima konsekuensinya.

**File dihapus** (recheck lengkap dulu sebelum hapus — grep seluruh repo untuk import/reference, bukan asumsi):
- `app/[locale]/(pilgrim)/bookings/new/` (seluruh direktori — `layout.tsx` + 7 step `page.tsx`: dates/hotel/transport/muthowif/addons/pilgrims/payment)
- `lib/booking/draft.ts` + `lib/booking/DraftProvider.tsx` (state wizard)
- `components/booking/PriceSidebar.tsx` + `components/booking/WizardShell.tsx` (eksklusif dipakai wizard)

**TIDAK dihapus** (dikonfirmasi dulu genuinely independen sebelum hapus dilakukan): `lib/booking/cancel.ts` (dipakai `DELETE /api/v1/bookings/[id]` + cron, tidak terkait draft/wizard), `app/api/v1/bookings/route.ts` (backend generik, dipakai checkout baru juga, tidak ada logic khusus wizard), `components/booking/ManifestFieldsForm.tsx`/`VisaCheckoutForm.tsx`/`TransportCheckoutForm.tsx` (checkout pendek Step 6, dikonfirmasi tidak import apa pun dari draft/DraftProvider/PriceSidebar/WizardShell).

**2 titik link mati diupdate** (bukan dihapus — nav/dashboard tetap butuh entry point): `app/[locale]/(pilgrim)/layout.tsx` nav "Buat Booking" dan `app/[locale]/(pilgrim)/dashboard/page.tsx` 2× CTA — semua sebelumnya ke `/bookings/new/dates`, sekarang ke `/${locale}` (homepage publik, hub katalog existing yang sudah link ke `/hotels`/`/muthowif`/dst.).

**KONSEKUENSI PENTING, dicatat eksplisit supaya tidak dikira bug**: wizard ini SEBELUMNYA satu-satunya cara booking paket kombinasi (hotel+transport+muthowif+catering+visa jadi satu) DAN satu-satunya cara booking Hotel-only/Muthowif-only/Catering-only/TourPackage-only. Setelah dihapus, **HANYA Visa-only dan Transport-only** (checkout pendek Step 6) yang masih punya jalur booking lewat browser sama sekali. Kelima kapabilitas lain (kombinasi + 4 produk single) **TIDAK BISA dilakukan lewat UI apa pun** sampai checkout pengganti per-produk dibangun — ini keputusan sadar, bukan regresi yang terlewat.

**Verifikasi**: `bun run build` 0 error. Grep ulang seluruh repo untuk `bookings/new`, `lib/booking/draft`, `DraftProvider`, `PriceSidebar`, `WizardShell` setelah penghapusan — nol referensi tersisa (1 komentar di `VisaCheckoutForm.tsx` yang menyebut file lama diupdate supaya tidak menyesatkan). Browser: dashboard nav dan CTA dikonfirmasi mengarah ke homepage (bukan 404), homepage render normal dengan link ke semua kategori katalog. Regresi check: checkout Visa-only (Step 6) dikonfirmasi tetap berfungsi normal setelah penghapusan.

---

## 11. Recheck 2026-10-26 (pra-fase "Checkout Universal") — dokumen vs kode aktual

> Dilakukan sesuai SOP langkah 1 sebelum merencanakan checkout browser untuk semua produk. Dibaca langsung: `lib/validators/booking.ts`, `app/api/v1/bookings/route.ts` (+ `[id]` GET/DELETE, `[id]/payment/bukti`), `admin/payments/[id]/confirm`, `lib/booking/cancel.ts`, `lib/quota/{index,adapters/*}`, `lib/utils/cancellationPolicy.ts`, skema `Booking*`/`Payment`/`Refund`, halaman checkout & katalog publik, halaman detail booking. **Kesimpulan: §0–§10 akurat soal apa yang DIBANGUN, tetapi beberapa klaim "ditutup/tidak pernah dari client" ternyata tidak berlaku penuh, dan "mesin universal" belum universal.** Dikelompokkan: (A) celah integritas/keamanan harga & uang, (B) arsitektur mesin, (C) cakupan produk/UI.

**Catatan konteks (arahan pemilik 2026-10-26):** data dev boleh dihapus; yang dikejar adalah arsitektur mesin dan arsitektur migrasi yang benar — jadi rencana berikutnya tidak dibatasi menjaga skema/data lama.

### A. Celah integritas (klaim di §7.1 "Gap #4 ditutup" tidak sepenuhnya benar)

| # | Sev | Temuan (file:baris) | Dampak |
|---|-----|--------------------|--------|
| A1 | **High** | **Harga Katering dipercaya dari klien**: `bookingItemSchema` catering memuat `totalPrice: z.number().positive()` dan route memakainya apa adanya (`bookings/route.ts` case `catering`) — `CateringOption.pricePerPerson{Regular,Ramadan,Hajj}` tidak pernah dipakai | Pembeli menulis harga berapa pun (Rp1) |
| A2 | **High** | **Hotel: `nights`, `checkIn`, `checkOut` dari klien, tak saling terkait dan tak dicek terhadap periode** — harga = `schedule.price × nights × numRooms` dengan `nights` dari klien; tanggal tak harus dalam `HotelPricePeriod` | Menginap 10 malam, bayar 1 malam; booking di luar periode berharga |
| A3 | **High** | **Kebijakan refund memakai `departureDate` yang dikirim klien** (`cancel.ts:26` → `cancellationPolicy.ts`): >60 hari ⇒ 100%. Untuk keranjang non-trip tanggal itu sembarang (form checkout mengarang `return=departure`, `season='regular'`). **Dan** refund dihitung dari `totalAmount` padahal self-cancel hanya boleh sebelum `confirmed` (belum ada uang diterima) → baris `Refund(pending)` untuk uang yang tak pernah masuk | Refund palsu tercatat; tak ada jalur refund untuk booking yang SUDAH dibayar (tak ada pembatalan oleh admin) |
| A4 | Med | **Hanya Haji yang memeriksa `isActive` saat reserve** (`adapters/haji.ts:16`). Hotel (schedule/periode/hotel), Transport (kuota/harga/trip/kendaraan), Katering (opsi), Paket Ziarah (hanya `pricing` aktif di breakdown, bukan paketnya) bisa dipesan walau dinonaktifkan admin | Produk yang ditarik tetap terjual (sama kelas SEC-66, hanya Haji yang ditutup) |
| A5 | Med | **Konflik transaksi `Serializable` jadi 500**: tidak ada penanganan `P2034`/retry (`grep` nihil); konvensi API menjanjikan 409 untuk "quota race" | Pemesanan bersamaan pada kuota sama gagal dengan "Internal server error" |
| A6 | Med | **Pembayaran tak terhubung ke total**: `bukti` membuat `Payment.amount = 0` ("admin will verify"); konfirmasi admin tidak membandingkan nominal dengan `totalAmount`; satu bukti = booking langsung `payment_review` | Booking `confirmed` tanpa bukti nominal sesuai; tak ada pembayaran sebagian/ganda |
| A7 | Med | **Kuantitas tak koheren**: `totalPilgrims` (klien) ≠ `pilgrims.length`; `numPeople`/`numPassengers`/`numPersons`/`numRooms` per item independen; `BookingHotel.numGuests = data.totalPilgrims` (klien). Haji `numPersons` tak terhubung ke manifest. Muthowif `numDays` tak dicocokkan dengan `startDate..endDate` | Data manifest vs kuota vs harga bisa saling bertentangan |
| A8 | Low | `bookingType`/`groupName` diterima tetapi **tidak disimpan** (tak ada kolom); `season` klien disimpan tetapi **tak dibaca siapa pun** (harga sudah flat) | Field palsu di kontrak API |
| A9 | Low | Tak ada idempotensi (klik ganda = dua booking; hanya `bookingCreateUser` rate limit) | Booking & penahanan kuota ganda |

### B. Arsitektur mesin — "universal" baru sebagian

- **B1 (struktural, terpenting).** Registry `quotaAdapters` hanya mencakup *kuota*. Orkestrasi lain mengenumerasi relasi sendiri-sendiri: union validator, `switch` reserve, `switch` harga/persist (`route.ts`), loop confirm (`payments/[id]/confirm`), loop release + tipe `CancellableBooking` (`cancel.ts`), `include` di GET/DELETE/cron/detail pilgrim/detail admin, normalisasi `invoiceData`. Menambah satu tipe produk = menyentuh ≥ 9 tempat dan kompilator tidak memaksa semuanya. **Bukti kelas bug itu hidup:** Haji ada di reserve/confirm/cancel tetapi **tidak ada** di `include` GET API, halaman detail pilgrim, dan detail admin (`grep haji` = 0) — pembeli Haji tidak melihat itemnya.
- **B2.** Skema per-tipe (`BookingHotel`, `BookingTransport`, …) memaksa setiap konsumen (invoice, detail, admin, laporan, refund per item, status per item) menulis 8 cabang. Tak ada status/harga/jumlah per item yang seragam; `BookingVisa` dan `BookingService` model mati; `BookingFlight` ada tetapi tak pernah diisi.
- **B3.** Atribut tingkat-booking (`departureDate`, `returnDate`, `season`) diperlakukan wajib dan dikirim klien, padahal bagi keranjang campur tanggal layanan adalah milik **item**; kebijakan refund/pengingat/lifecycle seharusnya diturunkan server dari item.
- **B4.** Tidak ada konsep keranjang di klien; setiap checkout membangun payload sendiri (`VisaCheckoutForm`, `TransportCheckoutForm`; `season:'regular'`, `return=departure` dikarang di klien).

### C. Cakupan produk dan UI

- Checkout browser hanya Visa dan Transport. CTA Hotel, Muthowif, Paket Ziarah (`tours`), Paket Umroh (`packages`), Haji menuju `/register`; Katering tak punya CTA.
- **Paket Umroh (`Package`) dan Tiket Pesawat tidak punya jalur booking sama sekali** (bukan anggota union; `BookingFlight` kosong) — keduanya sengaja ditunda di dokumen lama (§0).
- Stub mati: `components/booking/{DocumentUploader,PilgrimForm}.tsx` (`return null`).

### D. Yang DIKONFIRMASI benar (tidak berubah)
Registry kuota lengkap 7 tipe; reserve→persist→confirm→release konsisten untuk Hotel/Transport/Muthowif/Paket Ziarah/Haji; `cancelBooking()` satu fungsi untuk self-cancel dan cron; harga Hotel(per malam)/Transport/Muthowif/Paket Ziarah/Haji/Visa dihitung server dari referensi; manifest `fieldValues` + `visaProductId` opsional; invoice PDF dari 7 tipe; `Serializable` dipakai; kontak wajib sebelum booking; rate limit pembuatan booking.

