# Arsitektur — Booking Engine v2 (admin lebih dulu, invoice, pembayaran bertahap, buku kas)

> **Status: RENCANA DISETUJUI SECARA LISAN (2026-10-30), belum ada kode.** Fase 0 (dokumen ini + ADR-0004 + aturan zona waktu di `CLAUDE.md`) dikerjakan di PR yang sama. Seluruh keputusan di §2 berasal dari diskusi pemilik produk 2026-10-30 (berurutan, dikonfirmasi satu per satu). Keputusan yang masih terbuka ada di §12. Dokumen ini **menggantikan arah** `docs/arsitektur-booking.md` (engine v1, kerangka keranjang + adapter kuota — bagian itu tetap berlaku sebagai fondasi yang dipakai ulang, §3.1) dan **menggantikan keputusan 2026-07-25** "tidak ada produk yang mewajibkan produk lain" (§2 D5).

## 0. Recheck dokumen lama vs kode aktual (SOP Fase Eksekusi langkah 1) — 2026-10-30

| # | Temuan | Bukti |
|---|--------|-------|
| 0.1 | `VisaProduct.requiredComponents` **dibaca kode** (hanya `hotel`/`transport`, validasi di `superRefine`), tetapi `docs/arsitektur-visa.md` §9 menyebutnya "belum dibaca wizard manapun". Selain itu **tidak ada UI admin** untuk mengisinya dan kedua visa yang ada berisi `[]` (aturan tak pernah aktif). Komponen `flight` tak dikenal. | `lib/validators/booking.ts:128-160`; `docs/arsitektur-visa.md:39,236`; `grep requiredComponents app components` kosong; DB dev: `visa_products.requiredComponents = []` ×2 |
| 0.2 | **Tiket pesawat dan Paket Umroh tidak dapat dipesan.** `BookingFlight` ada di skema tetapi hanya dibaca satu route admin jadwal; tak ada `itemType` `flight`/`package` pada `bookingItemSchema`, tak ada adapter kuota `flight`/`package`. `FlightSchedule` sudah punya `totalSeats/pendingSeats/bookedSeats`. | `prisma/schema.prisma:324-361`; `lib/quota/adapters/` (catering, haji, hotel, muthowif, tourPackage, transport, visa) |
| 0.3 | Tidak ada pembuatan booking oleh admin, tidak ada invoice publik (invoice = PDF yang butuh login), `Payment.method` = teks bebas tanpa data pengirim/rekening/kode unik, tanpa gateway. `SiteSetting` hanya nama/SEO/kontak/saklar email — tak ada profil perusahaan, rekening, QRIS, pajak, penomoran. | `prisma/schema.prisma:1007-1033,1233-1245`; `app/api/v1/admin/bookings/` |
| 0.4 | Aturan pembayaran sekarang **bertentangan** dengan v2: konfirmasi menolak jumlah di bawah total; lebih dari total wajib catatan; penyesuaian total hanya `awaiting_payment`; batal otomatis 24 jam (`paymentDeadline`); status booking mencampur siklus hidup dan pembayaran (`awaiting_payment`, `payment_review`, `confirmed`…). | `lib/payments/confirmAmount.ts`; `lib/booking/adjustments.ts:9,41`; `lib/cron/autocancelJob.ts:12`; `app/api/v1/bookings/route.ts:57,125` |
| 0.5 | `Booking.departureDate/returnDate` wajib di tingkat booking; v2 menempelkan tanggal ke **item** (D1). Item sudah punya tanggal sendiri (`BookingHotel.checkIn/checkOut`, `BookingTransport`, `BookingMuthowif.startDate/endDate`, `BookingTourPackage.tourDate`, `BookingFlight.departureDate`). | `prisma/schema.prisma:759-770,884-1000` |
| 0.6 | `docs/arsitektur-booking.md` dan `arsitektur-umroh.md`/`arsitektur-visa.md` masih menyebut `BookingVisa`/wizard 7 langkah/Group Booking (sudah dihapus 2026-10-30, migrasi `20261102090000`). Catatan basi, tidak mengubah kode. | `docs/arsitektur-booking.md` (4 sebutan `BookingVisa`) |
| 0.7 | `price_snapshots` **beku di DB** (trigger `price_snapshots_frozen` menolak UPDATE); koreksi = baris `penyesuaian` baru. v2 mewajibkan "semua bisa diedit setelah terbit" → butuh cara membatalkan/mengganti baris tanpa menghapus jejak (§4.4, keputusan teknis T1). | `prisma/migrations/*price_snapshots*/migration.sql:44-49` |
| 0.8 | **Zona waktu tersebar dan tak terjaga** (§5): tak ada modul waktu pusat; `+ 7 * 3_600_000` di 4 berkas; ±20 pemanggilan `toLocaleDateString/String('id-ID')` tanpa `timeZone` (hasil mengikuti zona server/peramban); 61 kolom `TIMESTAMP(3)` tanpa zona; **Postgres dev berzona `Asia/Jakarta`** sedangkan Prisma menulis UTC (uji empiris: `createdAt` tertulis `02:24` saat WIB `09:24`) — jadi dev dan produksi (kemungkinan UTC) bisa berbeda untuk SQL mentah (`now()` di migrasi `20261021150000`). | `lib/admin/period.ts:4-6`, `lib/costs/actuals.ts:61`, `lib/reports/profit.ts:190`, `CostActualsPanel.tsx:20`; `psql show timezone` → `Asia/Jakarta` |

Tidak ada drift yang menggugurkan rencana. Temuan 0.1 dan 0.6 dikoreksi di dokumen terkait saat fase yang menyentuhnya.

## 1. Tujuan dan prinsip

Seperti toko online: **admin membuka form booking → menambah produk → jumlah jamaah → tanggal → pratinjau → terbitkan invoice → invoice publik → pelanggan membayar (bertahap) → admin memverifikasi.** Mesin yang sama kelak dipakai front-end pelanggan (Fase 11), bukan duplikat kode.

Prinsip:
1. **Produk itu mandiri** (visa, tiket, hotel, transport, muthowif, katering, ziarah, haji, Paket Umroh). Tidak ada produk yang *otomatis* mewajibkan produk lain — kecuali **aturan yang diatur pada produk itu sendiri** (visa, D5) dan Paket (sudah berisi semuanya).
2. **Tidak ada yang wajib bagi admin**; semua bisa diedit (jatuh tempo, harga baris, total, tanggal terbit…). Pembatasan hanya berasal dari aturan produk, dan aturan itu bisa dilonggarkan per pelanggan.
3. **Uang masuk dan tagihan berjalan sendiri-sendiri**: negosiasi mengubah tagihan, tak pernah mengubah catatan uang yang sudah masuk.
4. **Satu sumber, satu definisi, append-only untuk uang** (pelajaran `bantuanku/docs/arsitektur-buku-kas.md` §2: tiga definisi "uang masuk", pembayaran ganda, rekening tak terhubung).
5. **Waktu tidak boleh meleset** (§5) — satu modul, satu aturan, dijaga tes.
6. Akuntansi **sederhana**: uang masuk/keluar tercatat, laba per booking, PPN diterima dan kapan disetor, uang ada di rekening/gateway/tunai mana. Bukan sistem akuntansi umum.

## 2. Keputusan pemilik (2026-10-30)

| # | Keputusan |
|---|-----------|
| D1 | **Tanggal keberangkatan menempel di item**, bukan di booking. Satu booking boleh punya tiket pergi dan pulang (dua item), beberapa paket, atau tambahan susulan (mis. mobil di Makkah). Visa = 1 per jamaah; Paket = 1 keberangkatan per item paket, boleh banyak item. **Tanggal acuan booking = tanggal item paling awal** (turunan). |
| D2 | **Tidak ada batas order** (boleh memesan kapan saja, bahkan mendadak). |
| D3 | **Admin lebih dulu**: form booking admin → draf tersimpan → pratinjau → terbitkan. **Draf tersimpan di database** (bisa dilanjutkan, tak hilang saat tab ditutup). Setelah terbit, **form data jamaah muncul langsung** (wajib diisi; boleh dilanjutkan nanti, ada indikator kelengkapan). |
| D4 | **Jatuh tempo**: bawaan di Pengaturan Invoice (mis. 2/4/10 hari) sebagai **saran**; saat pratinjau bisa diedit; **tidak mengikat** — setelah lewat tetap bisa dibayar dan admin bisa membatalkan atau memperpanjang. Untuk booking dari front-end, jatuh tempo bawaan dipasang otomatis dan admin bisa mengubahnya. |
| D5 | **Visa itu entitas mandiri dengan aturannya sendiri** (menggantikan keputusan 2026-07-25 "tidak ada produk yang mewajibkan produk lain"): tiap produk visa menentukan komponen yang diwajibkan **dalam booking yang sama** (tiket pesawat, hotel, transport ke hotel; boleh kosong). **Per pelanggan** ada checkbox di detail pelanggan "Boleh pesan visa tanpa pesawat dan hotel" yang melonggarkan aturan itu. **Paket** sudah berisi semua → aturan otomatis terpenuhi. Pemesanan visa murni diizinkan hanya lewat pelonggaran itu. |
| D6 | **Pembayaran bertahap** diperbolehkan (cicilan). Pelanggan mengisi **nominal** (≤ sisa tagihan). Tanpa sistem DP besar: satu setelan opsional "pembayaran minimum pertama (%)" (bawaan 0 = tak ada) + lencana "DP terpenuhi"; aturan DP rinci ditulis di teks Syarat & Ketentuan. |
| D7 | **Pembayaran pelanggan selalu menunggu verifikasi admin**: bukti masuk sebagai *diajukan*; baru saat disetujui tercatat sebagai uang masuk; ditolak → pelanggan boleh mengulang. Pembayaran yang dicatat admin sendiri (tunai/mutasi yang sudah dicek) langsung terverifikasi. **Pembayaran gateway** terverifikasi otomatis lewat webhook bertanda tangan. |
| D8 | **Metode bayar: transfer bank, QRIS, payment gateway (iPaymu dan Xendit saja).** QRIS memakai pola Facport (QRIS statis diunggah → payload EMV dibaca → nominal dikunci dinamis, tanpa API gateway; §8). Rekening dan akun QRIS **banyak**, diatur di Pengaturan Invoice. |
| D9 | **Kode unik**: 3 digit ditambahkan ke jumlah yang dibayar (10.000 → 10.234), identitas transaksi, **bukan kelebihan bayar**, tercatat sebagai **pemasukan lain**. Dipakai transfer bank dan QRIS; tidak untuk gateway. |
| D10 | **Data transfer wajib semua**: nominal, **tanggal dan jam** (bawaan = saat menekan konfirmasi, bisa diubah), **rekening tujuan** (otomatis bila hanya satu), **bank pengirim** (manual), **nama pemilik rekening pengirim** (manual — mis. pemesan Wasugi, transfer dari rekening istri), bukti; catatan opsional. |
| D11 | **Kelebihan bayar** (di luar kode unik) dianggap **refund** (tabel `Refund` yang ada). **Pembatalan** booking yang sudah ada uang masuknya: sistem menampilkan "terbayar Rp X" dan admin memilih tindakan (buat refund / tahan sebagai pemasukan lain / tunda) — tidak otomatis. Tak ada pembatalan sebagian item (diganti lewat edit). |
| D12 | **Hangus**: batas = N hari sebelum **tanggal acuan** (Pengaturan Invoice; bawaan 7; 0 = nonaktif). **Hanya bila belum ada uang masuk sama sekali** → booking dibatalkan otomatis. Bila sudah ada uang masuk → tidak pernah batal/hangus otomatis; hanya berlabel **Overdue** sampai admin bertindak. Jatuh tempo itu sendiri tidak memicu apa pun. |
| D13 | **Edit setelah terbit diperbolehkan** (negosiasi justru terjadi setelah visa terbit). Invoice menampilkan keadaan terbaru ("Revisi ke-N"); riwayat perubahan (siapa, apa, kapan, sebelum/sesudah) hanya di **log internal** — **tanpa** email/WhatsApp ke pelanggan. Harga per baris boleh diubah khusus untuk booking itu (dengan catatan), selain diskon di total. |
| D14 | **Pajak**: daftar pajak di Pengaturan Invoice (PPN, tarif 0 = tak dipakai; mode harga katalog **termasuk** atau **ditambah** pajak); tampil di baris paling akhir invoice; dibebankan ke pelanggan; NPWP perusahaan (PT). **PPh 23 ditunda** (pemotongan oleh pelanggan badan). PPN masukan dari vendor **tidak** dicatat (hanya keluaran). |
| D15 | **MDR gateway dibebankan ke pelanggan** (setelan per gateway: persen + tetap), tampil sebagai baris "Biaya layanan" di halaman bayar; di buku kas menjadi komponen terpisah, sedangkan biaya asli dari gateway menjadi uang keluar. |
| D16 | **Peran**: semua admin boleh melakukan semuanya untuk sementara (peran admin belum dirancang; satu titik kebijakan `lib/booking/policy.ts`, pola `lib/pricing/policy.ts`). |
| D17 | **Buku kas** (akun kas + entri append-only) ditulis sejak awal oleh engine; menu **Keuangan** (Buku Kas, Saldo Rekening, Arus Kas, PPN, Laba per Booking, Bagi Hasil, Transfer Antar Akun) menyusul (Fase 12). **Bagi hasil sementara hanya developer, bawaan 5%** (setelan; sisanya hak klien) — dasar perhitungan lihat §12 K1. Laporan PPN bulanan dan ekspor CSV = pengembangan berikutnya. |
| D18 | **Satu booking = satu invoice yang diperbarui terus** (bukan invoice tambahan). Nomor invoice: awalan custom + format di Pengaturan Invoice. |
| D19 | **Zona waktu** ditegakkan (§5) — pemilik meminta pengingat permanen: salah zona waktu saat membuat fitur baru sudah sering terjadi. |

## 3. Model domain

### 3.1 Yang dipakai ulang (tidak ditulis ulang)
Item booking dan adapter kuota (`lib/quota/adapters/`), harga beku (`price_points` + `price_snapshots`, `lib/pricing/engine/*`, `lib/booking/lineItems.ts`), penyesuaian total (`lib/booking/adjustments.ts` — dilonggarkan, §4.4), pengeluaran aktual vendor (`lib/costs/actuals.ts`, kelak memilih akun kas sumber), `Refund`, notifikasi (`lib/notifications/notify.ts`; email hanya ke alamat terverifikasi, SEC-106), pelanggan (`User` + Tambah Pelanggan), manifes jamaah (`ManifestFieldRequirement`, `BookingPilgrim.fieldValues`), laporan laba (`lib/reports/profit.ts`).

### 3.2 Booking: dua sumbu yang dipisah
- **Siklus hidup** (`BookingStatus` baru): `draft` → `active` → `completed`; cabang `cancelled`, `expired` (hangus). `confirmedAt` + `confirmedById` (kolom, bukan status): admin menekan **Konfirmasi booking** secara manual (visa mulai diproses, jamaah dianggap pasti berangkat) — terpisah dari uang.
- **Status pembayaran = turunan, tidak disimpan**: `Belum bayar` · `Dibayar sebagian` · `Lunas` · `Kelebihan bayar` · `Overdue` (jatuh tempo lewat dan sisa > 0) — dihitung dari tagihan dan jumlah pembayaran terverifikasi.
- `Booking.departureDate/returnDate` jadi turunan (`referenceDate` = tanggal item paling awal, dihitung dan disimpan sebagai kolom cache `@db.Date` untuk kueri; `null` bila tak ada item bertanggal). Migrasi fail-closed dengan pemetaan status lama: `awaiting_payment`/`payment_review` → `active`, `confirmed` → `active` + `confirmedAt`, `active`/`completed`/`cancelled` tetap.

### 3.3 Invoice (1:1 dengan booking)
`Invoice`: `bookingId` unik, `number` (urut tanpa lompat, dari setelan), `issuedAt` (instan) dan `invoiceDate` (tanggal tampil, bisa diedit), `dueDate` (`@db.Date`, tanggal kalender zona aplikasi), `revision`, `publicToken` (256 bit acak, **dapat dicabut/diganti** admin; **T2:** disimpan apa adanya di kolom unik — ia kunci URL, bukan kata sandi, dilindungi rate limit dan dapat dicabut; pola Facport `order.id`; keputusan akhir K6), `taxSnapshot` (daftar pajak beku: nama, tarif, dasar, mode), `termsSnapshot`, `companySnapshot` (profil perusahaan saat terbit, untuk audit), `notes`. Baris pajak dihitung ulang tiap revisi.

Tagihan = Σ baris item (snapshot) + Σ penyesuaian (diskon/biaya/negosiasi) + pajak (bila mode "ditambah"); `Booking.totalAmount` tetap = Σ snapshot (invarian I4 `docs/arsitektur-harga-terpadu.md` §17) **sebelum pajak**; pajak dihitung di invoice dan disimpan sebagai `Invoice.taxTotal` — laporan laba memakai pendapatan sebelum pajak.

### 3.4 Pembayaran (ledger per invoice)
`Payment` dirombak (migrasi; baris lama dipetakan ke komponen/status baru): `invoiceId`/`bookingId`, `method` (`bank_transfer` | `qris` | `gateway` | `cash`), `gateway` (`ipaymu` | `xendit` | null), `status` (`submitted` | `verified` | `rejected` | `cancelled`), **komponen**: `principalIdr` (yang dikreditkan ke tagihan), `uniqueCode` (int), `serviceFeeIdr` (MDR ditanggung pelanggan), `amountExpectedIdr = principal + uniqueCode + serviceFee`, `amountReceivedIdr` (diisi admin saat verifikasi/ webhook), `paidAt` (instan, `timestamptz`), `senderBank`, `senderAccountName`, `destinationCashAccountId`, `proofKey` (MinIO), `payerNote`, `verifiedById/verifiedAt`, `rejectionNote`, `externalId`/`externalStatus`/`rawEventId` (gateway, unik untuk idempotensi), `createdByType` (`customer` | `admin` | `gateway`).

Aturan verifikasi (D9, D11): bila `received ≥ expected` → kredit tagihan = `principal`, `uniqueCode`+`serviceFee` → pemasukan lain, sisa lebih = kredit tambahan (bisa menjadi kelebihan bayar); bila `received < expected` → seluruh `received` mengkredit tagihan dan komponen kode/biaya = 0 (kode tak "sampai"); admin wajib catatan bila selisih.

Algoritma kode unik: untuk `(destinationCashAccountId, amount principal)` pilih kode 3 digit acak dalam rentang setelan (bawaan 100–999) sehingga `expected` **tidak sama** dengan `expected` pembayaran lain berstatus `submitted` di akun yang sama; dikunci dengan kunci penasihat transaksi per akun; bebas lagi saat ditolak/dibatalkan.

### 3.5 Buku kas (minimal sejak Fase 7, menu Keuangan Fase 12)
Mengikuti `bantuanku/docs/arsitektur-buku-kas.md` §3 disesuaikan: `CashAccount` (`kind` bank|qris|gateway|cash, `name`, `refKey` unik = id rekening/QRIS di setelan atau kode gateway, `isActive`), `CashEntry` **append-only** (`entryDate` timestamptz, `direction` in|out, `amountIdr` > 0, `component` pokok|ppn|kode_unik|biaya_layanan|kelebihan|refund|biaya_vendor|biaya_gateway|setor_ppn|pindah_akun|koreksi, `cashAccountId`, `method`, `refType`/`refId`, `bookingId`, `reversesEntryId`, `note`, `createdBy`) dengan **UNIQUE `(refType, refId, component)`** (posting idempoten). Tak ada UPDATE/DELETE; koreksi = entri pembalik. Pembayaran terverifikasi memecah kredit menjadi `pokok` dan `ppn` secara proporsional dengan komposisi invoice saat verifikasi; `kode_unik` dan `biaya_layanan` entri terpisah.

### 3.6 Pelanggan, jamaah, pengaturan
- `User.allowVisaWithoutBundle Boolean @default(false)` (D5) — diubah di detail pelanggan (checkbox), tercatat di log.
- Jamaah: `BookingPilgrim` ada (manifes `fieldValues`); indikator kelengkapan dihitung dari `ManifestFieldRequirement` produk terkait; admin atau pelanggan (tautan) mengisi. Konfirmasi booking diperingatkan bila data belum lengkap (bukan diblokir — D2 prinsip 2).
- **Pengaturan Invoice** (satu halaman, §6): model `InvoiceSettings` (satu baris, kunci `'global'`), `BankAccount[]`, `QrisAccount[]`, `TaxRule[]`, urutan nomor `InvoiceSequence`.

## 4. Aturan

### 4.1 Ketergantungan produk (visa) — D5
- `VisaProduct.requiredComponents` (kolom ada) diperluas nilainya: `flight`, `hotel`, `transport_to_hotel` (jenis `transport` tertentu — K2), UI admin pada editor visa (centang), diperbarui di `docs/arsitektur-visa.md`.
- Evaluasi di **satu fungsi server** `lib/booking/rules.ts` (`evaluateBookingRules(draft)` → daftar pelanggaran/penjelasan) dipakai admin, front-end, dan jalur API; `requiredComponents` dibaca untuk **setiap produk visa dalam booking**; terpenuhi oleh item sejenis di booking itu **atau** oleh Paket yang memuatnya (mode `included`; `user_choice` belum terpilih = belum terpenuhi).
- `User.allowVisaWithoutBundle = true` → pelanggaran visa diturunkan jadi **peringatan** (booking boleh dilanjutkan). Aturan lain (kuota, tanggal di periode harga) tetap keras.
- Hasil aturan ditampilkan di form (apa yang kurang, tombol "tambah tiket/hotel"), bukan sekadar galat 422.

### 4.2 Rumus uang
`Tagihan` = Σ item + Σ penyesuaian + pajak; `Terbayar` = Σ kredit pembayaran `verified` (tanpa kode unik/biaya layanan); `Sisa` = `Tagihan − Terbayar` (negatif = kelebihan bayar → saran "Buat refund", D11). Pembayaran baru: `principal ∈ (0, max(Sisa, 0)]`, kecuali dicatat admin; bila `minimumFirstPaymentPercent > 0` dan belum ada pembayaran terverifikasi, `principal ≥ persen × Tagihan` (hanya sisi pelanggan).

### 4.3 Jatuh tempo, overdue, hangus (D4, D12)
`dueDate` tak memicu apa pun selain label Overdue. Tugas terjadwal harian `expireBookingsJob` (zona aplikasi): booking `active`, tanpa pembayaran `verified`, `referenceDate − N hari < hari ini` → `expired` + lepas kuota (`cancelBooking` yang ada) + catatan log. **Tak ada pembatalan otomatis lain** — `autocancelJob` 24 jam dihapus/diganti.

### 4.4 Edit setelah terbit (D13) dan penyesuaian
- **Draf**: bebas penuh, tanpa jejak, tanpa kuota (kuota belum menjadi patokan desain, keputusan pemilik; adapter ada, penahanan saat **terbit**).
- **Terbit**: setiap edit (ganti item, jumlah, tanggal, jamaah, harga baris, total, jatuh tempo, tanggal invoice) membuat **revisi**: `BookingRevision` (siapa, kapan, ringkasan, JSON sebelum/sesudah tanpa data pribadi mentah), `Invoice.revision += 1`, tagihan dan pajak dihitung ulang, sisa menyesuaikan.
- **T1 (teknis, diputuskan di Fase 6):** `price_snapshots` beku (trigger). Pembatalan/penggantian baris: tambahkan kolom `voidedAt/voidedById/voidReason/replacedBySnapshotId` dan **ubah trigger hanya mengizinkan pengisian kolom void tersebut** (satu arah NULL → nilai); total = Σ snapshot yang belum di-void. Dengan begitu invoice tampil bersih (baris lama tak tampil) namun jejak penuh. Alternatif ditolak: hanya baris pembalik (invoice penuh baris plus-minus), menghapus baris (merusak audit). Perubahan trigger = fase keamanan sendiri (migrasi + tes beku tetap menolak ubah kolom lain).
- `setBookingTotal` (selisih → baris `penyesuaian`) dilonggarkan dari `awaiting_payment` ke semua status aktif; catatan wajib bila sudah ada uang masuk atau total akhir < HPP awal (peringatan HPP tetap mengingatkan saja, `docs/arsitektur-harga-terpadu.md` Fase 8).

### 4.5 Pembatalan (D11)
Admin membatalkan → dialog menampilkan terbayar/tagihan, daftar pembayaran, dan pilihan: **buat refund** (jumlah dapat diedit), **tahan sebagai pemasukan lain**, atau **tunda** (booking `cancelled`, keputusan uang menyusul — muncul di daftar "uang belum diselesaikan"). Kuota dilepas (`cancelBooking`). Kode unik tidak ikut refund.

### 4.6 Tanggal acuan dan item bertanggal
`referenceDate` = `min` dari tanggal mulai item (hotel `checkIn`, transport `travelDate`, muthowif `startDate`, ziarah `tourDate`, tiket `departureDate`, paket: tanggal berangkat paket, haji: `departureDate`, visa: tanggal rencana bila diisi). Tiket pergi dan pulang = dua item; keduanya boleh pada satu booking.

## 5. Zona waktu (aturan wajib — D19)

**Temuan (§0.8)**: tak ada modul waktu pusat; konstanta `7 * 3_600_000` di `lib/admin/period.ts`, `lib/costs/actuals.ts`, `lib/reports/profit.ts`, `CostActualsPanel.tsx`; ±20 `toLocale*('id-ID')` tanpa `timeZone` — tanggal `@db.Date` (UTC tengah malam) tampil **mundur sehari** di peramban zona negatif dan jam tampil menurut zona peramban/server; 61 kolom `TIMESTAMP(3)` tanpa zona (Prisma menulis UTC); Postgres dev berzona `Asia/Jakarta` (SQL mentah `now()` menulis jam WIB ke kolom tanpa zona — bukti: migrasi `20261021150000`) sementara produksi kemungkinan UTC.

**Aturan:**
1. **Instan disimpan UTC.** Tabel/kolom baru memakai `@db.Timestamptz(3)` (instan tak ambigu). Kolom lama tidak dimigrasi di sini (risiko > manfaat); aturan P5 melindunginya.
2. **Tanggal kalender (`@db.Date`)** adalah tanggal di *tempat kejadian*; di aplikasi selalu string `YYYY-MM-DD`, tak pernah dikonversi lewat `Date` lokal; tampil dengan `timeZone: 'UTC'`.
3. **Zona aplikasi** = setelan `appTimezone` (bawaan `Asia/Jakarta`) — **satu modul `lib/time/`** (murni, tanpa dependensi): `appTz()`, `todayInApp()`, `nowInApp()`, `formatDate/formatDateTime/formatTime` (selalu `timeZone` eksplisit), `parseAppDateTime('YYYY-MM-DDTHH:mm')` → instan (menafsirkan input di zona aplikasi, **bukan** peramban), `startOfDayInApp/endOfDayInApp`, `addDays`, `daysBetween` (tanggal kalender). Menggantikan semua konstanta `7 * 3_600_000` dan `toLocale*`.
4. **Input tanggal-jam** lewat komponen `DateTimeField` (label zona "WIB" terlihat, nilai bawaan "sekarang di zona aplikasi", konversi lewat `parseAppDateTime`) — pembayaran (D10) dan semua formulir baru memakainya.
5. **Server/DB**: Postgres `timezone = 'UTC'` ditegakkan (opsi koneksi `-c timezone=UTC` di `DATABASE_URL` yang dibangun/di compose, dan pengecekan saat boot yang memperingatkan bila `SHOW timezone` ≠ UTC); kontainer `TZ=UTC`; SQL mentah **dilarang** memakai `now()`/`CURRENT_TIMESTAMP` untuk kolom tanpa zona — pakai nilai dari aplikasi atau `timezone('UTC', now())`; laporan mengonversi dengan `AT TIME ZONE 'UTC' AT TIME ZONE <zona aplikasi>` (sudah pola `lib/reports/profit.ts`).
6. **Batas hari** (jatuh tempo, hangus, "hari ini", periode laporan) dihitung di zona aplikasi: `dueDate` = akhir hari zona aplikasi; hangus membandingkan tanggal kalender zona aplikasi.
7. **Penjaga**: `scripts/test-time.ts` (tabel nilai dihitung tangan, **dijalankan di bawah `TZ` = UTC, Asia/Jakarta, Asia/Riyadh, America/Los_Angeles** — hasil harus identik) + penemu sumber yang menolak di `app/`, `components/`, `lib/`: `toLocaleDateString/TimeString/String` tanpa `timeZone`, `Intl.DateTimeFormat` tanpa `timeZone`, `7 * 3_600_000`/`3_600_000 * 7`, `new Date(...)` dari string tanggal tanpa zona untuk logika bisnis, dan `toISOString().slice(0, 10)` selain untuk kolom `@db.Date` yang diizinkan lewat daftar beralasan; SQL mentah `now()` pada kolom tanpa zona di migrasi baru.
8. **Aturan di `CLAUDE.md`** (bagian Security & konvensi): "waktu: hanya lewat `lib/time/`; instan UTC; kolom baru `Timestamptz`; tanggal = string kalender; jangan `toLocale*` tanpa `timeZone`". Fase 1 melakukan migrasi semua pemakaian lama.

## 6. Pengaturan Invoice (satu halaman admin, Sistem → Pengaturan Invoice)
- **Penomoran**: awalan custom, pola (`{PREFIX}-{YYYY}-{SEQ}` dll), panjang urut, reset tahunan; urut **tanpa lompat** (kunci baris `InvoiceSequence`).
- **Waktu**: `appTimezone`, jatuh tempo bawaan (hari), hangus (hari sebelum tanggal acuan; 0 = off), pembayaran minimum pertama (%).
- **Pajak** (`TaxRule[]`): nama, tarif %, dasar pengenaan (% dari harga, bawaan 100; mendukung "DPP nilai lain" bila akuntan menentukan), mode **termasuk/ditambah**, aktif; NPWP perusahaan. PPN 0% bawaan.
- **Profil perusahaan**: logo (`MediaField`/MinIO), nama, alamat (`AddressPicker`), telepon, email, situs.
- **Rekening bank[]**: bank, nomor, atas nama, cabang, aktif, urutan; **QRIS[]**: nama, gambar, payload EMV (dibaca otomatis), aktif.
- **Metode bayar**: aktifkan transfer/QRIS/iPaymu/Xendit; per gateway: MDR (% + tetap, dibebankan ke pelanggan), mode sandbox/produksi. **Kunci API di env**, bukan database.
- **Kode unik**: aktif, rentang. **Syarat & Ketentuan** (teks kaya, `richTextField`) dan catatan kaki invoice. **Bagi hasil developer** (%, bawaan 5).

## 7. Halaman dan alur
- **Admin → Booking → Baru**: pilih/ buat pelanggan (Tambah Pelanggan inline) → tambah produk (popup: pilih modul → daftar produk modul itu → atur tanggal/jumlah per item) → jumlah jamaah → pratinjau invoice (aturan visa, total, pajak, jatuh tempo bisa diedit) → **simpan draf** / **Terbitkan** → langsung ke form data jamaah. Daftar draf di menu Booking.
- **Detail booking admin**: ringkasan, item, jamaah (kelengkapan), invoice (revisi), pembayaran (daftar + verifikasi + catat pembayaran), refund, log, Konfirmasi booking, Batalkan.
- **Invoice publik** `/{locale}/invoice/{token}` (`noindex`, tanpa login): tampilan sesuai contoh pemilik tetapi diperbarui (kop perusahaan, penerima, tanggal, jatuh tempo, tabel item, subtotal/diskon/pajak/total/terbayar/sisa, stempel status, rekening/QRIS, S&K), **Download PDF**, **Bayar** → pilih metode → isi data transfer (D10) → kode unik ditampilkan → kirim bukti. Hanya data yang perlu; **tanpa HPP/modal/laba/penyesuaian internal/catatan staf**; rate limit; token dapat dicabut; nama jamaah ditampilkan seperlunya.
- **Front-end pelanggan** (Fase 11): memakai API/engine yang sama; booking mandiri → invoice terbit otomatis dengan jatuh tempo bawaan; admin dapat mengubahnya.

## 8. Porting QRIS dari Facport
Sumber: `/Users/webane/sites/facport/apps/api/src/lib/qris-emv.ts` (parser TLV, CRC16-CCITT, `buildDynamicQris`, `isValidQrisPayload`), `qris-decode.ts` (`jsqr` + `sharp`), tesnya, `docs/decisions/adr-0022-payment-manual-qris-transfer.md`, `adr-0025-invoice-manajemen-admin-dan-link-publik.md`, `docs/phases/phase-42-qris-auto-decode.md`. Porting = salin logika murni + tes (adaptasi TypeScript strict proyek ini), bukan ketergantungan antarproyek. `jsqr` adalah dependensi baru → tinjau (pemelihara, lisensi, `bun audit`) di fase itu. Catatan riset ADR-0022: gateway di jalajogja tidak pernah benar-benar terintegrasi — iPaymu/Xendit di sini adalah implementasi pertama yang sungguhan dan membutuhkan akun sandbox + kunci dari pemilik.

## 9. Keamanan dan integritas (diperiksa tiap fase)
- Invoice publik: token acak ≥ 256 bit, rate limit per IP dan per token, respons seragam tak ada/dicabut, filter field ketat (tes: tak ada modal/HPP/catatan), `noindex`, unggah bukti memeriksa isi berkas (MIME dari isi, ≤ 5 MB) ke bucket privat, tanpa sesi.
- Pembayaran: kunci baris booking saat verifikasi (pola `lib/payments/process.ts`), idempotensi posting buku kas (`UNIQUE (refType, refId, component)`), webhook gateway: tanda tangan diverifikasi atas **badan mentah**, `externalId` unik, jumlah dan status dicocokkan dengan pembayaran yang ada (tak mempercayai jumlah dari webhook sebagai kredit tanpa pencocokan), batas waktu stempel untuk mencegah replay.
- Semua penulisan uang append-only; koreksi pembalik; log perubahan tanpa data pribadi mentah; kolom/tabel baru berisi catatan staf yang bisa memuat nama WAJIB dibersihkan di `lib/account/deletion.ts` (pemindai `scripts/test-deletion.ts`).
- `.strict()` Zod di semua route; peran lewat `lib/booking/policy.ts`; jejak siapa/kapan di semua tindakan.

## 10. Fase eksekusi (satu fase = satu PR, SOP ketat: recheck → build → security → docs)

| Fase | Isi | Selesai bila |
|------|-----|--------------|
| **0** | Dokumen ini, ADR-0004 (Proposed), `CLAUDE.md` (aturan waktu), `docs/progress.md` | PR dokumen digabung |
| **1** | **Waktu & fondasi**: `lib/time/`, `DateTimeField`, migrasi semua `toLocale*`/`+7 jam`/`toISOString().slice` lama, `appTimezone` (konstanta dulu, setelan di Fase 2), UTC DB ditegakkan + peringatan boot, `TZ=UTC` kontainer, `test-time` (matriks `TZ`) + penemu sumber | tes hijau pada 4 zona; tak ada pelanggaran penemu |
| **2** | **Pengaturan Invoice**: model + halaman + API (profil, rekening, QRIS, pajak, penomoran, bawaan); `InvoiceSequence` | halaman CRUD lengkap + tes |
| **3** | **Siklus hidup booking**: status baru, `referenceDate`, `confirmedAt`, draf; migrasi fail-closed; `expireBookingsJob` menggantikan `autocancelJob`; `Booking.departureDate/returnDate` turunan | migrasi diuji pada DB pra-migrasi; tes lama disesuaikan |
| **4** | **Inti engine**: `rules.ts` (visa), `requiredComponents` UI + `allowVisaWithoutBundle`, item **tiket** (adapter kuota kursi) dan **Paket Umroh** (urai ke item sesuai mode) | aturan diuji menyeluruh; tiket dan paket dapat dipesan lewat API |
| **5** | **Form booking admin**: draf, popup modul→produk, pratinjau, terbitkan, form jamaah + indikator kelengkapan | e2e browser |
| **6** | **Invoice terbit**: penomoran, pajak, revisi + log, T1 (void snapshot, trigger), edit setelah terbit, `setBookingTotal` dilonggarkan, invoice publik + PDF baru | invoice konsisten Σ; tes beku |
| **7** | **Pembayaran manual**: ledger, alur bayar publik, kode unik, verifikasi, bertahap, refund saran, pembatalan dengan uang, `CashAccount`/`CashEntry` minimal | uang masuk konsisten satu sumber |
| **8** | **QRIS dinamis** (porting Facport) | scan menghasilkan nominal terkunci |
| **9** | **iPaymu** (webhook, MDR) | sandbox lulus |
| **10** | **Xendit** | sandbox lulus |
| **11** | **Front-end pelanggan** memakai engine | e2e pelanggan |
| **12** | **Menu Keuangan**: Buku Kas, Saldo Rekening, Arus Kas, PPN (ditagihkan vs diterima + pengingat setor), Laba per Booking + bagi hasil developer, Transfer Antar Akun, ekspor CSV | angka laporan = buku kas |

Fase 9–10 membutuhkan akun sandbox dan kunci dari pemilik. Kuota (penahanan saat terbit, kuota kursi tiket) **bukan patokan desain** (keputusan pemilik): adapter dipakai apa adanya dan dikerjakan lebih lanjut terpisah.

## 11. Yang sengaja di luar scope v2 awal
PPh 23 (potongan pelanggan badan), PPN masukan, laporan PPN bulanan/ekspor CSV (Fase 12+), peran admin terperinci, saldo kredit pelanggan, aturan DP per produk, notifikasi perubahan invoice ke pelanggan, mata uang akun kas selain rupiah, kolom lama `TIMESTAMP(3)` → `timestamptz`.

## 12. Keputusan terbuka
- **K1 — dasar bagi hasil developer 5%**: dari **laba** per booking (pendapatan sebelum pajak − biaya vendor aktual) — asumsi kerja; atau dari pendapatan? Dan kapan dianggap "terhitung" (lunas / semua vendor dibayar / setelah keberangkatan)? Dibahas saat Fase 12.
- **K2 — "transport ke hotel"**: komponen aturan visa = jenis transport tertentu (mis. kategori `airport_hotel`) atau transport apa pun? Dibahas di Fase 4.
- **K3 — tanggal rencana visa**: apakah visa punya tanggal rencana (untuk tanggal acuan) atau hanya mengikuti item lain?
- **K4 — setoran PPN**: batas setor/lapor yang dipakai pengingat (umumnya akhir bulan berikutnya) — **dikonfirmasi akuntan** sebelum Fase 12.
- **K5 — harga katalog termasuk atau belum termasuk pajak** untuk data yang ada (setelan memungkinkan keduanya; default saat pajak 0 tidak berpengaruh).
- **K6 — `publicToken`**: disimpan apa adanya (T2) vs hash saja; keputusan akhir di Fase 6 bersama tinjauan keamanan.

## 13. Referensi
`docs/arsitektur-booking.md` (engine v1, fondasi), `docs/arsitektur-harga-terpadu.md` (harga, snapshot, penyesuaian, laporan), `docs/arsitektur-visa.md` (§9 varian, `requiredComponents`), `docs/arsitektur-paket-umroh.md`, `docs/arsitektur-tiket-pesawat.md`, `docs/arsitektur-manifest.md`, `docs/arsitektur-vendor.md`, `docs/decisions/adr-0004-booking-engine-v2.md`; di luar repo: `facport/docs/decisions/adr-0022…`, `adr-0025…`, `bantuanku/docs/arsitektur-buku-kas.md`.
