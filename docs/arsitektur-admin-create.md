# Arsitektur — Alur "Buat Baru" di Admin (halaman khusus, bukan panel sebaris)

> **Status: F1 SELESAI (Haji, Visa, Paket Umroh); F2 (modul lain) masih rencana — 2026-10-26.** Pemicu: pemilik melaporkan bahwa "Tambah" di Produk Haji/Visa/Paket membuka panel sebaris di atas daftar — membingungkan, terasa menjebak (harus kembali lewat browser), dan tak seperti membuat produk pada umumnya.

## 1. Recheck (kode aktual)

Semua halaman daftar admin membuat entitas lewat **panel sebaris**: tombol "Tambah" membalik `show` dan formulir muncul di atas `DataTable` (`products/{haji,visa,packages,catering,hotels,muthowif,tour-packages,tourism-sites,seasons}/page.tsx`, `flight/page.tsx`, `transport/page.tsx`, `system/users/page.tsx`). Masalah yang terbukti dari kode:

1. **Bukan halaman**: tak ada URL, tak ada breadcrumb "Baru", tombol Kembali, atau bilah aksi tetap; formulir panjang (editor teks kaya, banyak kolom) menggeser daftar ke bawah layar.
2. **Galat ditelan**: `haji` dan `packages` memanggil `await fetch(POST)` tanpa memeriksa respons — saat server menolak (400/403/500) panel tetap menutup dan daftar dimuat ulang seolah berhasil; hanya `visa` yang memeriksa `data.id`, itupun tanpa pesan galat.
3. **Tak konsisten** dengan halaman edit (`[id]`) yang sudah berupa halaman penuh dengan tombol kembali, banner galat, dan bilah simpan.

## 2. Keputusan

- **Buat = halaman khusus** `/admin/<area>/<modul>/new` (breadcrumb `Admin › Produk › Haji › Baru`; label `new` sudah ada di `LABEL_SEGMEN`). Tombol "Tambah …" di daftar menjadi **tautan** ke halaman itu.
- **Satu komponen bersama** `components/admin/shell/CreatePage.tsx`: judul + deskripsi + tombol kembali, `<form>` (Enter di kolom teks menyimpan), bilah aksi **menempel di bawah** (Batal / Simpan), banner galat `role="alert"` yang SELALU menampilkan pesan server, status menyimpan. Formulir per-modul tetap dimiliki modulnya (kolomnya beda).
- **Setelah berhasil** → langsung ke halaman edit `[id]` entitas itu (tempat konfigurasi lanjutan: Komponen Biaya, hotel/kendaraan, dst.); modul tanpa halaman edit kembali ke daftar dengan pesan sukses.
- **Galat tidak pernah menutup formulir.** Pesan server tampil; isian tetap.
- **Penjaga CI**: halaman daftar produk tidak boleh lagi memuat state `show*` pembuka formulir sebaris; setiap modul bertombol "Tambah" punya `new/page.tsx` (dimutasi).

## 3. Fase

| Fase | Isi |
|---|---|
| **F1** | `CreatePage` + halaman `new` untuk **Haji, Visa, Paket Umroh** (yang dilaporkan); penjaga CI awal |
| **F2** | Sisanya: Hotel, Muthowif, Paket Ziarah, Situs Wisata, Pesawat (rute/jadwal), Transport (trip/kendaraan), Katering, Musim, Admin (system/users) — modul tanpa halaman edit dinilai dulu (CRUD lengkap: lihat CLAUDE.md "Admin UI Kit") |

## 4. As-built F1 (2026-10-26)

**Dibuat:** `components/admin/shell/CreatePage.tsx` (judul + tombol kembali + banner galat + bilah aksi `sticky`, `<form>` sehingga Enter menyimpan); halaman `products/{haji,visa,packages}/new/page.tsx`; `lib/constants/haji.ts` (`HAJI_TYPES` — dulu terduplikasi di tiga halaman); `scripts/test-admin-create.ts` (masuk rantai `bun run test`). Halaman daftar Haji/Visa/Paket: panel sebaris + state `show/saving/form` dihapus (≈ −90 baris), tombol "Tambah" kini `<Link>` ke `/new`. Setelah simpan → halaman edit `[id]` (Komponen Biaya dkk.).
**Perilaku baru yang sebelumnya salah:** Haji dan Paket dulu **menelan respons** (panel menutup walau POST ditolak) dan Visa diam bila gagal; kini pesan server selalu tampil dan isian tetap (diuji: tahun 1900 → "Tahun minimal 2000", nama tetap, URL tetap `/new`).
**Bukti (Chrome, dev server + DB uji):** tiga daftar → klik Tambah → halaman `/new` (breadcrumb `Admin › Produk › Haji › Baru`, tombol simpan nonaktif sampai kolom wajib terisi); simpan sukses → halaman edit entitas baru (Haji/Visa/Paket); simpan gagal → banner galat, formulir tetap; Batal → daftar. `bun run test` hijau, `bun run build` (salinan terpisah) 0 error, `bun audit` bersih; 3 mutasi penjaga tertangkap (panel sebaris kembali, respons tak diperiksa, CreatePage dicabut).

