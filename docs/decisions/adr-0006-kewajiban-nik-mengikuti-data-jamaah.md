# ADR-0006: Kewajiban NIK/paspor di kartu jamaah mengikuti katalog Data Jamaah

**Status:** Accepted
**Tanggal:** 2026-11-25

Mengubah sebagian ADR-0005 (keputusan K1/K2 `docs/arsitektur-jamaah.md` §2: "NIK wajib untuk setiap jamaah kecuali bayi"). Bagian lain ADR-0005
(penyegelan NIK/paspor, gudang identitas, pencocokan) tidak berubah.

## Context
Pemilik meminta (2026-11-25) data di Profil dan semua kartu jamaah = data yang diatur di Produk → Data Jamaah, dan Profil "simple": yang wajib hanya
nama lengkap dan alamat. Kolom NIK **nonaktif** di katalog, tetapi server tetap mewajibkan NIK untuk setiap WNI ≥ 2 tahun — kolom yang disembunyikan
akan membuat kartu WNI tak bisa disimpan sama sekali.

## Decision
- NIK (WNI ≥ 2 tahun) dan nomor paspor (WNA) wajib di server **hanya bila kolomnya aktif dan bertanda Wajib** di katalog Data Jamaah, dan **tidak** untuk kartu
  "Saya sendiri" (boleh belum lengkap; kelengkapan diminta lewat popup saat pemesan menjadikan dirinya jamaah).
- Kartu tanpa NIK/paspor = tanpa identitas gudang (`unmatched`), perlakuan yang sama dengan bayi.
- Kolom yang disembunyikan tidak menghapus nilai yang sudah tersimpan.

## Alternatif yang Dipertimbangkan
- Tetap mewajibkan NIK walau nonaktif di katalog — bertentangan dengan arahan pemilik; katalog jadi tidak dipercaya.
- Mengaktifkan NIK otomatis — keputusan pemilik katalog, bukan kode; alur jadi tidak "simple".

## Konsekuensi
- Satu sumber aturan (katalog) untuk tampilan dan kewajiban.
- Selama NIK nonaktif atau tidak diwajibkan (dan tidak diisi), orang yang sama di dua akun **tidak terdeteksi** sebagai satu identitas. Bisa dibalik kapan saja: aktifkan kolom NIK dan beri tanda
  Wajib, kartu baru (dan kartu lama saat disunting) kembali wajib NIK.
- Kartu tanpa NIK tidak memicu pemeriksaan gudang; petugas mencocokkan manual bila perlu.
