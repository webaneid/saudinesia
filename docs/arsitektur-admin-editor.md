# Arsitektur — Tata Letak Editor Admin ala WordPress (konten di kiri, kotak samping di kanan)

> **Status: F1 + F2 SELESAI & TERVERIFIKASI (2026-10-27) — Paket Umroh + 8 halaman edit produk lain; F3 (kategori) menunggu keputusan model.** Arahan pemilik: pengguna sudah terbiasa dengan UI WordPress — kolom kanan berisi *Terbitkan*, *Gambar Unggulan*, kategori/atribut (bila ada) — itu jauh lebih membantu daripada kotak-kotak terpisah yang tak beraturan seperti sekarang. **Mulai dari Paket Umroh.**

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
| **F2** ✅ | Halaman edit lain memakai tata letak yang sama: Haji, Paket Ziarah, Hotel, Visa, Katering, Muthowif, Situs Wisata, Kendaraan (§5) |
| **F3** | Taksonomi/kategori produk bila diputuskan (model + kotak Kategori di sidebar) |

## 4. As-built F1 (Paket Umroh)

- **Komponen** `components/admin/editor/`: `EditorShell` (kiri `title`+`main`, kanan `aside` lengket `lg:top-20`, `mobileBar` lengket di dasar HP), `MetaBox` (isi tetap ter-mount saat dilipat — isian tak hilang), `PublishBox` (Status + opsi + hint + Simpan; tombol aktif hanya bila `dirty`), `useUnsavedGuard` (`beforeunload`).
- **Halaman** `products/packages/[id]/page.tsx`: judul besar + deskripsi kaya + Highlight + 7 kotak komponen (terbuka bila mode ≠ `none`, badge mode di kepala kotak) + Komponen Biaya + Rincian Harga di kiri; Terbitkan, Foto Unggulan, Atribut (label harga), Ringkasan Harga (`baseTotal`) di kanan.
- **Perilaku — tidak ada perubahan API/data**, tetapi tiga perbaikan yang ditemukan saat menata ulang: (1) `patch()` kini memeriksa respons dan menampilkan galat server (dulu ditelan; baseline "tersimpan" tidak maju bila gagal); (2) muat-ulang akibat kotak komponen (`refreshAll`) tidak lagi menimpa ketikan info yang belum disimpan — hanya muat awal yang mereset `form` (`loadPackage(id, true)`); (3) penanda "Ada perubahan belum disimpan" dan peringatan keluar halaman.
- **Penjaga CI** `scripts/test-admin-editor.ts` (dalam `bun run test`): halaman edit terdaftar wajib memakai `EditorShell/PublishBox/MetaBox/useUnsavedGuard`, tidak kembali ke `admin-form-panel`/kartu manual, respons simpan diperiksa, muat-ulang tak menimpa isian. **Halaman edit yang dimigrasi di F2 wajib ditambahkan ke daftar `EDITORS` di skrip itu.**
- **Bukti**: Chrome asli — dua kolom + sidebar `position: sticky` di layar lebar, satu kolom + bilah simpan lengket di 390px; Simpan nonaktif saat bersih → aktif + "Ada perubahan belum disimpan" saat diketik; mengubah mode kotak komponen tidak menghapus ketikan nama; simpan tersimpan & bertahan setelah muat ulang; tanpa galat konsol. `bun run test` 408 PASS; build terisolasi 0 error.

## 5. As-built F2 (2026-10-27)

**Dua pola, satu tata letak.** Recheck menemukan hanya Katering (dan halaman non-produk seperti Musim/Rute/Pengguna) yang berbasis `EditPage`; Haji, Muthowif, Situs, Kendaraan, Hotel, Paket Ziarah, Visa bespoke. Maka:

| Pola | Halaman | Cara |
|---|---|---|
| **`EditPage` + `useEditEntity`** (formulir tunggal) | Katering, Muthowif, Situs Wisata, Kendaraan, Haji | `EditPage` sendiri kini = `EditorShell` + `PublishBox` + `DeleteBox`: kiri formulir (+ `after` di luar `<form>`, mis. Komponen Biaya Haji), kanan Terbitkan (status via `active`/`onActiveChange`, Simpan, `dirty`), `media` (Foto/Galeri), `sidebar` (ringkasan/catatan), Hapus. Musim/Rute/Pengguna ikut memakai tata letak ini otomatis (tanpa foto; `dirty` tak dilacak → Simpan selalu aktif). Prop `top` dihapus, diganti `media`. |
| **`EditorShell` langsung** (banyak kotak yang tersimpan sendiri) | Paket Umroh (F1), Hotel, Paket Ziarah | Judul besar + deskripsi, kotak meta (`MetaBox`, ber-badge mode / `aside` tombol tambah), kanan: Terbitkan, Galeri, Atribut/Ringkasan Harga. |
| **Sudah dua kolom** | Visa | Hanya Foto Unggulan dipindah dari kolom utama ke kolom kanan (setelah Publikasi). Struktur tab + bilah simpan sticky Visa dipertahankan. |

**Komponen baru/diubah:** `useDirtyForm(form)` (baseline eksplisit lewat `markClean(nilai)` setelah muat & simpan berhasil, `patchClean` untuk pergeseran sebagian), `DeleteBox` (konfirmasi inline, bukan `window.confirm`), `PublishBox` (status opsional, `dirty` opsional = tak dilacak), `useEditEntity` (`save` → boolean, `remove` → `'deleted'|'deactivated'|'error'`, `reload`).

**Aturan yang dibuktikan di Chrome:** formulir `EditPage` diisi SEKALI dari data yang dimuat (`!form`), sehingga muat-ulang (mis. harga Haji berubah dari Komponen Biaya, atau item dinonaktifkan server) tidak menimpa ketikan; setelah hapus-yang-menonaktifkan, form dan baseline digeser (`patchClean({ isActive: false })`).

**Bug ditemukan & ditutup lewat verifikasi:**
1. **Penanda "belum disimpan" palsu** — Tiptap memancarkan satu `update` saat dimuat (0 langkah) yang menormalkan teks polos lama jadi JSON, sehingga Haji/Muthowif/Situs/Hotel/Ziarah tampak berubah sejak dibuka. Diperbaiki di `RichTextEditorImpl` (`if (!transaction.docChanged) return`); ketikan nyata tetap diteruskan (diuji: ketik di bio → tersimpan sebagai JSON).
2. **Simpan menelan galat** di Muthowif, Situs, Hotel, Paket Ziarah (respons tak diperiksa) — kini galat server tampil.
3. **Muat-ulang menimpa ketikan** di Paket Ziarah (`loadPackage` mereset info tiap refresh kotak komponen) — `resetInfo` seperti Paket Umroh.

**Penjaga CI:** `scripts/test-admin-editor.ts` (daftar `SHELL_PAGES` + `EDITPAGE_PAGES`; formulir diisi sekali; `media=` bukan `top=`; tak ada kartu manual/`ArrowLeft` ad-hoc; respons simpan diperiksa; Foto Visa di sidebar; `DeleteBox` konfirmasi inline), `test-admin-crud.ts` (4 halaman baru masuk daftar `EditPage`+`useEditEntity`), `test-haji-pricing.ts` (penjaga UI Haji disesuaikan ke struktur baru, perilaku sama).

**Gap yang tetap (dicatat, di luar scope tata letak):** Muthowif, Situs Wisata, Hotel, Paket Umroh, Paket Ziarah belum punya hapus sungguhan (API DELETE tidak ada) — kotak Hapus tidak ditampilkan; `DELETE` Visa mengembalikan `ok(null)` dan belum bersemantik dirujuk→nonaktif (FK → 500), sehingga Visa belum bisa memakai `useEditEntity`. Dijadwalkan sebagai perapian CRUD.

## 6. Perapian hapus (2026-10-27)

Menutup gap §5: Muthowif, Situs Wisata, Hotel, Paket Umroh, Paket Ziarah kini bisa dihapus, dan Visa bersemantik hapus-aman. **Recheck sebelum membangun** menemukan tiga hal yang tak bisa diserahkan ke FK saja:

1. **FK `ON DELETE SET NULL` bukan perlindungan** — ia tidak menolak hapus, ia diam-diam *mengosongkan riwayat*: `booking_muthowif.muthowifId` (siapa yang bertugas), `visa_applications.visaProductId`, `packages.includedVisaProductId`/`includedHotel*ScheduleId`, `booking_tour_packages.chosenHotelRoomScheduleId`. Semuanya dihitung eksplisit sebagai rujukan. (`DELETE` Visa lama langsung `prisma.visaProduct.delete` — akan menghapus pengajuan-visa-nya dari riwayat atau 500 bila ada rujukan RESTRICT.)
2. **Baris polimorfik tanpa FK menjadi yatim** — `product_costs`, `preferred_vendors`, `document_requirements`, `manifest_field_requirements` (kunci `productType`+`productId`), dan foto. Visa lama meninggalkan yatim (syarat dokumen, field manifest, biaya); kini dibersihkan di transaksi yang sama (`dropPolymorphic`), foto setelah commit (`purgeProductMedia`).
3. **Hitung → hapus bisa disalip** — rujukan baru yang masuk di antaranya. `SELECT … FOR UPDATE` pada baris induk (FK mengambil KEY SHARE) membuat hapus menunggu rujukan yang sedang masuk lalu menghitung ulang; ada rujukan → jalur nonaktif. Terbukti oleh tes race dan satu mutasi (tanpa kunci → tes merah).

**Implementasi:** `lib/admin/productDelete.ts` (`deleteMuthowif/TourismSite/Hotel/Package/TourPackage/VisaProduct`, semuanya lewat satu `deleteOrDeactivate`), route `DELETE` di 6 route (`requireManager` lebih dulu; 404/403/500 dibedakan), UI: `EditPage.remove` (Muthowif, Situs), `DeleteBox` + `useDeleteEntity` (Hotel, Paket Umroh, Paket Ziarah), `DangerZone` Visa menangani dua hasil (terhapus → daftar; dinonaktifkan → pesan + status & baseline bergeser).

**Aturan rujukan per entitas:** Muthowif = penugasan booking; Situs = situs di paket ziarah; Paket Ziarah = booking paket ziarah; Paket Umroh = *tidak ada* tabel booking yang merujuk hari ini (booking engine akan dirombak) → selalu terhapus; Visa = booking visa + pengajuan visa + opsi paket + visa "included"; Hotel = booking kamar/layanan + opsi/included paket umroh + hotel/opsi paket ziarah + pilihan kamar di booking ziarah. Hotel juga menghapus alamat 1:1 miliknya.

**Penjaga CI `scripts/test-admin-delete.ts`** (DB sungguhan, 13 tes): tiap entitas dua jalur (terhapus beserta anak/polimorfik/foto; dirujuk → nonaktif dengan rujukan utuh), tes race, **penyidik FK** (daftar FK masuk per entitas — FK baru ke tabel ini membuat tes merah sampai penghitungan diperbarui) dan **penyidik tabel polimorfik** (tabel baru ber-`productType` memaksa keputusan), penjaga sumber route. 6 mutasi tertangkap (visaApplication tak dihitung, penugasan tak dihitung, polimorfik tak dibersihkan, tanpa `FOR UPDATE`, alamat yatim, pilihan kamar tak dihitung). **Paket Umroh baru**: bila booking engine baru menambah FK ke `packages`, penyidik FK merah → ubah `deletePackage.count`.

**Bukti Chrome:** 8 entitas via UI — bebas → kembali ke daftar & baris hilang di DB; dirujuk → pesan "sehingga tidak dihapus — dinonaktifkan…", saklar jadi Nonaktif, penugasan muthowif tetap menunjuk muthowifnya; mengaktifkan kembali + simpan bertahan setelah muat ulang.

**Gap tersisa:** SEC-70 (Low): kunci Hotel hanya pada baris hotel, bukan jadwal kamar anak — jendela sempit untuk rujukan SET NULL di level jadwal (`docs/lessons-learned.md`).
