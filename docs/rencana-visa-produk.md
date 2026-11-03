# Rencana — Visa sebagai produk utama di booking

> Status: **V1 SELESAI 2026-11-03 (#106), V2 SELESAI 2026-11-04 (#107), V3 SELESAI 2026-11-04 (disetujui pemilik: "Setuju, mulai V3"). V4 butuh rancangan rinci + persetujuan sendiri; V5 = dokumentasi.**
> Koreksi pemilik: *"KITA JUALAN VISA"* — visa adalah produk, sejajar tiket/hotel/transport, bukan tambahan per jamaah. Dasar: audit kode 2026-11-03
> dan audit ulang 2026-11-04 (fakta di §1). Sesudah selesai, isi dokumen ini dipindah ke `docs/arsitektur-booking-engine-v2.md` dan `docs/arsitektur-visa.md` (V5).

## 0. Model bisnis (kata pemilik)

1. **Visa adalah produk yang kita jual.** Di form booking ia dipilih dari dropdown produk yang sama dengan produk lain. *(V2 — selesai)*
2. **Visa melekat ke JAMAAH, bukan ke pelanggan.** Order visa 4 jamaah = 4 visa, satu per orang; order 1 = 1. *(sudah begitu sejak awal; V2 menampilkannya sebagai baris)*
3. **Admin menentukan sendiri, di produk visa, produk apa saja yang WAJIB dibeli bersama visa itu** — daftar centang, sama seperti centang dokumen:
   Tiket pesawat · Hotel Makkah · Hotel Madinah · Transportasi · Muthowif · Wisata (Paket Ziarah) · Katering.
   - Tidak ada yang dicentang = **visa stand alone** ("Visa only"; contoh: "Visa BRN").
   - Ada yang dicentang = **Visa plus**: saat bertransaksi pembeli WAJIB memuat semua yang dicentang, bebas memilih produk mana yang cocok
     (hotel Makkah yang mana, transport yang mana — dipilih admin di form booking atau pembeli saat checkout).
   - Kata pemilik: *"lebih simple dan dinamis, dari pada kita tentukan hanya hotel saja"*.
4. **Dokumen syarat diatur admin per produk** (dinamis, bisa ditambah/dikurangi), lalu pembeli melengkapinya **untuk setiap jamaah**. Bukti booking hotel/tiket dari luar
   adalah dokumen biasa yang dicentang admin bila perlu — **tidak ada aturan otomatis** (V3 lama "bukti booking otomatis terpenuhi" DIBATALKAN pemilik 2026-11-04).
5. Selain Visa, **Paket Umroh dan Haji juga terikat dokumen** (V4).

## 1. Kondisi kode sekarang (audit ulang 2026-11-04, `main` sesudah #107)

| Hal | Sekarang | Sumber |
|---|---|---|
| Daftar komponen wajib | Hanya 3 jenis: `flight`, `hotel` (kota apa saja), `transport` (+ filter kategori/trip opsional); maks 3, tiap jenis sekali | `lib/validators/visa.ts:5-16` |
| Model penjualan | Turunan: kosong = Visa only, berisi = Visa plus (V1) | `lib/validators/visa.ts` `visaSalesModel` |
| Penilai aturan (murni) | `evaluateVisaRules(visas, coverage, allowVisaWithoutBundle)`; `BookingCoverage = { flight, hotel, transports[] }` | `lib/booking/rules.ts:7-71` |
| Pengumpul cakupan booking | `bookingCoverage`: item mandiri + isi Paket Umroh (`included` atau pilihan `user_choice`) + kendaraan/hotel Paket Ziarah (hotel hanya bila benar-benar ditagih, SEC-124) | `lib/booking/ruleContext.ts:9-36` |
| Cakupan Paket Umroh | `coverage: { flight, hotel, transport }` — hotel Makkah/Madinah DIGABUNG jadi satu boolean; muthowif/katering tidak dicatat | `lib/booking/packageItem.ts:28,94-105` |
| Visa yang dievaluasi | Visa milik jamaah + visa PILIHAN pelanggan di paket (`user_choice`, SEC-125); visa `included` paket tidak (bundel kurasi admin) | `ruleContext.ts:38-50` |
| Kota hotel | `Hotel.city` = enum `makkah`/`madinah` (divalidasi di route admin) | `app/api/v1/admin/products/hotels/route.ts:12` |
| Jenis item booking | `hotel`, `transport`, `muthowif`, `catering`, `tourPackage`, `haji`, `flight`, `package` | `lib/validators/booking.ts` |
| Pelonggaran per pelanggan | `User.allowVisaWithoutBundle` (pelanggaran jadi peringatan, bukan tolak); penulis `lib/customers/bookingPolicy.ts` (+ jejak `settings_audit`), route `admin/customers/[id]/policy`, saklar `VisaPolicyToggle`; dibaca di `ruleContext.ts`, `query.ts`, halaman draf | 14 berkas (grep `allowVisaWithoutBundle`) |
| Syarat dokumen | `REQUIREMENT_OWNERS` hanya `visa`; jamaah booking dinilai dari visa miliknya | `lib/documents/requirements.ts:20-26`; `lib/pilgrims/review.ts:83`; `bookingLink.ts:253` |
| Data dev | 2 produk visa, keduanya `requiredComponents = []`; 0 pelanggan dengan pelonggaran aktif | psql 2026-11-04 |

## 2. Rancangan V3 — "Wajib dibeli bersama visa ini" (daftar centang) + hapus pelonggaran per pelanggan

### 2.1 Jenis komponen (satu daftar, satu tempat)
`lib/validators/visa.ts` — `requiredComponentSchema` menjadi:

| `type` | Label di editor | Terpenuhi bila booking memuat… |
|---|---|---|
| `flight` | Tiket pesawat | item `flight`, atau tiket Paket Umroh (`included` / dipilih) |
| `hotel_makkah` | Hotel Makkah | item `hotel` berkota `makkah`; hotel Makkah Paket Umroh; hotel Paket Ziarah berkota `makkah` yang ditagih |
| `hotel_madinah` | Hotel Madinah | idem untuk `madinah` |
| `transport` | Transportasi (+ filter kategori/rute opsional — dipertahankan apa adanya) | item `transport`; kendaraan Paket Umroh/Paket Ziarah |
| `muthowif` | Muthowif | item `muthowif`; muthowif `included` Paket Umroh |
| `tour` | Wisata (Paket Ziarah) | item `tourPackage` |
| `catering` | Katering | item `catering`; katering Paket Umroh (`included` / dipilih) |

- Tetap: tiap jenis paling banyak sekali; `.strict()`; model penjualan tetap TURUNAN (kosong = Visa only).
- **Tidak masuk daftar:** Haji (visa Haji konsep tersendiri — CLAUDE.md), Paket Umroh sebagai syarat (paket sudah membawa komponennya; isinya dihitung lewat tabel di atas), Visa.
- Jenis `hotel` lama DIHAPUS dari skema. Data lama berisi `{type:'hotel'}` dibaca `parseRequiredComponents` sebagai tidak sah → booking ditolak (fail-closed, perilaku yang sudah ada). Migrasi data (§2.5) mengubahnya lebih dulu.

### 2.2 Penilai aturan
- `BookingCoverage` diperluas: `{ flight, hotelCities: ('makkah'|'madinah')[], transports[], muthowif, tour, catering }`; `satisfied`/`describe` per jenis di `rules.ts` (tetap murni, tetap satu tempat).
- `bookingCoverage` (`ruleContext.ts`) membaca kota hotel item mandiri (`hotelRoomSchedule → period → hotel.city`) dan kota hotel Paket Ziarah yang ditagih (syarat SEC-124 tetap).
- `PackageResolved.coverage` (`packageItem.ts`) dipecah: `hotelMakkah`/`hotelMadinah` terpisah + `muthowif` + `catering` (dengan aturan sama: `included` atau `user_choice` yang benar-benar dipilih).
- Pesan pelanggaran: "Visa X mewajibkan hotel Makkah dalam booking yang sama".

### 2.3 Hapus pelonggaran per pelanggan (`allowVisaWithoutBundle`)
Prinsip pemilik: aturan visa ditentukan PRODUK, bukan pelanggan. Pelanggan yang tak perlu tiket/hotel dijualkan produk Visa only.
- Dihapus: kolom `User.allowVisaWithoutBundle` (migrasi kontraksi, fail-closed: batal bila masih ada baris `true`), `lib/customers/bookingPolicy.ts`,
  route `PUT admin/customers/[id]/policy`, `VisaPolicyToggle.tsx` + bagiannya di halaman pelanggan, field di `query.ts`/validator pelanggan, catatan di halaman draf.
- `RuleViolation.severity` dihapus — setiap pelanggaran menolak booking (tidak ada lagi "peringatan").
- Jejak lama di `settings_audit` (entity `customer_policy`) TIDAK dihapus (append-only).
- Dokumen yang menyebut pelonggaran ikut dikoreksi di V5 (`arsitektur-booking-engine-v2.md` D5/§4.1/§10.2, CLAUDE.md ringkasan Fase 4).

### 2.4 Antarmuka
- **Editor produk visa** (`products/visa/[id]/RulesTab.tsx`): pilihan "Model penjualan" (Visa only / Visa plus) tetap; di bawahnya daftar centang **"Wajib dibeli bersama visa ini"** (7 jenis, ikon Lucide, gaya sama dengan centang dokumen). Filter transport muncul hanya bila Transportasi dicentang. Visa plus tanpa centang = kembali Visa only (sama seperti V1).
- **Lencana** di header editor dan daftar produk visa: "Visa only" / "Visa plus · 3 komponen" (daftar lengkap di ringkasan editor, supaya lencana tidak memanjang).
- **Form booking admin** (draf + revisi): panel pelanggaran yang ada menampilkan tombol "tambah baris …" untuk setiap jenis yang kurang; untuk Hotel Makkah/Madinah, baris hotel baru membuka daftar hotel yang tersaring ke kota itu.
- **Checkout pendek jamaah** (`/bookings/checkout/visa`): checkout ini hanya memuat visa, jadi produk Visa plus akan ditolak server (422, pesan jelas). Katalog publik visa menampilkan lencana model dan, untuk Visa plus, tombol "Hubungi kami" sebagai ganti "Pesan" — sampai front-end booking v2 (Fase 11 engine v2) membawa keranjang lengkap.

### 2.5 Migrasi
1. Data `visa_products.requiredComponents`: `{type:'hotel'}` → `{type:'hotel_makkah'}` + `{type:'hotel_madinah'}` (makna lama "hotel apa saja" diperketat menjadi kedua kota — dicatat di decisions; di dev tak ada data begitu). Diuji pada DB sementara.
2. Kontraksi kolom `users.allowVisaWithoutBundle` (fail-closed, lihat §2.3).

### 2.6 Uji (selesai bila)
- Tabel uji murni `rules.ts`: tiap jenis × (ada / tidak ada / lewat Paket Umroh `included` / lewat pilihan `user_choice` / lewat Paket Ziarah), hotel kota salah tak memenuhi, data lama `hotel` tidak sah → ditolak.
- `test-booking-engine-core*`: pelonggaran dihapus, uji migrasi kolom; uji migrasi data `hotel`.
- Penemu sumber: tak ada lagi rujukan `allowVisaWithoutBundle` di `app/`/`lib/`.
- Browser (artefak produksi, DB sementara): centang Hotel Makkah + Muthowif → booking tanpa keduanya ditolak dengan tombol tambah; dengan hotel Madinah saja tetap ditolak; lengkap → terbit; halaman pelanggan tanpa saklar.
- `bun run build` 0 error, security review (route dihapus, migrasi kontraksi).

## 3. V4 — Dokumen syarat untuk Paket Umroh dan Haji (rancangan rinci menyusul, butuh persetujuan sendiri)

Arah pemilik: produk Visa, Haji, dan Paket Umroh terikat dokumen; admin memilih dokumennya saat membuat produk; pembeli melengkapinya per jamaah.
Sebelum dirancang rinci, wajib audit ulang modul Paket Umroh dan Haji (SOP langkah 1). Pertanyaan yang akan dijawab di rancangan V4:
- Jamaah Paket Umroh yang paketnya memuat visa: syaratnya = gabungan syarat paket + syarat visa paket (tanpa dobel jenis dokumen yang sama)?
- Haji: syarat dokumen Haji berdiri sendiri — tanpa memakai `visaProductId` Umroh (CLAUDE.md: "Visa Haji" konsep terpisah, belum ada).
- Yang sudah tersedia untuk dipakai ulang: `REQUIREMENT_OWNERS` (entri registry baru), `RequirementsEditor`, `evaluateCompleteness`, pemeriksaan jamaah (`lib/pilgrims/review.ts`) — perlu diubah dari "syarat dari visa jamaah" menjadi "syarat dari semua produk yang memuat jamaah itu".

## 4. Fase (satu PR per fase)

| Fase | Isi | Status |
|---|---|---|
| V1 | Editor produk visa: pilihan "Model penjualan" (only/plus) | ✔ 2026-11-03 (#106) |
| V2 | Form booking (draf + revisi): baris Visa di `ItemRows`, kelompok ↔ slot jamaah | ✔ 2026-11-04 (#107) |
| V3 | Daftar centang "Wajib dibeli bersama visa ini" (7 jenis, §2.1–2.2) + hapus pelonggaran per pelanggan (§2.3) + UI (§2.4) + migrasi (§2.5) | ✔ 2026-11-04 — migrasi `20261118090000_visa_required_components_v3`, uji `test-visa-v3-migration.ts` |
| V4 | Dokumen syarat Paket Umroh + Haji (§3) — rancangan rinci dulu, disetujui terpisah | belum dirancang rinci |
| V5 | Dokumentasi: `arsitektur-booking-engine-v2.md`, `arsitektur-visa.md`, CLAUDE.md (pelonggaran dihapus, drift §6) | — |

## 5. Keputusan pemilik (tercatat)
- 2026-11-03: visa = produk utama; "Model penjualan" only/plus (V1).
- 2026-11-04: visa melekat ke jamaah; syarat produk wajib = daftar centang bebas semua jenis produk (bukan hanya hotel); hotel dibedakan **Makkah / Madinah**;
  pelonggaran per pelanggan dihapus; bukti booking dari luar = dokumen biasa pilihan admin (tanpa aturan otomatis); Paket Umroh & Haji juga punya syarat dokumen.

## 6. Drift dokumen lama yang ditemukan audit (dibereskan di V5)
- `arsitektur-booking-engine-v2.md` D5: "visa saja hanya lewat pelonggaran" — kode: visa dengan aturan kosong lolos untuk siapa pun. §4.1/§10.2 menyebut `evaluateBookingRules`; kode `evaluateVisaRules`/`visaRuleViolations`.
- `arsitektur-visa.md`: masih menyebut `price`, `durationFeeRules`, `BookingVisa`, editor 3 tab, fallback `VisaProduct.price` (§9.3; kode menolak 422), syarat dari `visaProduct.requirements` (kini tabel `DocumentRequirement`).
- Komentar basi: `prisma/schema.prisma` (`selectedDurationDays` "belum diisi" — sudah diisi `lineItems.ts`), `lib/validators/booking.ts` (`durationFeeRules`).
