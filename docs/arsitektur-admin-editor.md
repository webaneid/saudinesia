# Arsitektur — Tata Letak Editor Admin ala WordPress (konten di kiri, kotak samping di kanan)

> **Status: F1 SELESAI & TERVERIFIKASI (2026-10-27) — Paket Umroh; F2/F3 menunggu.** Arahan pemilik: pengguna sudah terbiasa dengan UI WordPress — kolom kanan berisi *Terbitkan*, *Gambar Unggulan*, kategori/atribut (bila ada) — itu jauh lebih membantu daripada kotak-kotak terpisah yang tak beraturan seperti sekarang. **Mulai dari Paket Umroh.**

## 1. Recheck (kode aktual)

`products/packages/[id]/page.tsx` (841 baris): satu kolom sempit (`max-w-3xl`) berisi tumpukan panel tak berurutan — foto unggulan (panel penuh), "Info Paket" (nama, deskripsi, label harga, centang "tampilkan di halaman utama", highlight, saklar Aktif, tombol Simpan di dalam panel), tujuh kotak komponen (Hotel Makkah, Hotel Madinah, Kendaraan, Muthowif, Visa, Tiket Pesawat, Katering), Komponen Biaya, lalu "Preview Harga" di paling bawah. Akibatnya: status/simpan/harga ringkas tersebar dan harus di-scroll; foto unggulan memakan lebar penuh; tak ada indikasi "ada perubahan belum disimpan"; setiap kotak komponen punya gaya judul sendiri. Hal yang sama berlaku di halaman edit lain (Haji, Hotel, Paket Ziarah, dst. — tumpukan satu kolom dengan susunan masing-masing).
Fakta penting yang tak boleh hilang: kotak komponen **menyimpan langsung** per aksi (mode, pilihan, tambah/hapus opsi); hanya Info (nama, deskripsi, label harga, highlight, aktif, unggulan) yang memakai tombol Simpan. Model `Package` belum punya konsep kategori (kategori vendor ada, kategori produk belum) — kotak "Kategori" ditunda sampai ada modelnya.

## 2. Keputusan

- **Dua kolom ala WordPress** (`lg:` ke atas; HP: satu kolom, kotak samping di bawah + bilah simpan lengket di dasar): **kiri** = judul besar (input nama), konten (deskripsi kaya), lalu *kotak meta* (Highlight, kotak komponen, Komponen Biaya) yang dapat dilipat; **kanan** (lengket saat scroll) = **Terbitkan** (status Aktif/Nonaktif, opsi seperti "tampilkan di halaman utama", tanggal dibuat, tombol Simpan + penanda "belum disimpan"), **Gambar Unggulan** (`MediaField`), **Atribut** (label harga), **Ringkasan Harga** (harga jual dasar langsung terlihat).
- **Komponen bersama** `components/admin/editor/`: `EditorShell` (tata letak + judul + bilah simpan HP), `MetaBox` (kotak berjudul, ikon, deskripsi, lipat/buka), `PublishBox` (status, opsi, simpan, dirty), `useUnsavedGuard` (peringatan keluar halaman bila ada perubahan). Halaman edit lain memakainya di fase berikutnya — bukan salinan per halaman.
- **Kejujuran perilaku**: kotak Terbitkan bertuliskan jelas bahwa yang disimpannya adalah *info paket*; kotak komponen bertanda "tersimpan langsung". Tidak ada perubahan perilaku/data/API di fase ini — hanya penataan ulang.
- **Kotak komponen** dibuka bila modenya bukan `none`, dilipat bila `none` (mengurangi kebisingan).

## 3. Fase

| Fase | Isi |
|---|---|
| **F1** | Komponen `editor/*` + penataan ulang halaman Paket Umroh (tanpa perubahan perilaku); penjaga CI |
| **F2** | Halaman edit lain memakai `EditorShell`: Haji, Paket Ziarah, Hotel, Visa, Katering, Muthowif, Situs Wisata, Kendaraan |
| **F3** | Taksonomi/kategori produk bila diputuskan (model + kotak Kategori di sidebar) |

## 4. As-built F1 (Paket Umroh)

- **Komponen** `components/admin/editor/`: `EditorShell` (kiri `title`+`main`, kanan `aside` lengket `lg:top-20`, `mobileBar` lengket di dasar HP), `MetaBox` (isi tetap ter-mount saat dilipat — isian tak hilang), `PublishBox` (Status + opsi + hint + Simpan; tombol aktif hanya bila `dirty`), `useUnsavedGuard` (`beforeunload`).
- **Halaman** `products/packages/[id]/page.tsx`: judul besar + deskripsi kaya + Highlight + 7 kotak komponen (terbuka bila mode ≠ `none`, badge mode di kepala kotak) + Komponen Biaya + Rincian Harga di kiri; Terbitkan, Foto Unggulan, Atribut (label harga), Ringkasan Harga (`baseTotal`) di kanan.
- **Perilaku — tidak ada perubahan API/data**, tetapi tiga perbaikan yang ditemukan saat menata ulang: (1) `patch()` kini memeriksa respons dan menampilkan galat server (dulu ditelan; baseline "tersimpan" tidak maju bila gagal); (2) muat-ulang akibat kotak komponen (`refreshAll`) tidak lagi menimpa ketikan info yang belum disimpan — hanya muat awal yang mereset `form` (`loadPackage(id, true)`); (3) penanda "Ada perubahan belum disimpan" dan peringatan keluar halaman.
- **Penjaga CI** `scripts/test-admin-editor.ts` (dalam `bun run test`): halaman edit terdaftar wajib memakai `EditorShell/PublishBox/MetaBox/useUnsavedGuard`, tidak kembali ke `admin-form-panel`/kartu manual, respons simpan diperiksa, muat-ulang tak menimpa isian. **Halaman edit yang dimigrasi di F2 wajib ditambahkan ke daftar `EDITORS` di skrip itu.**
- **Bukti**: Chrome asli — dua kolom + sidebar `position: sticky` di layar lebar, satu kolom + bilah simpan lengket di 390px; Simpan nonaktif saat bersih → aktif + "Ada perubahan belum disimpan" saat diketik; mengubah mode kotak komponen tidak menghapus ketikan nama; simpan tersimpan & bertahan setelah muat ulang; tanpa galat konsol. `bun run test` 408 PASS; build terisolasi 0 error.
