# Arsitektur — Media Produk Universal (Foto Unggulan + Galeri)

> **Status: RENCANA (2026-10-27), belum dieksekusi.** Pemicu: pemilik mengusulkan agar Haji, Umroh, Katering, dll. juga punya foto — lebih menarik secara UI — dengan foto dijadikan **komponen** yang dipakai di mana-mana (*featured image*); hanya Hotel dan Ziarah yang butuh galeri. Sejajar komponen universal lain (harga, dokumen, manifest, alamat, kontak, biaya, vendor).

## 1. Recheck (kode aktual, 2026-10-27)

| Entitas | Foto hari ini | Catatan |
|---|---|---|
| Hotel | `images Json` (galeri) + `featuredImageKey`; route `…/hotels/[id]/images` (GET/POST/DELETE); `ProductMediaGallery` | Satu-satunya yang punya "sampul" eksplisit |
| Kendaraan transport | `images Json`; route `…/vehicles/[id]/images`; `ProductMediaGallery`; katalog memakai foto pertama sebagai sampul | Galeri tanpa sampul eksplisit |
| Muthowif | `photoKey` tunggal; route `…/muthowif/[id]/photo` | Foto profil |
| Situs Wisata | `photoKey` tunggal; route `…/tourism-sites/[id]/photo` | |
| **Haji, Paket Umroh** | kolom `images Json` **ada tetapi tak pernah ditulis atau dirender** (tanpa route/UI) | kolom mati |
| Katering, Visa, Paket Ziarah, Pesawat, Trip | tidak ada | |

**Masalah struktural:** empat implementasi salinan (tiga bentuk kolom berbeda: `images`, `images+featuredImageKey`, `photoKey`); tiap route mengulang validasi MIME/ukuran; **validasi hanya mempercayai `file.type` dari klien** (tak ada pemeriksaan isi/magic bytes — pelanggaran semangat "validasi server-side" di CLAUDE.md); setiap halaman publik membangun URL presigned sendiri (`getPresignedUrl(…, 3600)` per kartu, tanpa batch/cadangan visual); tak ada alt-text; menghapus produk tidak otomatis membersihkan objek MinIO (risiko yatim); tak ada ukuran turunan (gambar asli ≤5 MB dimuat di kartu). `lib/storage/minio-loader.ts` (loader `next/image` untuk gambar publik) ada tetapi tak dipakai — bucket private, jadi presigned.

## 2. Pendapat dan keputusan

**Ya, menarik dan layak** — katalog tanpa gambar terasa kosong; foto sampul adalah peningkatan UI dengan biaya terendah, dan karena kolom `images` Haji/Paket sudah mati, ini sekaligus membersihkan utang.

Keputusan (usulan, dapat diubah sebelum F1):
1. **Satu tabel polimorfik `ProductImage`** (`productType`, `productId`, `key`, `alt`, `sortOrder`, `isFeatured`, ukuran) — pola yang sama dengan `ProductCost`/`ManifestFieldRequirement`/`DocumentRequirement` — menggantikan semua kolom foto per-model. Alasan: satu implementasi, satu route, satu komponen, penghapusan produk membersihkan objeknya lewat registry pemilik.
2. **Dua mode per tipe lewat registry** (`lib/media/owners.ts`, sejajar `costComponentOwners`): `featured` (tepat satu foto) dan `gallery` (banyak, satu ditandai sampul, batas jumlah). Usulan: **gallery** = Hotel, Paket Ziarah; **featured** = Haji, Paket Umroh, Katering, Visa, Muthowif (foto profil), Situs Wisata; **Kendaraan** = *gallery* (sudah galeri; menurunkannya menghilangkan fitur — keputusan pemilik).
3. **Komponen admin tunggal `MediaField`** (`mode="featured" | "gallery"`) menggantikan `ProductMediaGallery` dan dua route foto tunggal; **komponen tampilan `ProductImage`** (+ helper server `getProductImages(type, ids)` batch) dengan *placeholder* ikon per tipe bila belum ada foto — sehingga katalog tak pernah "bolong".
4. **Satu jalur unggah**: `/api/v1/admin/media/[productType]/[productId]` (GET/POST/PATCH sampul-urutan-alt/DELETE), otorisasi `requireManager`, validasi **MIME dari isi file** (magic bytes JPEG/PNG/WebP) + ukuran + jumlah, kunci objek dibuat server (`{entity}/{id}/images/…`), DELETE hanya objek yang tercatat (SEC-62).
5. **Ukuran turunan**: simpan asli + turunan kartu (±640px) dan detail (±1280px) saat unggah (`sharp` sudah bagian dari Next) supaya kartu katalog ringan; presigned tetap (bucket private).
6. **Migrasi ekspansi–kontraksi** seperti vendor: F1 buat `product_images` + isi dari kolom lama (Hotel/Kendaraan/Muthowif/Situs; kunci objek MinIO dipertahankan, tanpa salin berkas); kolom lama dibuang di fase kontraksi. Data dev boleh hilang, tetapi arsitektur migrasinya tetap fail-closed dan teruji.
7. **Unggah saat membuat**: halaman `/new` tidak bisa mengunggah sebelum entitas ada; setelah simpan, pengguna masuk ke halaman edit yang menampilkan `MediaField` (sampul adalah langkah pertama di sana). Opsi "pilih berkas di halaman buat, unggah otomatis setelah simpan" dicatat sebagai peningkatan, bukan F1.

## 3. Fase

| Fase | Isi | Bukti |
|---|---|---|
| **F1** | Skema `ProductImage` + migrasi ekspansi (isi dari kolom lama) + `lib/media/` (registry pemilik, validasi isi, turunan ukuran, batch presign, pembersihan) + route generik; route lama jadi tipis/dihapus bertahap | Tes DB + magic-bytes (file palsu ber-MIME gambar ditolak), uji migrasi, HTTP nyata (kasus ditolak: tipe tak terdaftar, bukan manajer, key asing) |
| **F2** | `MediaField` (featured/gallery) dipasang di semua halaman edit sesuai registry; `ProductMediaGallery` dihapus | Chrome: unggah, sampul, urut, alt, hapus, di tiap tipe |
| **F3** | `ProductImage` + `getProductImages` di semua katalog publik (Haji, Paket, Katering, Visa, Hotel, Ziarah, Kendaraan, Muthowif, Situs) dengan placeholder | Chrome: kartu berfoto dan placeholder; ukuran gambar kartu |
| **F4** | Migrasi kontraksi (drop kolom foto lama + route lama), pembersihan objek saat produk dihapus, penjaga CI (tak ada kolom foto per-model baru), dokumen as-built | `grep` bukti; semua suite |

## 4. Risiko
- URL presigned kedaluwarsa (1 jam) pada halaman yang di-cache — katalog tetap dinamis; tak ada ISR untuk halaman bergambar.
- Menurunkan Kendaraan ke featured menghapus galeri — default usulan: dipertahankan galeri.
- Biaya CPU turunan ukuran saat unggah — dibatasi 5 MB per file dan satu file per permintaan.
