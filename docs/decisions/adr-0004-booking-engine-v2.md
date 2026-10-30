# ADR-0004: Booking Engine v2 — admin lebih dulu, invoice dapat diedit, pembayaran bertahap, buku kas, zona waktu satu pintu

**Status:** Proposed
**Tanggal:** 2026-10-30

## Context
Booking engine v1 (`docs/arsitektur-booking.md`) lahir dari keranjang pelanggan: tanggal di tingkat booking, tenggat bayar 24 jam dengan batal otomatis, konfirmasi pembayaran yang menolak jumlah di bawah total, status yang mencampur siklus hidup dengan pembayaran, invoice berupa PDF yang butuh login, dan tidak ada pembuatan booking oleh admin. Tiket pesawat dan Paket Umroh tidak bisa dipesan. Pemilik produk (diskusi 2026-10-30) menginginkan alur toko online yang dimulai dari admin dan kelak dipakai ulang di front-end, dengan negosiasi setelah terbit, cicilan, pajak yang dapat diaudit, dan sirkulasi uang yang sederhana namun terlacak (rekening, gateway, tunai). Audit zona waktu (`docs/arsitektur-booking-engine-v2.md` §0.8) menunjukkan penanganan waktu tersebar dan berbeda antara dev (Postgres `Asia/Jakarta`) dan kemungkinan produksi (UTC).

## Decision
Rinci di `docs/arsitektur-booking-engine-v2.md` §2 (D1–D20). Ringkas:
1. Tanggal menempel di **item**; booking menyimpan tanggal acuan turunan. Siklus hidup booking dan status pembayaran **dipisah**; status pembayaran turunan dari tagihan vs uang terverifikasi.
2. **Draf tersimpan** → pratinjau → terbit; **edit setelah terbit** lewat revisi berlog; jatuh tempo tidak mengikat; **hangus hanya bila belum ada uang masuk** (N hari sebelum tanggal acuan).
3. **Aturan ketergantungan ditetapkan per produk visa** dan dilonggarkan per pelanggan (menggantikan keputusan 2026-07-25 "tidak ada produk yang mewajibkan produk lain"); Paket otomatis terpenuhi.
4. **Pembayaran bertahap** dengan ledger per invoice; semua pembayaran pelanggan diverifikasi admin, gateway lewat webhook; kode unik = identitas transaksi (pemasukan lain, bukan kelebihan); MDR dibebankan ke pelanggan; transfer bank, QRIS dinamis (porting Facport), iPaymu, Xendit.
5. **Pengaturan Invoice** satu halaman (penomoran, jatuh tempo, hangus, pajak, perusahaan, rekening, QRIS, metode, S&K, bagi hasil developer).
6. **Buku kas append-only** (akun kas + entri) ditulis sejak pembayaran manual; menu Keuangan menyusul.
7. **Bagi hasil** sebagai modul dengan halaman setelan sendiri (bawaan developer 5%; dasar omzet — dimuat ke harga — atau keuntungan — saat selesai; per transaksi; aturan berversi dan dibekukan saat terbit).
8. **Zona waktu satu pintu** (`lib/time/`, instan UTC, kolom baru `timestamptz`, tanggal sebagai string kalender, DB UTC ditegakkan, penemu sumber + matriks `TZ`).

## Alternatif yang Dipertimbangkan
- Memperbaiki v1 sedikit demi sedikit — ditolak: tanggal di tingkat booking, status campuran, dan aturan pembayaran v1 bertentangan dengan alur baru di banyak tempat.
- Invoice terbit tidak boleh diubah (nota pembetulan) — ditolak pemilik: negosiasi terjadi setelah terbit; kompromi audit = revisi berlog.
- Sistem DP penuh (aturan per produk) — ditunda; setelan persentase minimum + teks S&K cukup.
- Gateway sebagai satu-satunya jalur uang — ditolak: transfer manual dan QRIS dinamis terbukti di Facport tanpa biaya gateway.
- Memigrasi 61 kolom `TIMESTAMP(3)` ke `timestamptz` sekarang — ditunda: risiko migrasi besar, aturan baru melindungi kolom lama.

## Konsekuensi
- Pekerjaan besar bertahap (13 fase); aturan lama (konfirmasi tolak kurang bayar, batal otomatis 24 jam, penyesuaian hanya `awaiting_payment`) dicabut bertahap dengan tes pengganti.
- `price_snapshots` perlu mekanisme void (trigger dimodifikasi terbatas) — ditinjau keamanan tersendiri di Fase 6.
- iPaymu/Xendit membutuhkan akun sandbox dan kunci dari pemilik; webhook butuh domain publik.
- Peran admin belum dirancang; semua admin dapat melakukan semuanya sementara (satu titik kebijakan).

---
> Aturan: file ADR TIDAK diedit setelah Accepted. Kalau keputusan berubah,
> buat ADR baru dan tulis "Supersedes ADR-XXXX" di file baru itu.
