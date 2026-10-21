# ADR-0001: Auth berbasis email (daftar manual + Google), OTP WhatsApp dihapus

**Status:** Accepted
**Tanggal:** 2026-10-21

## Context
Auth awal memakai OTP WhatsApp lewat gateway pihak ketiga (GOWA/Sumopod) untuk verifikasi akun dan reset password. Gateway itu makin sering
memblokir (kebijakan anti-spam WhatsApp), padahal alur auth tidak boleh bergantung pada kanal yang bisa mati. Email tidak pernah diverifikasi,
`User.phone` unik dan jadi identitas OTP, dan reset password memakai token UUID plaintext. Aplikasi belum produksi dan belum punya pengguna nyata.

## Decision
- Email (Resend) menjadi identitas, verifikasi, dan jalur pemulihan akun. Dua jalur masuk jamaah: daftar manual email+password **dengan verifikasi email lewat tautan**, dan Google (OAuth Authorization Code + PKCE buatan sendiri).
- OTP WhatsApp dihapus total dari auth. Reset password lewat tautan email. Token email: acak 256-bit, hanya hash disimpan, satu kali pakai, kedaluwarsa singkat.
- Akun manual hanya bisa login setelah email terverifikasi; login Google dengan email yang sama langsung menyambung ke akun itu (akun yang belum terverifikasi: password dikosongkan). Staf tetap hanya password.
- Telepon dan WhatsApp wajib diisi (dua kolom, tidak diverifikasi, tidak unik) — daftar manual di form, daftar Google lewat halaman "Lengkapi data" yang menjadi gerbang semua halaman jamaah.
- WhatsApp menjadi kanal notifikasi terbatas (konfirmasi booking, pengingat pembayaran, pembayaran dikonfirmasi/ditolak); selebihnya email.
Rincian: `docs/arsitektur-auth.md`.

## Alternatif yang Dipertimbangkan
- Tetap OTP WhatsApp + tambah Google — ditolak: ketergantungan pada gateway yang diblokir tetap ada di jalur kritis.
- OTP email 6 digit — ditolak: butuh batas percobaan salah dan jendela pendek; tautan 256-bit tak bisa ditebak dan lebih sederhana.
- Google saja tanpa daftar manual — ditolak pemilik: jamaah tanpa akun Google tetap harus bisa mendaftar.
- Tidak menyambung otomatis akun email yang sama — ditolak pemilik; risiko pre-hijacking ditutup dengan syarat verifikasi email sebelum akun manual aktif.

## Konsekuensi
- Email naik menjadi jalur kritis: domain pengirim Resend terverifikasi (SPF/DKIM/DMARC) menjadi syarat go-live; kuota Resend perlu paket berbayar saat ramai.
- Migrasi skema yang merusak data dev (hapus `OtpRequest`, `resetToken*`, `phoneVerifiedAt`, keunikan `phone`) — diterima karena belum ada pengguna nyata.
- Nomor tidak terverifikasi bisa salah ketik; pesan WhatsApp ke nomor salah diterima sebagai risiko (volume WhatsApp kecil).
- Supersedes bagian "Verifikasi akun baru / Reset password" di `docs/auth-flow.md` dan baris Auth di `CLAUDE.md` (diperbarui saat eksekusi Fase 1).

---
> Aturan: file ADR TIDAK diedit setelah Accepted. Kalau keputusan berubah,
> buat ADR baru dan tulis "Supersedes ADR-XXXX" di file baru itu.
