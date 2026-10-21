# ADR-0002: Verifikasi nomor WhatsApp lewat pesan masuk; WhatsApp hanya ke nomor terverifikasi; email selalu jaring pengaman

**Status:** Accepted
**Tanggal:** 2026-10-22

## Context
ADR-0001 memutuskan nomor telepon/WhatsApp tidak diverifikasi dan tidak unik. Audit Fase 3 (SEC-32) menunjukkan akibatnya: nomor WhatsApp bisa milik orang lain, dan sistem otomatis mengirim pesan dari nomor bisnis ke nomor itu (konfirmasi booking + pengingat) — risiko dilaporkan sebagai spam dan nomor gateway diblokir, masalah yang sama yang membuat WhatsApp keluar dari jalur autentikasi. Pemilik (2026-10-22) meminta nomor diverifikasi dan satu nomor hanya untuk satu akun, dengan syarat utama: **pengguna tidak boleh kehilangan notifikasi hanya karena WhatsApp tidak tersedia**.

## Decision
- **Verifikasi lewat pesan MASUK:** pengguna mengirim kode ke nomor bisnis (tombol `wa.me` dengan teks terisi); webhook GOWA menerimanya; pengirim (JID yang diautentikasi WhatsApp) harus sama dengan nomor yang didaftarkan. Tidak ada kode yang dikirim keluar dari kita — tidak ada pengiriman yang bisa diblokir dan tidak ada pesan tak diminta ke pihak ketiga.
- **Verifikasi tidak menghalangi pemesanan** (gerbang tetap hanya mewajibkan nomor terisi). **WhatsApp hanya dikirim ke nomor terverifikasi**; selainnya email saja.
- **Satu nomor = satu akun TERVERIFIKASI** (unik hanya di antara nomor terverifikasi; nomor belum terverifikasi boleh sama). Klaim tanpa bukti tidak berlaku; siapa yang membuktikan kepemilikan menang.
- **Email adalah jaring pengaman yang dijamin:** semua kejadian selalu dikirim lewat email apa pun kondisi WhatsApp (gateway mati/diblokir/belum dikonfigurasi, nomor tak ada/belum terverifikasi/belum menyetujui). Kanal berjalan paralel; kegagalan WhatsApp tidak menunda atau menggagalkan email. Diuji untuk setiap jenis kejadian.
Rincian: `docs/arsitektur-whatsapp-verifikasi.md`. Mengubah sebagian ADR-0001 (nomor tidak diverifikasi/tidak unik) — hanya untuk WhatsApp.

## Alternatif yang Dipertimbangkan
- OTP dikirim dari kita lewat WhatsApp — ditolak: bergantung pada pengiriman keluar yang justru sering diblokir; gagal bila gateway bermasalah.
- Verifikasi wajib sebelum memesan — ditolak pemilik: jamaah tidak boleh terhalang karena WhatsApp.
- Unik keras untuk semua nomor — ditolak: keluarga yang berbagi satu nomor tidak bisa mendaftar, dan klaim tanpa bukti bisa memblokir pemilik asli.
- Tetap tanpa verifikasi + batas harian — dipertahankan hanya sebagai lapis tambahan.

## Konsekuensi
- Pemilik harus mengonfigurasi GOWA (Sumopod): `WHATSAPP_WEBHOOK`, `WHATSAPP_WEBHOOK_SECRET`, `WHATSAPP_WEBHOOK_EVENTS=message`; endpoint webhook publik bertanda tangan HMAC.
- GOWA tidak mengirim event putus-koneksi; status aktif dibaca lewat `GET /app/status` untuk panel admin.
- Anggota keluarga kedua yang memakai nomor yang sama hanya menerima email (diterima).
- Nomor yang sudah ada saat ini menjadi tidak terverifikasi → WhatsApp berhenti sampai diverifikasi (belum ada pengguna nyata).

---
> Aturan: file ADR TIDAK diedit setelah Accepted. Kalau keputusan berubah,
> buat ADR baru dan tulis "Supersedes ADR-XXXX" di file baru itu.
