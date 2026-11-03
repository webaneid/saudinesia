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

## 3. V4 — Syarat dokumen untuk Paket Umroh dan Haji (RANCANGAN RINCI 2026-11-04 — keputusan K1–K4 dijawab pemilik; menunggu aba-aba eksekusi)

Arah pemilik: produk Visa, Haji, dan Paket Umroh terikat dokumen; admin memilih dokumennya di produk; pembeli melengkapinya **per jamaah**.

### 3.1 Audit kode (2026-11-04, cabang V3)
| Hal | Kode sekarang |
|---|---|
| Penulis syarat | `lib/documents/requirements.ts` — `REQUIREMENT_OWNERS` hanya `visa` (komentar: "Haji TIDAK"). Tabel `document_requirements` sudah polimorfik (`productType`+`productId`). |
| Asal syarat seorang jamaah | HANYA `VisaApplication.visaProductId` jamaah itu: `lib/pilgrims/review.ts:83`, `lib/pilgrims/bookingLink.ts:253` (kelengkapan), halaman booking jamaah `bookings/[id]/page.tsx:62`. Jamaah tanpa visa = tanpa syarat. |
| Buka ulang verifikasi | `reopenForChangedDocument` (review.ts:216) hanya menghitung syarat `visa`; `reopenForChangedRequirements` dipanggil revisi saat visa ditambahkan. |
| Paket ↔ jamaah | `BookingPackage` hanya menyimpan `numPeople` — **tidak ada tautan ke jamaah tertentu**. Visa paket dibagikan diam-diam (`lineItems.ts:200,217`: antrean `packageVisaSlots`, diberikan ke jamaah TANPA visa sendiri sesuai urutan). Paket tanpa visa = tak ada jejak siapa anggota paketnya. |
| Haji ↔ jamaah | `BookingHaji.numPersons` saja, tanpa tautan jamaah. Booking Haji hanya lewat API (tak ada UI jamaah maupun baris di form admin — `rowFromItem` 'haji' tak dapat diedit). |
| Editor | Visa: `RequirementsEditor` di tab "Persyaratan dokumen". Paket: `EditorShell` + `MetaBox` (belum ada syarat). Haji: `EditPage` + `MetaBox` (belum ada syarat). Penghapus Haji (`lib/haji/delete.ts`) dan `dropPolymorphic` SUDAH membersihkan `document_requirements`. |
| Katalog jenis dokumen (dev) | passport, ktp, kk, vaccine, flight_ticket, hotel_reservation, transport_reservation, other. |
| Data dev | 1 paket, 1 produk haji, 0 `booking_packages`, 0 `booking_haji`. |
| Temuan sampingan | Anggota paket ber-visa-termasuk yang juga memilih visa sendiri membayar visa dua kali (visa paket dilewati, visa sendiri ditagih) — lihat keputusan K4. |

### 3.2 Konsep: "produk yang memuat jamaah"
Syarat dokumen seorang jamaah = **gabungan** syarat semua produk yang memuat dia di booking itu:
- visa yang ia pegang (visa sendiri ATAU visa dari paket — keduanya `VisaApplication`, sama seperti sekarang),
- Paket Umroh tempat ia jadi anggota,
- produk Haji tempat ia jadi anggota.

Penggabungan per **jenis dokumen** (satu baris per jenis): wajib bila SALAH SATU produk mewajibkan; label = label produk pertama (urutan: Paket → Haji → Visa), petunjuk digabung tanpa duplikat; tiap baris membawa `sources` (nama produk peminta) untuk ditampilkan "Diminta oleh: Paket Hemat, Visa Reguler". Masa berlaku (paspor 6 bulan) tetap dari katalog jenis — tak berubah.

### 3.3 Tautan jamaah ↔ item (skema)
- `BookingPilgrim.bookingPackageId String?` → `booking_packages` (`onDelete: SetNull`) dan `BookingPilgrim.bookingHajiId String?` → `booking_haji` (`SetNull`), berindeks. Satu jamaah paling banyak satu paket dan satu haji per booking.
- Penulis tunggal: `lib/booking/lineItems.ts` (saat terbit/revisi) — tak ada route yang menulis kolom ini.
- Aturan pembagian (otomatis, K2): anggota paket = jamaah urut yang belum punya paket, **mendahulukan jamaah tanpa visa sendiri** — persis aturan pembagian visa paket hari ini, jadi pembagian visa tidak berubah. Visa paket lalu diberikan ke anggota paket itu (bukan lagi "siapa pun tanpa visa"). Haji: urut, jamaah yang belum ber-haji.
- Σ orang paket ≤ jumlah jamaah dan Σ orang haji ≤ jumlah jamaah — bila tidak, **422** "Jumlah jamaah kurang dari jumlah orang di paket/haji" (sekarang kekurangan jamaah diam-diam membuat sebagian visa paket tak terbagi).
- Revisi (`lib/booking/revise.ts`): paket/haji dihapus → tautan lepas (SetNull + ditulis ulang); ditambah/jumlah naik → anggota baru ditautkan; anggota baru yang sudah **terverifikasi** dibuka ulang (`reopenForChangedRequirements`, sama seperti visa ditambah hari ini).
- Migrasi: kolom baru + isi untuk booking lama dengan aturan yang sama (anggota paket = jamaah yang menerima visa paket dulu, sisanya urut); fail-closed bila hasilnya tak sama dengan `numPeople` pada booking aktif. Dev: 0 baris → tak ada yang diisi.

### 3.4 Syarat di produk Paket Umroh dan Haji
- `REQUIREMENT_OWNERS` + `package` dan `haji` (kunci baris `FOR UPDATE` masing-masing tabel). Bawaan produk baru (K3): Paket `passport, ktp, kk, vaccine`; Haji `passport, ktp, kk, vaccine`.
- API: `POST/PUT admin/products/packages[/id]` dan `admin/products/haji[/id]` menerima `requirements` (skema yang sama `documentRequirementListSchema`), ditulis di transaksi produk lewat `writeRequirements` — pola rute visa.
- UI: kotak "Persyaratan dokumen" (`RequirementsEditor` yang sama) di halaman edit Paket dan Haji. Halaman "Buat baru" mengisi bawaan.
- Publik: daftar "Dokumen yang dibutuhkan" di katalog Paket dan Haji (pembacaan `requirementsOfMany`, pola katalog visa).
- Haji: syarat milik **produk Haji sendiri** — BUKAN `VisaProduct` dan bukan "Visa Haji" (konsep itu tetap belum ada, CLAUDE.md). Formulir data jamaah (manifest) Haji/Paket tetap field inti — di luar V4.

### 3.5 Penilaian gabungan (satu pintu)
- Fungsi baru `pilgrimRequirements(db, bookingPilgrimIds)` di `lib/documents/requirements.ts` → peta jamaah → `RequirementView[]` gabungan (+`sources`). Dipakai SEMUA pembaca: `review.ts` (muat + kunci verifikasi), `bookingLink.ts` (kelengkapan admin/jamaah), halaman booking jamaah, `reopenForChangedDocument` (cek "jenis ini disyaratkan" lewat gabungan, bukan lagi hanya visa).
- Penjaga sumber: tak ada lagi `requirementsOf('visa', …)` / `productType: 'visa'` di jalur jamaah di luar fungsi itu.
- UI checklist jamaah (admin + jamaah): baris "Diminta oleh …"; tanpa perubahan alur unggah/verifikasi.
- Perilaku yang TETAP: mengubah syarat produk tidak membuka ulang jamaah yang sudah terverifikasi (sama dengan visa sekarang); dokumen tak dobel walau diminta dua produk.

### 3.6 Uji (selesai bila)
- Murni: penggabungan (dedup per jenis, wajib-menang, label/urutan, sources).
- DB: pembagian anggota paket = pembagian visa lama (kasus campuran visa sendiri/tanpa visa); 422 bila jamaah kurang; revisi tambah/hapus/ubah jumlah paket & haji → tautan benar + buka ulang terverifikasi; jamaah paket tanpa visa kini punya syarat paket; jamaah paket+visa = gabungan tanpa dobel; Haji tanpa visa punya syarat Haji.
- Migrasi: isi tautan booking lama, fail-closed bila tak cocok, atomik, drift.
- API: `requirements` paket/haji (jenis nonaktif ditolak, 404 produk tak ada, peran), bawaan saat buat.
- Penjaga sumber + `test-document-requirements`, `test-pilgrim-review`, `test-booking-link`, `test-booking-revisions`, `test-admin-editor`.
- Artefak produksi: atur syarat paket → booking paket → checklist jamaah menampilkan gabungan + "Diminta oleh".

### 3.7 Fase V4 (satu PR per fase)
| Fase | Isi |
|---|---|
| V4a | Tautan jamaah ↔ paket/haji (§3.3): skema + migrasi + `lineItems`/`revise` + 422 jumlah — perilaku visa tidak berubah (dibuktikan uji pembanding) |
| V4b | Syarat di produk Paket & Haji (§3.4): registry, API, editor, katalog publik |
| V4c | Penilaian gabungan (§3.5): `pilgrimRequirements`, semua pembaca, buka ulang, UI "Diminta oleh" |

### 3.8 Keputusan pemilik (dijawab 2026-11-04 — semuanya sesuai rekomendasi)
- **K1** — Visa yang termasuk paket: syarat visanya tetap diminta, digabung dengan syarat paket (rekomendasi: ya — visanya tetap diajukan ke kedutaan).
- **K2** — Siapa anggota paket: dibagi otomatis menurut urutan jamaah (rekomendasi; nama jamaah baru diisi sesudah terbit) atau admin memilih per jamaah.
- **K3** — Daftar dokumen bawaan saat membuat Paket/Haji baru (usulan: Paspor, KTP, KK, Sertifikat Vaksin; admin tetap bisa ubah).
- **K4** — Anggota paket yang visanya sudah termasuk paket lalu dipilihkan visa lain: tolak (422 "visa sudah termasuk paket") atau tetap ditagih dua kali seperti sekarang (rekomendasi: tolak).

**Jawaban pemilik 2026-11-04:** K1 = gabungan; K2 = otomatis urut; K3 = Paspor, KTP, KK, Sertifikat Vaksin; K4 = tolak (422, dikerjakan di V4a).

## 4. Fase (satu PR per fase)

| Fase | Isi | Status |
|---|---|---|
| V1 | Editor produk visa: pilihan "Model penjualan" (only/plus) | ✔ 2026-11-03 (#106) |
| V2 | Form booking (draf + revisi): baris Visa di `ItemRows`, kelompok ↔ slot jamaah | ✔ 2026-11-04 (#107) |
| V3 | Daftar centang "Wajib dibeli bersama visa ini" (7 jenis, §2.1–2.2) + hapus pelonggaran per pelanggan (§2.3) + UI (§2.4) + migrasi (§2.5) | ✔ 2026-11-04 — migrasi `20261118090000_visa_required_components_v3`, uji `test-visa-v3-migration.ts` |
| V4 | Syarat dokumen Paket Umroh + Haji (§3) — dipecah V4a/V4b/V4c (§3.7) | rancangan rinci + K1–K4 dijawab 2026-11-04 |
| V5 | Dokumentasi: `arsitektur-booking-engine-v2.md`, `arsitektur-visa.md`, CLAUDE.md (pelonggaran dihapus, drift §6) | — |

## 5. Keputusan pemilik (tercatat)
- 2026-11-03: visa = produk utama; "Model penjualan" only/plus (V1).
- 2026-11-04: visa melekat ke jamaah; syarat produk wajib = daftar centang bebas semua jenis produk (bukan hanya hotel); hotel dibedakan **Makkah / Madinah**;
  pelonggaran per pelanggan dihapus; bukti booking dari luar = dokumen biasa pilihan admin (tanpa aturan otomatis); Paket Umroh & Haji juga punya syarat dokumen.
- 2026-11-04 (V4, §3.8): syarat jamaah = gabungan semua produk yang memuatnya (visa paket ikut); anggota paket/haji dibagi otomatis urut; bawaan Paspor/KTP/KK/Vaksin;
  visa lain untuk anggota paket yang visanya sudah termasuk → ditolak.

## 6. Drift dokumen lama yang ditemukan audit (dibereskan di V5)
- `arsitektur-booking-engine-v2.md` D5: "visa saja hanya lewat pelonggaran" — kode: visa dengan aturan kosong lolos untuk siapa pun. §4.1/§10.2 menyebut `evaluateBookingRules`; kode `evaluateVisaRules`/`visaRuleViolations`.
- `arsitektur-visa.md`: masih menyebut `price`, `durationFeeRules`, `BookingVisa`, editor 3 tab, fallback `VisaProduct.price` (§9.3; kode menolak 422), syarat dari `visaProduct.requirements` (kini tabel `DocumentRequirement`).
- Komentar basi: `prisma/schema.prisma` (`selectedDurationDays` "belum diisi" — sudah diisi `lineItems.ts`), `lib/validators/booking.ts` (`durationFeeRules`).
