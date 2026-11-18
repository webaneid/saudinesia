# Arsitektur Bagi Hasil — Platform Provider (Fase 13)

> Status: **RENCANA DISETUJUI (2026-11-18, keputusan terbuka dijawab pemilik §7).** Kode belum ada — dieksekusi per sub-fase §6. Menggantikan §6b dan K1 di `docs/arsitektur-booking-engine-v2.md`
> sesudah disetujui. Pola acuan: `bantuanku/docs/arsitektur-revenue-share.md` + `apps/admin/src/app/dashboard/settings/developer` (repo terpisah).

## 1. Konteks dan keputusan pemilik

Saudinesia dijalankan klien; aplikasinya disediakan **Platform Provider** (sebutan pengganti "Developer"). Platform Provider mendapat bagian dari setiap transaksi.

| # | Keputusan (pemilik, 2026-11-18) |
|---|---|
| P1 | Sebutan **Platform Provider**, bukan "Developer". |
| P2 | Persen **bawaan 5%**, bukan baku. **Hanya akun Platform Provider** yang dapat mengubah persen dan dasarnya (superadmin klien tidak). |
| P3 | **Dua opsi dasar**, dipilih di setelan (satu yang berlaku): **(1) Bagi margin** — HPP 1.000.000, margin 20% → jual 1.200.000, margin 200.000 → Platform Provider 5% × 200.000 = **10.000**; harga jual tidak berubah. **(2) Tambah poin marjin** — HPP 1.000.000, margin 20% + 5 poin = 25% → jual 1.250.000; **5 poin (= 50.000) milik Platform Provider**, margin klien tetap 200.000. |
| P4 | Aturan **dibekukan saat invoice terbit** (perubahan setelan hanya untuk booking baru). |
| P5 | Hak **hanya dihitung bila pembayaran berhasil** (terverifikasi). Booking yang baru terbit tetap dihitung sebagai **potensi**, tetapi tidak masuk hak Platform Provider. |
| P6 | Booking **selesai** ditandai **admin secara manual** (tombol di detail booking). |
| P7 | Halaman setelan sendiri seperti bantuanku `settings/developer`: informasi, rekening penerimaan Platform Provider, pendapatan (hak), dan alur pencairan. |

Menggantikan usulan lama K1 (A/B/C gross-up) — opsi (2) di atas sama dengan "C" lama (5 poin dari modal), dan opsi (1) adalah dasar keuntungan berbasis margin.

## 2. Recheck kode (2026-11-18)

- Belum ada model/kode bagi hasil apa pun (`grep revenueShare|bagi_hasil` kosong).
- Margin bawaan berasal dari SATU fungsi `resolveMarginRule` (`lib/pricing/pricingHelpers.ts`), dipakai `computeSellPrice` dan `costComponents` → titik tunggal untuk opsi (2).
- **Tidak ada kode yang pernah menulis `Booking.status = 'completed'`** — status itu hanya dikenal `lib/booking/lifecycle.ts`. Tombol "Tandai selesai" (P6) adalah jalur pertama.
- Pembayaran terverifikasi memosting `pokok`/`ppn`/`kelebihan` di `processPayment` (manual) dan `lib/payments/gateway.ts` (iPaymu); refund dibayar memosting `refund` (`lib/refunds/service.ts`). Ini pemicu hak (P5).
- Komponen buku kas belum punya `bagi_hasil`.

## 3. Model data (usulan)

- **`User.isPlatformProvider`** (boolean, bawaan false) — penanda akun Platform Provider (pola `isDeveloper` bantuanku). **Tidak bisa diubah dari UI/API mana pun**; diisi lewat skrip `scripts/set-platform-provider.ts` (dijalankan pemilik server). Akun ini staf (login admin), mengubah penanda menaikkan `sessionVersion`.
- **`revenue_share_settings`** — versi berlaku (append-only): `percent` (0–50, bawaan 5), `basis` (`margin` | `markup`), `effectiveFrom`, `createdById` (harus Platform Provider), `note`. Versi terbaru = berlaku. Riwayat tak pernah ditimpa.
- **Beku di invoice:** `Invoice.revenueSharePercent`, `Invoice.revenueShareBasis`, `Invoice.revenueShareSettingId` — diisi `issueInvoice` dari versi berlaku (P4).
- **~~Beku per baris harga `price_snapshots.providerShareIdr`~~ — tidak dibuat (13b):** potensi DITURUNKAN dari dua hal yang sudah beku — aturan di invoice dan baris snapshot berlaku — lewat fungsi murni `lib/revenue-share/potential.ts` (lihat §5b). Kolom per baris tak menambah kepastian, malah menambah penulis.
- **`revenue_share_entries`** (append-only, trigger DB): `bookingId`, sumber (`payment` | `refund` | `revision` | `completion`), `refId`, `amountIdr` bertanda (+ hak, − koreksi), `basis`, `percent`, `createdAt`. UNIQUE `(source, refId)` → idempoten.
- **`revenue_share_payouts`** — pencairan ke Platform Provider: jumlah, tanggal, akun kas asal, rekening tujuan (beku), catatan, dicatat oleh, batal = `voidedAt` + pembalik. Memosting `out`/`bagi_hasil` di buku kas lewat `lib/cash/ledger.ts`.
- **Rekening Platform Provider** — daftar rekening milik Platform Provider (diatur akun itu sendiri), dipilih saat mencatat pencairan.

## 4. Aturan hitung

- **Potensi** booking = Σ `providerShareIdr` baris snapshot yang tidak di-void (berubah bila booking direvisi).
- **Hak** (P5) terhitung per pembayaran terverifikasi: `hak = potensi × (pokok yang dikreditkan ÷ subtotal)` — tanpa PPN, kode unik, biaya layanan, kelebihan. Refund dibayar → entri negatif proporsional. Revisi setelah ada pembayaran → entri koreksi selisih (hak = potensi baru × rasio terbayar − hak tercatat). Jumlah hak sebuah booking tak pernah melebihi potensinya.
- **Opsi (2) markup → harga:** `resolveMarginRule` mengembalikan margin + persen Platform Provider (versi berlaku) bila dasar = markup; ganti persen/dasar → `refreshAllPricingCaches` (satu pintu, seperti ubah margin). Harga MANUAL tetap menang; bagian Platform Provider tetap `persen × modal` (bila manual di bawah modal + bagian, peringatan saja — Fase 8 harga: mengingatkan, tidak menolak).
- **Opsi (1) margin** (keputusan terbuka Q1): bagian dihitung dari margin harga beku (jual − modal rencana), atau dikoreksi saat **Tandai selesai** memakai pengeluaran aktual vendor.
- **Saldo Platform Provider** = Σ hak − Σ pencairan (tidak dibatalkan). Tidak ada kolom saldo tersimpan.

## 5. Halaman dan peran

> **Akun bayangan (keputusan pemilik 2026-11-18, sesudah audit 13a):** akun Platform Provider TIDAK terlihat oleh superadmin klien. Di Sistem → Pengguna, daftar,
> detail, ubah, buka kunci, dan lepas WhatsApp menyaringnya lewat SATU aturan `visibleStaffWhere` (`lib/auth/adminUsers.ts`): bagi klien akun itu "tidak ditemukan"
> (404, sama dengan id yang tak ada), jadi klien tak bisa menurunkan, menonaktifkan, atau mengganti namanya. Akun bayangan tidak dihitung sebagai superadmin
> cadangan, jadi klien selalu menyisakan superadmin miliknya sendiri. Halaman Platform Provider hanya menyebut "sudah/belum ditetapkan"; riwayat versi tanpa
> nama penyimpan. Pemulihan/pencabutan hanya lewat `scripts/set-platform-provider.ts` di server.

- **Sistem → Platform Provider** (`/admin/system/platform-provider`), tab:
  - **Informasi** — semua admin: siapa penyedia platform, persen + dasar yang berlaku (baca saja), versi aplikasi.
  - **Setelan** — ubah persen/dasar: HANYA `isPlatformProvider` (API `requirePlatformProvider`). Pratinjau contoh (HPP 1.000.000) + peringatan bahwa harga otomatis dihitung ulang (opsi 2).
  - **Rekening** — HANYA Platform Provider.
  - **Pendapatan** — Platform Provider + superadmin (baca): per bulan potensi, hak, dicairkan, sisa; daftar per booking; CSV.
  - **Pencairan** — catat pencairan (superadmin klien, karena uang keluar dari kas klien; Platform Provider melihat), batal = pembalik.
- **Detail booking** — tombol **Tandai selesai** (admin/manager/superadmin; syarat: aktif, terkonfirmasi, lunas, tanggal pulang lewat; dua langkah konfirmasi). Bagian Platform Provider tidak tampil ke jamaah/invoice/halaman publik (internal, sama dengan HPP).

## 5a. As-built 13a (2026-11-18)

- Migrasi `20261203090000_platform_provider`: `users.isPlatformProvider` (bawaan false); enum `revenue_share_basis` (`margin`, `markup`); tabel `revenue_share_settings` (persen DECIMAL(5,2) CHECK 0..50, dasar, catatan ≤ 200, penyimpan FK Restrict, `createdAt` timestamptz). Append-only lewat trigger `revenue_share_settings_frozen` (UPDATE/DELETE/TRUNCATE ditolak).
- Sesi: `SessionPayload.isPlatformProvider` dibaca dari DB (bukan token). `requirePlatformProvider()` = `requireSuperAdmin()` + penanda.
- Penanda hanya ditulis oleh `scripts/set-platform-provider.ts`. Skrip ini ikut ke image web, hanya bergantung pada `@prisma/client`, ditulis sebagai satu `updateMany` bersyarat (superadmin aktif), menaikkan `sessionVersion`, dan diuji di CI di dalam image.
- `lib/revenue-share/settings.ts` adalah penulis tunggal: `currentRevenueShare` (tanpa baris = bawaan 5% markup), `revenueShareHistory`, `platformProviderConfigured`, dan `saveRevenueShare`. Di dalam transaksi `saveRevenueShare`, pelaku dibaca ulang `FOR SHARE`, lalu advisory lock dipasang, lalu `expectedId` diperiksa (versi basi → 409). Simpan tanpa perubahan → 400.
- `lib/revenue-share/example.ts` adalah fungsi murni untuk contoh angka pemilik. `lib/validators/revenueShare.ts` memakai `.strict()` dan menerima persen dua desimal dengan toleransi float.
- Route `GET|POST /api/v1/admin/system/platform-provider`: GET untuk superadmin, POST hanya untuk Platform Provider.
- Halaman Sistem → Platform Provider punya tab Informasi (berlaku + contoh) dan tab Setelan (dikunci untuk klien, pratinjau contoh, riwayat versi).
- **Belum berdampak ke harga atau booking.** Itu dikerjakan di 13b: persen belum dibaca mesin harga dan belum dibekukan ke invoice.
- Uji: `test-revenue-share` mencakup contoh angka, bawaan, 403 untuk klien/manager/penanda dicabut, versi, 409/400, serentak, append-only, CHECK, validator presisi, penjaga sumber (semua penyebut penanda didaftar putih + mutasi tulis tertangkap, skrip di image), menu, dan pembersihan.
- Uji yang ikut diperbarui:
  - `test-admin-users`: akun bayangan dan cadangan superadmin.
  - `test-session`: penanda dari DB.
  - `test-deletion`: `RevenueShareSetting.createdById` dipertahankan.
  - `test-table-consistency`: riwayat versi dicatat sebagai baca-saja.
- Security: subagen `security-auditor` menemukan 0 Critical/High, 1 Medium, dan 4 Low (SEC-274..278); semuanya ditutup di fase ini (lihat `docs/lessons-learned.md`).

## 5b. As-built 13b (2026-11-18)

- **Tanpa akun Platform Provider aktif tidak ada bagi hasil** (`effectiveRevenueShare` = null): harga tidak diberi poin, invoice tidak membekukan apa pun. Penerimanya dipasang lewat skrip, jadi bagi hasil mulai berlaku sejak akun dipasang. Bawaannya 5% markup (tanpa versi tersimpan = bawaan).
- **Opsi markup ke harga:** satu-satunya tempat poin masuk adalah `resolveMarginRule` (`lib/pricing/pricingHelpers.ts`). Fungsi ini mengembalikan:
  - `defaultMarginPercent` = margin klien + poin; angka ini dipakai semua rumus harga (`computeSellPrice`, Komponen Biaya, komposit, simulasi);
  - `clientMarginPercent` dan `providerMarkupPercent` untuk tampilan.
  - PriceCard menulis "26% (20% + 6 poin Platform Provider)", tetapi rinciannya hanya dikirim ke superadmin (SEC-281). Peran lain melihat margin gabungan.
- **Penyelaras harga** `lib/revenue-share/pricing.ts` (`ensurePricesFollowRevenueShare`):
  - Bila kunci aturan berlaku (`none` atau `<persen>:<dasar>`) ≠ `revenue_share_pricing_state.ruleKey`, semua harga dihitung ulang lewat `refreshAllPricingCaches`, lalu aturan yang dipakai dicatat (persen, dasar, id versi).
  - Dipicu saat boot (sesudah `repriceAll`), oleh cron 10 menit (`lib/cron/revenueShareJob.ts`, menangkap perubahan lewat skrip), dan sesudah setelan disimpan.
  - Hanya satu putaran berjalan pada satu waktu dalam satu proses. Pemanggilan di tengah putaran menjadwalkan satu putaran lagi.
  - Kegagalan sebagian tetap dicatat dan tidak diulang terus-menerus (SEC-280).
- **Beku di invoice (P4):** `issueInvoice` membekukan `revenueSharePercent`/`revenueShareBasis`/`revenueShareSettingId` dari aturan yang SUDAH DITERAPKAN ke harga (`revenueShareForIssue` membaca penanda harga), bukan dari setelan terbaru. Dengan begitu bagian Platform Provider selalu dihitung dengan aturan yang sama dengan yang membentuk harga yang dijual (SEC-279).
  - Jeda yang tersisa hanya selama putaran hitung ulang berjalan: sebagian titik harga sudah baru, penanda masih lama. Aturan yang dibekukan adalah aturan lama (konservatif).
  - Ada CHECK bentuk dan FK Restrict ke versi setelan. Invoice lama tetap NULL.
- **Potensi per booking** = `bookingSharePotential` (aturan beku + baris snapshot berlaku), dihitung dalam sen dan tidak pernah negatif:
  - markup: persen × modal baris bermodal. Diskon/penyesuaian tidak mengurangi bagian, karena itu keputusan harga klien.
  - margin: persen × (jual − modal) baris bermodal ± penyesuaian. Baris asli tanpa modal dihitung 0.
  - Belum ditampilkan di mana pun; potensi vs hak dikerjakan di 13c.
- **Belum:** pemisahan "untung klien vs bagian provider" di PriceCard/Laporan Untung (Untung di kartu harga masih termasuk poin provider). Dikerjakan di 13c/13e bersama hak.
- Uji: `scripts/test-revenue-share-pricing.ts`. Mencakup:
  - angka pemilik;
  - tanpa provider;
  - provider dipasang (penanda `none` → invoice tanpa bagi hasil sampai harga diterapkan);
  - pergantian dasar;
  - jeda simpan-sebelum-hitung-ulang;
  - pencabutan;
  - CHECK invoice dan penanda;
  - penjaga sumber.
  - Juga: `test-revenue-share` (TRUNCATE CASCADE di transaksi batal) dan `test-pricing-phase0` (bentuk `resolveMarginRule`).
- Security: subagen menemukan 0 Critical/High, 1 Medium, 3 Low (SEC-279..282). Semua ditutup di fase ini.

## 5c. 13c — SELESAI (as-built 2026-11-18)

- **Rekonsiliasi, bukan delta per kejadian:** satu fungsi `syncRevenueShare(tx, bookingId, { source, refId })` (`lib/revenue-share/entitlement.ts`) dipanggil di dalam kunci booking setiap kali terbayar atau tagihan berubah. Langkahnya:
  1. Hitung target hak = `bulat(potensi × min(1, max(0, terbayar ÷ tagihan)))`. Terbayar dan tagihan dibaca lewat `billOf` (konfirmasi − refund dibayar; subtotal + pajak ditambahkan), potensi lewat `bookingSharePotential`.
  2. Tulis SATU entri bertanda = target − Σ entri tercatat, bila tidak nol.
  - Karena itu hak tak pernah melebihi potensi, kelebihan bayar tidak menambah hak, dan revisi otomatis terkoreksi.
- **Pemicu (semuanya sudah memegang kunci booking):**
  - `processPayment` konfirmasi → `payment`/id;
  - `confirmGatewayPayment` (termasuk uang yang masuk sesudah batal) → `payment`/id;
  - `payRefund` → `refund`/id;
  - `reviseInvoice` (revisi dan penyesuaian total) → `revision`/`<booking>:r<revisi>`.
  - Penolakan pembayaran tidak mengubah apa pun.
- **Tabel `revenue_share_entries`** (append-only lewat trigger): `bookingId` (FK Restrict), `source` (`payment|refund|revision|completion`), `refId`, `amountIdr` bertanda, plus `potentialIdr`/`paidRatio`/`entitledIdr` sesudah entri (jejak), `createdAt`. UNIQUE `(source, refId)`. Tidak ada PII atau teks bebas.
- **Booking batal:** hak mengikuti uang yang masih ditahan klien (keputusan "tahan" = hak tetap; refund dibayar = hak turun).
- **Tampilan:** kotak "Bagi hasil Platform Provider" di detail booking admin berisi potensi, hak, dan persen terbayar, **hanya untuk superadmin** (sejalan SEC-281). Ringkasan Pendapatan dan pencairan ada di 13e.
- **As-built:**
  - Hitungan:
    - Target dihitung EKSAK dengan BigInt atas sen bulat, dibulatkan setengah ke atas (SEC-284). `paidRatio` 6 desimal hanya sebagai jejak.
    - Penyebab yang sama yang perlu koreksi lagi diberi akhiran `#<jumlah entri booking>` (selalu naik; SEC-283).
    - CHECK `amountIdr ≠ 0`, `0 ≤ entitledAfter ≤ potential`, `0 ≤ rasio ≤ 1`.
    - Revisi yang menurunkan potensi menghasilkan entri negatif.
  - Pengujian:
    - Diverifikasi di browser (DB audit): bukti transfer jamaah 10.000.000 atas tagihan 23.950.000 dengan potensi 957.500, lalu verifikasi admin → hak 399.791,23 (41,75%).
    - Uji `scripts/test-revenue-share-entitlement.ts` mencakup: tanpa aturan, bayar sebagian/lunas/lebih, idempoten, refund, atur total, dasar margin + entri negatif, akhiran cadangan, angka besar, DB, dan penjaga sumber. Pembersihan ada di `finally` dan diikuti hitung ulang harga (SEC-285).
    - Jalur gateway dijaga oleh penjaga sumber saja (belum ada uji integrasi iPaymu untuk hak).
  - Security: subagen menemukan 0 Critical/High/Medium dan 3 Low (SEC-283..285), semuanya ditutup.
  - **Catatan untuk pemilik:**
    - Uang yang masuk ke booking yang sudah batal menaikkan hak sampai refundnya dibayar.
    - Superadmin klien dapat melihat potensi dan hak per booking.


## 5d. 13d — SELESAI (as-built 2026-11-19)

**Recheck kode (2026-11-19):**
- Masih tak ada kode yang menulis `Booking.status = 'completed'`. Yang mengenal status itu hanya:
  - `lifecycle.ts` (status tampilan);
  - laporan untung ("recognized");
  - periode hotel;
  - label invoice "LUNAS".
- Revisi dan atur total hanya untuk `active`. Pembayaran juga hanya `active` (`isOpenForPayment`).
- Refund tetap boleh pada booking selesai (kelebihan bayar) dan sudah memanggil `syncRevenueShare`.
- Pengeluaran vendor (`lib/costs/actuals.ts`) boleh pada booking non-draf dan TIDAK mengunci baris booking.

**Tandai selesai** (`lib/booking/completion.ts`, satu-satunya penulis status `completed`):
- Peran: semua admin (`canManageBookings`).
- Dikerjakan dalam satu transaksi yang mengunci booking. Syarat dibaca ulang di dalam kunci:
  1. status `active` dan sudah dikonfirmasi;
  2. lunas (terbayar ≥ tagihan, `billOf`);
  3. tak ada bukti transfer `pending` dan tak ada pembayaran gateway `awaiting`;
  4. tanggal pulang (atau tanggal berangkat bila pulang kosong) ≤ hari ini di zona aplikasi; tanpa tanggal = boleh.
- Syarat dinilai fungsi murni `completionBlockers` (dipakai server dan tampilan).
- Kolom `Booking.completedAt`/`completedById` diisi.
- Satu baris `booking_completion_events` ditulis: append-only, aksi `complete`/`reopen`, pelaku, dan potensi beku. Tanpa teks bebas.
- `syncRevenueShare(…, { source: 'completion', refId: <id event> })` dipanggil.

**Koreksi opsi (1) margin (Q1):**
- Saat selesai, potensi dihitung ulang memakai pengeluaran vendor aktual lewat fungsi murni `finalSharePotential`, lalu DIBEKUKAN di event `complete`:
  - modal tiap baris rencana = Σ pengeluaran aktif yang merujuknya bila ada, selain itu modal rencana;
  - pengeluaran tanpa baris (atau pada baris yang sudah di-void) mengurangi margin;
  - hasil tetap ≥ 0.
- Opsi (2) markup tidak dikoreksi; potensinya tetap.
- Selama booking `completed`, `bookingSharePotential` memakai potensi beku event `complete` terakhir. Refund sesudah selesai menghitung hak dari angka itu.
- Pengeluaran yang dicatat SESUDAH selesai tidak mengubah hak. Admin perlu **Buka kembali** lalu tandai selesai lagi. Pilihan ini sengaja diambil: koreksi hanya terjadi saat "Tandai selesai" sesuai Q1, dan pengeluaran tak perlu mengunci booking.

**Buka kembali** (CRUD — "manusia bisa salah"):
- Hanya manager/superadmin.
- Status kembali `active`, `completedAt` dikosongkan.
- Event `reopen` ditulis, lalu sinkron hak dengan potensi rencana.

**UI:** kotak "Penyelesaian" di detail booking:
- tombol Tandai selesai dengan konfirmasi dua langkah (`useConfirm`);
- daftar alasan bila belum bisa;
- "Selesai pada … oleh …" + Buka kembali.

**Route:** `POST /api/v1/admin/bookings/[id]/completion` dengan body `{ action: 'complete' | 'reopen' }`, divalidasi `.strict()`.

**As-built (berbeda dari rencana di atas, sesudah audit):**
- Potensi akhir dibekukan di kolom `Booking.completedPotentialIdr`, bukan dibaca dari event terakhir. Urutan event bisa bergantung waktu mulai transaksi; kolom ini tidak. Event tetap mencatat angka yang sama sebagai jejak.
- CHECK `bookings_completed_shape` menjamin:
  - penanda hanya pada `completed`;
  - pelaku dan potensi beku hanya bersama penanda;
  - potensi ≥ 0.
- **Buka kembali** membaca akun pemilik `FOR SHARE` di dalam kunci (pola terbit draf). Akun terhapus (UU PDP) atau nonaktif → 409 `owner_unavailable`. Alasannya, booking selesai tak menahan penghapusan akun, jadi membukanya kembali akan menghidupkan jalur yang menerima PII jamaah baru.
- `GET /api/v1/bookings/[id]` (jamaah) membuang `completedById` dan `completedPotentialIdr` (pola SEC-120).
- Kalimat bagi hasil di dialog konfirmasi hanya tampil untuk superadmin. Nama penanda selesai yang merupakan akun Platform Provider tampil "Sistem" bagi staf klien.
- Uji `scripts/test-booking-completion.ts` mencakup:
  - syarat murni;
  - potensi akhir murni;
  - peran;
  - penolakan server;
  - booking tanpa aturan;
  - markup tanpa koreksi + atur total ditolak;
  - margin + aktual: koreksi −7.500, beku terhadap pengeluaran susulan, buka kembali +7.500, selesai lagi 7.500;
  - buka kembali akun terhapus/nonaktif;
  - DB;
  - penjaga sumber.
- Security: subagen menemukan 0 Critical/High, 1 Medium, dan 5 Low (SEC-286..291), semuanya ditutup.
- **Catatan untuk pemilik:**
  - Pengeluaran vendor yang dicatat tepat bersamaan dengan Tandai selesai mungkin tak ikut terhitung. Pengeluaran sesudah selesai sengaja tak mengubah hak; gunakan Buka kembali lalu tandai selesai lagi.
  - Admin (bukan hanya manager) boleh menandai selesai sebelum manager mencatat pengeluaran aktual. Bila perlu, peran ini bisa diperketat di `lib/booking/policy.ts`.

## 6. Fase (satu PR per sub-fase)

| Sub | Isi |
|---|---|
| 13a | `isPlatformProvider` + skrip, `revenue_share_settings` (bawaan 5% opsi yang dipilih pemilik), halaman Platform Provider tab Informasi + Setelan, `requirePlatformProvider` |
| 13b | **SELESAI 2026-11-18** — beku ke invoice (aturan yang diterapkan ke harga) + potensi diturunkan dari snapshot; opsi (2) masuk `resolveMarginRule` + penyelaras harga (§5b) |
| 13c | **SELESAI 2026-11-18** — `revenue_share_entries`: hak saat pembayaran terverifikasi (manual + gateway), refund, revisi; potensi vs hak (§5c) |
| 13d | **SELESAI 2026-11-19** — Tandai selesai / Buka kembali (status `completed` pertama kali ditulis) + koreksi opsi (1) dengan pengeluaran aktual, potensi akhir beku (§5d) |
| 13e | Rekening Platform Provider, pencairan lewat buku kas (`bagi_hasil`), tab Pendapatan + CSV |

## 7. Keputusan (dijawab pemilik 2026-11-18)

- **Q1 — Opsi (1) margin:** **harga beku + koreksi** — hak saat pembayaran berhasil dari margin harga beku (jual − modal rencana); saat Tandai selesai dikoreksi ke untung akhir memakai pengeluaran vendor aktual (entri `completion`, bisa positif atau negatif).
- **Q2 — Bawaan saat dipasang:** **opsi (2) tambah 5 poin marjin.**
- **Q3 — Pencairan:** dicatat **superadmin klien** (uang keluar dari kas klien); Platform Provider melihat riwayat dan saldo.
- **Q4 — Harga lama:** mengikuti Q2 — saat versi setelan pertama berlaku, harga otomatis semua produk dihitung ulang sekali lewat `refreshAllPricingCaches` (naik 5 poin); harga manual tidak berubah; booking yang sudah terbit tidak berubah (harga dan aturan beku).
