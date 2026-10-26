# ADR-0003: Satu alur vendor — entitas tunggal, kategori terkelola admin, kontak terstruktur, picker universal

**Status:** Accepted
**Tanggal:** 2026-10-26

## Context
Audit 2026-10-26 (`docs/arsitektur-vendor.md` §2) menemukan data vendor pecah dan tak terintegrasi:

- `Vendor.category` adalah teks bebas yang mengikuti **modul tempat vendor dibuat** (`syarikah`, `maskapai`, `hotel`, `transport`, `package`, `tour_package`, `haji`, `internal`), bukan jenis vendor. Perusahaan yang menyuplai dua layanan harus dibuat dua kali.
- Vendor dibuat di **6 tempat** dengan formulir berbeda (tab Pengaturan, tiga editor dengan mini "Vendor Baru", editor Visa, panel Komponen Biaya) sehingga hampir semua vendor setengah jadi (9/10 tanpa kontak, 10/10 tanpa alamat, negara selalu default).
- Kontak hanya satu teks bebas, negara teks bebas; tidak ada menu vendor; tidak ada keunikan; `PreferredVendor.vendorId` tanpa foreign key; lima route biaya tidak memeriksa vendor ada (galat 500); vendor internal "Saudinesia" dibuat diam-diam oleh sebuah route; hapus vendor hanya menonaktifkan.
- `docs/arsitektur-harga.md` §18 (2026-07-19) sengaja memilih kategori teks bebas per konteks; praktiknya melahirkan fragmentasi di atas.

Pemilik menginstruksikan: satu alur vendor yang benar, menu khusus di Sistem (kontak, negara, kategorisasi yang benar), semua pemanggil merujuk dan menyimpan ke sana lewat satu komponen konsisten, **tanpa dualisme data vendor**, dan jalur vendor lain dihapus.

## Decision
1. **Satu entitas `Vendor`** adalah satu-satunya tempat data vendor; semua referensi memakai foreign key ke `Vendor.id` (`PreferredVendor` mendapat FK). `VisaApplication.vendorIdsUsed` tetap sebagai snapshot riwayat berisi id saja; vendor yang pernah dirujuk tidak pernah dihapus keras.
2. **Kategori dikelola admin** dalam tabel `VendorCategory` (bukan teks bebas atau enum kode), dengan relasi **many-to-many** ke vendor (satu perusahaan = satu baris, banyak layanan; minimal satu kategori). Kategori baku bawaan (`hotel`, `transport`, `airline`, `visa`, `catering`, `guide`, `tour-operator`, `internal`, `other`) bertanda `isSystem`: slug stabil dan tak dapat dihapus, dipakai kode sebagai konteks picker. Admin dapat menambah kategori; slug unik mencegah duplikat (409 menyebut yang sudah ada).
3. **Kontak dan negara terstruktur**: `countryCode` ISO 3166-1 alpha-2 (wajib, dari daftar `COUNTRIES` yang sama dengan modul lain), PIC, telepon dan WhatsApp (kode negara + nomor), email, website, catatan, dan alamat via `AddressPicker`. Kolom lama `category`, `country`, `contactInfo` dihapus setelah datanya dimigrasi.
4. **Keunikan dan integritas**: `(nameKey, countryCode)` unik; satu fungsi `assertVendorUsable` (vendor ada dan aktif) dipakai semua route yang menyimpan `vendorId`; hapus bersemantik aman — hapus sungguhan hanya bila tak dirujuk (biaya, vendor pilihan, snapshot visa), selain itu nonaktif + pesan + dapat diaktifkan kembali; **vendor sistem** (`systemKey`, mis. Saudinesia internal untuk Muthowif) dibuat oleh migrasi, tidak dapat dihapus/dinonaktifkan.
5. **Satu pintu tulis dan satu formulir**: hanya `/api/v1/admin/system/vendors*` dan `/vendor-categories*` (superadmin) yang menulis; manager mendapat bacaan ramping. `VendorForm` dipakai menu Vendor dan modal "Vendor Baru". **`VendorPicker`** adalah satu-satunya cara memilih vendor di admin (penyaring konteks kategori hanya tampilan; server hanya menegakkan vendor ada dan aktif). Mini quick-add, `VendorField` Visa, `lib/admin/vendorQuickAdd.ts`, dan route `…/settings/vendors` dihapus.
6. **Menu Sistem → Vendor** (daftar, detail/edit dengan panel pemakaian, kategori); tab vendor di Pengaturan dihapus.
7. **Migrasi data** satu migrasi fail-closed dengan pemetaan eksplisit (`syarikah→visa`, `maskapai→airline`, `hotel→hotel`, `transport→transport`, `internal→internal`, sisanya `other` untuk ditinjau admin; negara teks→ISO; `contactInfo`→`notes`); nilai tak dikenal atau tabrakan nama membuat migrasi gagal, bukan menebak. Dibuktikan rekam-bandingkan (jumlah, id, hasil harga identik) pada salinan DB.

Rencana fase dan rancangan rinci: `docs/arsitektur-vendor.md`.

## Alternatif yang Dipertimbangkan
- **Kategori enum kode / daftar baku saja** — rapi tetapi menambah jenis vendor butuh perubahan kode dan deploy; pemilik memilih daftar yang dikelola admin. Risiko kategori ngawur diatasi slug unik + deteksi duplikat + kategori sistem terkunci.
- **Satu kategori per vendor** — membuat perusahaan multi-layanan harus berbaris ganda (dualisme yang ingin dihapus).
- **Tetap teks bebas per konteks (ADR/§18 lama)** — sumber fragmentasi sekarang.
- **Membuat vendor hanya lewat menu (picker hanya memilih)** — paling bersih tetapi memutus alur kerja admin; modal dengan formulir yang sama menjaga satu sumber kolom/validasi tanpa pindah halaman.
- **Menghapus data lama dan input ulang** — menghilangkan 18 komponen biaya yang sudah diisi; migrasi dengan pemetaan fail-closed cukup aman.
- **Memaksa kategori vendor sesuai konteks di server** — menolak penggunaan sah (mis. pemandu untuk komponen paket); yang ditegakkan hanya integritas (ada dan aktif).

## Konsekuensi
- Satu sumber kebenaran vendor, data lengkap (negara, kontak, kategori), pemakaian terlihat, tak ada vendor yatim atau ganda; semua editor memakai satu komponen sehingga pengisian konsisten.
- Perubahan lebar (skema, ±45 berkas menyebut vendor, 6 situs UI) — dikerjakan lima fase dengan bukti rekam-bandingkan agar harga/HPP tidak berubah.
- Vendor lama dengan kategori `package`/`tour_package`/`haji` mendarat di `other` dan perlu dikategorikan ulang manual oleh admin.
- Kategori terkelola admin tetap berisiko duplikat semantik (mis. "Bus" vs "Transportasi") yang hanya dicegah sebatas slug identik; penggabungan kategori/vendor otomatis di luar scope.
- Menggantikan keputusan kategori teks bebas di `docs/arsitektur-harga.md` §18 dan `docs/decisions.md` 2026-07-19 (kategori `Vendor`); bagian itu ditandai digantikan pada fase penutup.

---
> Aturan: file ADR TIDAK diedit setelah Accepted. Kalau keputusan berubah,
> buat ADR baru dan tulis "Supersedes ADR-XXXX" di file baru itu.
