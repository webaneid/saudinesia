# Arsitektur — Alur "Buat Baru" di Admin (halaman khusus, bukan panel sebaris)

> **Status: F1 + F2 + F3 SELESAI (alur "Buat baru" halaman khusus; gap CRUD §5 ditutup) — 2026-10-27.** Pemicu: pemilik melaporkan bahwa "Tambah" di Produk Haji/Visa/Paket membuka panel sebaris di atas daftar — membingungkan, terasa menjebak (harus kembali lewat browser), dan tak seperti membuat produk pada umumnya.

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
| **F2** | Sisanya: Hotel, Muthowif, Paket Ziarah, Situs Wisata, Pesawat (rute + jadwal), Transport (kendaraan + trip), Katering, Musim, Admin (system/users) — SELESAI |

## 4. As-built F1 (2026-10-26)

**Dibuat:** `components/admin/shell/CreatePage.tsx` (judul + tombol kembali + banner galat + bilah aksi `sticky`, `<form>` sehingga Enter menyimpan); halaman `products/{haji,visa,packages}/new/page.tsx`; `lib/constants/haji.ts` (`HAJI_TYPES` — dulu terduplikasi di tiga halaman); `scripts/test-admin-create.ts` (masuk rantai `bun run test`). Halaman daftar Haji/Visa/Paket: panel sebaris + state `show/saving/form` dihapus (≈ −90 baris), tombol "Tambah" kini `<Link>` ke `/new`. Setelah simpan → halaman edit `[id]` (Komponen Biaya dkk.).
**Perilaku baru yang sebelumnya salah:** Haji dan Paket dulu **menelan respons** (panel menutup walau POST ditolak) dan Visa diam bila gagal; kini pesan server selalu tampil dan isian tetap (diuji: tahun 1900 → "Tahun minimal 2000", nama tetap, URL tetap `/new`).
**Bukti (Chrome, dev server + DB uji):** tiga daftar → klik Tambah → halaman `/new` (breadcrumb `Admin › Produk › Haji › Baru`, tombol simpan nonaktif sampai kolom wajib terisi); simpan sukses → halaman edit entitas baru (Haji/Visa/Paket); simpan gagal → banner galat, formulir tetap; Batal → daftar. `bun run test` hijau, `bun run build` (salinan terpisah) 0 error, `bun audit` bersih; 3 mutasi penjaga tertangkap (panel sebaris kembali, respons tak diperiksa, CreatePage dicabut).

## 5. As-built F2 (2026-10-26) dan gap yang ditemukan

**Dibuat:** `components/admin/shell/useCreateEntity.ts` (SATU tempat yang memeriksa respons POST + berpindah ke halaman edit — menggantikan salinan logika di tiap halaman; halaman F1 ikut dipindah ke hook ini); halaman `/new` untuk Hotel, Muthowif, Paket Ziarah, Situs Wisata, Katering, Musim, Admin (`system/users/new`), Pesawat (`flight/new` jadwal + `flight/routes/new` rute), Transport (`transport/vehicles/new`, `transport/trips/new`). Semua daftar kini menaut ke `/new` (≈ −430 baris panel sebaris). Penjaga `scripts/test-admin-create.ts` mencakup 12 modul + larangan panel sebaris di halaman admin mana pun + hook + `CreatePage` (5 mutasi tertangkap).
**Bug nyata yang terungkap karena galat kini tampil:** membuat **Trip Transport tanpa kategori selalu 400** — formulir mengirim `category: null`, skema `z.string().optional()` menolaknya, dan UI lama diam saja (tombol tampak tak berbuat apa-apa; ini sangat mungkin termasuk "terjebak" yang dilaporkan). Diperbaiki `.nullish()` + uji regresi. Di formulir Admin, nama kini wajib (server menolak <2 karakter).
**Bukti (Chrome, dev server + DB uji):** ke-14 alur dijalankan dari daftar → klik Tambah → `/new` → isi → simpan: Hotel, Muthowif, Paket Ziarah, Situs Wisata, Kendaraan, Trip → halaman edit entitas baru; Katering, Musim, Rute, Admin → kembali ke daftar; Jadwal Pesawat memuat rute aktif / peringatan bila belum ada rute; jalur gagal (Trip dan Admin) menampilkan pesan server dan tetap di formulir. `bun run test`, `bun run build` (salinan terpisah), `bun audit` hijau.

**Gap CRUD yang ditemukan (BELUM dikerjakan — di luar scope "Buat baru", dicatat sesuai aturan "CRUD lengkap selalu"):**
| Entitas | Kekurangan |
|---|---|
| Katering | **Tak ada edit dan hapus sama sekali** (API hanya GET/POST, tak ada `[id]`, tak ada halaman edit) — salah ketik harga/nama tak bisa diperbaiki |
| Musim | Tak ada edit (hanya hapus) |
| Rute penerbangan | API punya PUT/DELETE tetapi **tak ada UI** edit/hapus (hanya lencana di daftar) |
| Kendaraan transport | Ada edit; tak ada hapus |
| Admin (pengguna) | Tak ada edit nama/hapus (peran + aktif dari daftar; penghapusan akun mengikuti `docs/arsitektur-hapus-akun.md`) |

## 6. Rencana F3 — menutup gap CRUD (2026-10-27)

**Recheck kode (sebelum rencana):** Katering: API hanya `GET/POST`, tanpa `[id]`/halaman edit/hapus. Musim: hanya `DELETE`, tanpa `GET/PUT`. Rute penerbangan: `PUT/DELETE` ada tetapi **`DELETE` hanya menghitung jadwal AKTIF** — rute yang masih dirujuk jadwal nonaktif atau Paket Umroh gagal dengan galat FK → 500 (bug); tak ada UI edit/hapus. Kendaraan: `GET/PUT` ada, **tak ada `DELETE`**. Admin (pengguna): `PUT` hanya peran/aktif — nama tak bisa diubah, tak ada `GET` per-pengguna.

**Keputusan:**
- **Satu helper hapus-aman** `lib/admin/safeDelete.ts` (`deleteOrDeactivate`): hapus sungguhan bila tak ada rujukan, selain itu nonaktif + pesan; tabrakan FK saat hapus (`P2003`, rujukan baru masuk di antara cek dan hapus) jatuh ke nonaktif. Dipakai Katering, Rute, Kendaraan (Haji dan Vendor sudah punya versi sendiri dengan semantik sama). Respons: `{ deleted: true }` atau `{ deleted: false, deactivated: true, message }`.
- **Cangkang `EditPage`** (`components/admin/shell/`) sepadan `CreatePage`: kembali, banner galat/pesan, bilah simpan sticky, dan "Zona hapus" dengan konfirmasi inline — dipakai halaman edit baru supaya tak ada lagi salinan ad-hoc.
- **Halaman/route baru:** `catering/[id]` (GET/PUT/DELETE), `seasons/[id]` (GET/PUT), `flight/routes/[id]` (GET + perbaikan DELETE), hapus pada `transport/vehicles/[id]`, `system/users/[id]` (GET + `fullName` di PUT). Semua skema ubah `.strict()`; daftar menaut "Kelola/Edit".
- **Bukti**: tes DB untuk helper (termasuk kasus bug rute dengan jadwal nonaktif), uji skema, penjaga sumber (otorisasi di awal, skema strict, hapus lewat helper), Chrome untuk tiap entitas (ubah, hapus tak dirujuk, hapus dirujuk → nonaktif, aktifkan kembali).

## 7. As-built F3 (2026-10-27)

**Dibuat:** `lib/admin/safeDelete.ts` (`deleteOrDeactivate`); `components/admin/shell/{EditPage,useEditEntity}.ts(x)` (cangkang ubah + hook: muat/simpan/hapus dengan respons selalu diperiksa; PUT yang mengembalikan subset baris digabung, bukan menimpa); route baru/diperluas: `catering/[id]` (GET/PUT/DELETE), `seasons/[id]` (+GET/PUT), `flight/routes/[id]` (+GET, **DELETE diperbaiki**), `transport/vehicles/[id]` (+DELETE), `system/users/[id]` (+GET; `fullName` di PUT — nama tak memengaruhi sesi); skema `cateringOptionUpdateSchema`, `seasonUpdateSchema` (urutan tanggal dicek terhadap nilai tersimpan), `fullName` di `userAdminUpdateSchema` (semua `.strict()`); halaman ubah Katering, Musim, Rute penerbangan, Pengguna; daftar menaut ke halaman ubah; halaman Kendaraan: hapus-aman + galat simpan tak lagi ditelan.
**Bug yang ditutup:** `DELETE` rute penerbangan hanya menghitung jadwal AKTIF — rute yang dirujuk jadwal nonaktif atau Paket Umroh gagal dengan galat FK (500); kini semua rujukan dihitung, dirujuk → nonaktif + pesan. Halaman Kendaraan menampilkan "Tersimpan ✓" walau PUT ditolak.
**Bukti (Chrome, dev server + DB uji, route NYATA):** Katering: ubah harga → tersimpan → muat ulang tetap; nonaktif/hapus: tak dirujuk → terhapus dan hilang dari daftar, dirujuk Paket Umroh → **dinonaktifkan** + pesan (DB: `isActive=false`, baris utuh). Musim: tanggal akhir sebelum mulai → ditolak dengan pesan; valid → tersimpan; hapus → daftar. Rute: dengan jadwal nonaktif → dinonaktifkan (sebelumnya 500); tanpa rujukan → ubah lalu hapus. Kendaraan: dipakai harga trip → dinonaktifkan; bebas → terhapus. Pengguna: nama diubah dan tersimpan; tombol simpan nonaktif untuk nama <2 karakter / tak berubah. **Tes:** `scripts/test-admin-crud.ts` (8 uji: helper + DB sungguhan + skema + penjaga sumber) — **3 mutasi tertangkap** (otorisasi PUT dicabut, `.delete()` telanjang, respons hapus tak diperiksa); `bun run test`, `bun run build` (salinan terpisah), `bun audit` hijau.
**Tidak dilakukan (sengaja):** hapus pengguna (mengikuti `docs/arsitektur-hapus-akun.md`, UU PDP); ubah peran/aktif tetap dari daftar (aturan SEC-13). Gap yang tersisa di §5 hanya yang di luar tabel itu: tidak ada.

