# Arsitektur — Pelanggan (daftar & detail akun pemesan di dashboard admin)

> Status: **SELESAI & TERVERIFIKASI 2026-10-29** (eksekusi pertama, "kita evaluasi nanti" — arahan pemilik). Sumber kebenaran untuk menu **Operasional → Pelanggan**.

## 1. Konteks & istilah
- **Pelanggan** (UI admin) = akun yang mendaftar dan memesan = `User` dengan `role = pilgrim`. Nama tabel/kode TIDAK berubah.
- **Jamaah** = orang yang berangkat (`BookingPilgrim`, diisi di manifest tiap pesanan). Satu pelanggan bisa memesan untuk banyak jamaah. Daftar/pencarian jamaah lintas pesanan **di luar fase ini** (data paspor/KTP perlu perlindungan lebih ketat).
- Sebelum ini: hanya **Sistem → Pengguna** (superadmin saja) yang mencampur staf dan pelanggan, tanpa pencarian/filter/jumlah pesanan, detailnya hanya bisa mengubah nama.

## 2. Keputusan pemilik (2026-10-29)
1. Semua peran admin (`admin`/`manager`/`superadmin`) boleh MELIHAT pelanggan (data pribadi: email, HP, alamat — UU PDP). Mengubah status akun tetap superadmin di Sistem → Pengguna.
2. Admin TIDAK mengedit data pelanggan di fase ini (hanya lihat). Perubahan data pribadi: oleh pelanggan sendiri atau alur penghapusan akun UU PDP (`docs/arsitektur-hapus-akun.md`).
3. Jamaah bukan bagian fase ini.

## 3. Rancangan
- **Satu pembaca** `lib/customers/query.ts`: `listCustomers` (filter + halaman + agregat) dan `getCustomer` (detail). Halaman server membaca lewat modul ini; tak ada route API baru (pola daftar booking: Server Component + `requireAdminPage`).
- **Hanya `role = pilgrim`**; staf tak pernah muncul. Akun yang sudah dianonimkan (`deleted-<id>@deleted.invalid`) tampil sebagai "Akun dihapus" tanpa tautan data.
- **Daftar** `/admin/customers`: nama, email, HP/WhatsApp (+ status verifikasi), tanggal daftar, jumlah pesanan, total dibayar (Σ `payments.amount` berstatus `confirmed`), status aktif. Pencarian `q` (nama, email, HP, WhatsApp; ≤ 100 karakter), filter status (aktif/nonaktif), email (terverifikasi/belum), pesanan (pernah/belum). Halaman ber-`paginate`, `orderBy` ber-tie-breaker `id`.
- **Detail** `/admin/customers/[id]`: profil, alamat (dirangkai dari `Address`), cara masuk (Google ya/tidak — hanya boolean), verifikasi, daftar pesanan (tautan ke `/admin/bookings/[id]`), ringkasan pembayaran. Akun non-pilgrim → 404.
- **Data yang TIDAK pernah dibaca**: `passwordHash`, `googleSub`, token, `sessionVersion` (`select` eksplisit; dijaga `scripts/test-customers.ts`).
- Peran: `requireAdminPage(locale)` di baris pertama kedua halaman (SEC-52). Menu di grup Operasional (semua admin).

## 4. Bukti (as-built 2026-10-29)
- `scripts/test-customers.ts` (DB nyata): hanya role pilgrim (staf tak muncul), akun terhapus ditandai, pencarian nama/email/nomor lokal (0812… ↔ 62812…)/WhatsApp, wildcard `%`/`_`/injeksi diperlakukan literal, filter aktif/email/pesanan, agregat (total dibayar hanya `confirmed`), halaman stabil & dijepit, detail non-pilgrim → null, serialisasi tak memuat rahasia, alamat domestik/internasional, penjaga sumber (halaman memanggil `requireAdminPage` lebih dulu dan tak menyentuh Prisma; menu untuk semua admin). 8 mutasi tertangkap semua.
- Server dev + Chrome: menu Operasional → Pelanggan, daftar, pencarian "0812-3456" + filter, detail dengan pesanan; staf → 404; tanpa sesi → 307 ke login; parameter rusak → 200.
- Temuan: Prisma `contains` tidak meloloskan wildcard LIKE (SEC-103, pre-existing di 4 pencarian lain — Pelanggan sudah aman); semua admin melihat data pribadi tanpa log akses (SEC-104, keputusan pemilik).

## 5. Di luar fase ini / catatan evaluasi
Pencarian jamaah (paspor/KTP) lintas pesanan; ekspor CSV; penyuntingan oleh admin; log akses data pribadi (siapa melihat pelanggan mana) — dipertimbangkan bila diwajibkan peninjauan hukum UU PDP.
