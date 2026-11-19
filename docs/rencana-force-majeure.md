# Rencana — Force-majeure refund + persetujuan superadmin

Status: **DISETUJUI pemilik 2026-11-20** (keputusan di §2) — **SELESAI 2026-11-20** (as-built §5). Melengkapi siklus refund `docs/arsitektur-booking-engine-v2.md` §10.10/§10.13 dan menutup spec §6 ("Force-majeure flag") dan §7 ("Force-majeure exceptions", "Refund approval").

## 1. Recheck kode (2026-11-20)

- `Refund.isForceMajeure` (Boolean) ada di skema sejak migrasi awal, tetapi **tidak ditulis atau dibaca kode mana pun**.
- Refund (`lib/refunds/service.ts`, satu-satunya penulis) diusulkan, disetujui, dan dibayar oleh peran `canManageRefund` (manager + superadmin) **dengan jumlah bebas** ≤ batas uang (`refundableOf`). Kebijakan pembatalan (`lib/utils/cancellationPolicy.ts`: >60 hari 100%, 30–60 hari 50%, <30 hari 0%) hanya menjadi saran jumlah awal di `lib/booking/adminCancel.ts`, tidak pernah membatasi.
- Tidak ada halaman pengaturan keuangan; pengaturan uang yang ada = Sistem → Pengaturan Invoice (`lib/invoice/settings.ts`, jejak `settings_audit`).

## 2. Keputusan pemilik

| # | Keputusan |
|---|-----------|
| FM1 | Kapan persetujuan superadmin wajib = **setelan** yang dipilih superadmin di halaman kebijakan refund: (a) di atas kebijakan pembatalan, (b) di atas 50% tagihan booking, (c) salah satunya. Bawaan (a). |
| FM2 | Refund pembatalan **di atas kebijakan wajib ditandai force-majeure** (kategori + alasan). Tanpa tanda → ditolak. Refund kelebihan bayar (booking hidup) tidak terkena. |
| FM3 | Empat kategori: Visa ditolak · Darurat medis/meninggal · Kebijakan pemerintah Saudi · Lainnya. |
| FM4 | Status visa per jamaah tidak diberi penanda; force-majeure hanya di refund. |

## 3. Rancangan

**Data.** Kolom `refunds.isForceMajeure` diganti `forceMajeureCategory` (enum `ForceMajeureCategory`, nullable; migrasi fail-closed: menolak bila ada baris `isForceMajeure = true`). Tabel baru `refund_settings` (satu baris `'global'`, `approvalMode` enum `above_policy|above_half|either`, CHECK id), ditulis HANYA `lib/refunds/settings.ts` dengan jejak `settings_audit` (entitas `refund_settings`) dan `expectedUpdatedAt` (409 bila basi).

**Aturan (murni, `lib/refunds/approval.ts`).** Hanya refund sumber `cancellation`:
- *Batas kebijakan* = saran kebijakan atas uang terbayar saat batal (`booking_cancellations.paidIdr`, tanggal berangkat, hari batal) + uang yang masuk sesudah batal (selalu boleh dikembalikan penuh). Booking tanpa tanggal berangkat atau tanpa baris pembatalan = tanpa batas kebijakan (seluruh terbayar).
- *Di atas kebijakan* = Σ refund pembatalan booking itu yang tidak ditolak (termasuk yang ini) > batas kebijakan.
- *Di atas separuh* = Σ refund booking itu yang tidak ditolak (termasuk yang ini) > 50% tagihan (`billOf().grandTotal`).
- Di atas kebijakan tanpa force-majeure → `needs_force_majeure` (usul, ubah, setujui).
- Perlu superadmin = menurut `approvalMode`. Penyetuju bukan superadmin → `needs_superadmin` (403).

Semua dinilai DI DALAM kunci booking (`refundableOf` yang sama), saat usul/ubah DAN saat setujui (setelan dibaca ulang saat menyetujui).

**Jalur.** `createRefundTx` (usulan dari Keuangan → Refund, pembatalan staf, keputusan tunda) dan `updateRefundAmount` menerima `forceMajeure` (kategori | null; `undefined` saat ubah = tetap). Dialog batal dan kotak keputusan tunda di halaman booking ikut memilih force-majeure — tanpa itu refund di atas kebijakan tak bisa dibuat sama sekali (kebijakan 0% menolak usulan Rp 0, dan keputusan tahan/tunda mengunci usulan biasa).

**UI.** Keuangan → Kebijakan Refund (superadmin): tabel kebijakan pembatalan (baca saja) + pilihan persetujuan. Halaman refund baru/detail: pilihan force-majeure (`ChoiceSelect`) dan kotak "Persetujuan" (batas kebijakan, perlu superadmin atau tidak); tombol Setujui dinonaktifkan untuk manager bila perlu superadmin. Daftar refund: lencana Force-majeure.

**Uji.** `scripts/test-refunds.ts` diperluas: batas kebijakan (termasuk uang terlambat), di atas kebijakan tanpa FM ditolak, tiga mode persetujuan, manager ditolak/superadmin diterima, setelan dibaca ulang saat setuju, FM pada kelebihan bayar ditolak, jejak setelan, 409 basi.

## 4. Fase

Satu fase (satu PR): migrasi + layanan + route + UI + uji + dokumen.

## 5. As-built (2026-11-20)

- Migrasi `20261210090000_refund_force_majeure`: fail-closed bila ada `isForceMajeure = true`; enum `force_majeure_category`/`refund_approval_mode`; `refunds.forceMajeureCategory` + CHECK `refunds_force_majeure_cancellation` (hanya sumber `cancellation`); tabel `refund_settings` (CHECK satu baris, disemai `'global'`).
- `lib/refunds/approval.ts` (aturan murni + `approvalFactsOf`), `lib/refunds/settings.ts` (satu-satunya penulis `refund_settings`, jejak `settings_audit` entitas `refund_settings`), `lib/refunds/service.ts` (`forceMajeureCheck` di usul/ubah; `approveRefund(id, by, { isSuperadmin })` membaca setelan ULANG di dalam kunci), `lib/refunds/http.ts` (422 `needs_force_majeure`/`force_majeure_not_applicable`, 403 `needs_superadmin`).
- **Koreksi urutan di `cancelByAdmin`:** baris `booking_cancellations` kini ditulis SEBELUM refund (batas kebijakan dibaca darinya; sebelumnya refund pembatalan staf akan terbaca "tanpa batas"). Refund ditolak → seluruh pembatalan di-rollback seperti sebelumnya. Saran jumlah memakai hari batal yang sama (`now`).
- Halaman `finance/refund-settings` (superadmin; menu Keuangan hanya untuk superadmin lewat `superadminOnly`), route `GET/PUT /api/v1/admin/finance/refund-settings` (`requireSuperAdmin`, `expectedUpdatedAt` → 409).
- UI: pilihan force-majeure di Buat Refund (booking batal/hangus), Ubah refund, dialog batal, kotak keputusan tunda; detail refund menampilkan batas kebijakan + "wajib superadmin / cukup manager" dan menonaktifkan Setujui bagi yang tak berhak; daftar refund berlencana Force-majeure.
- Verifikasi: `scripts/test-refunds.ts` (+6 uji: aturan murni, batas 50%/0% + rollback, tunda, uang terlambat, kelebihan bayar + CHECK, setelan basi/jejak/dibaca ulang, penjaga penulis); seluruh suite lulus; build produksi 0 galat; browser (server audit): simpan setelan + jejak, batal Rp 29 jt dengan refund Rp 5 jt tanpa force-majeure DITOLAK dengan pesan batas Rp 0, dengan "Visa ditolak" tersimpan, detail menampilkan "wajib superadmin", lencana di daftar.
