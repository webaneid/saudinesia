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
- Temuan: Prisma `contains` tidak meloloskan wildcard LIKE (SEC-103 — Pelanggan aman sejak awal; 4 pencarian lain diperbaiki 2026-10-30, `escapeLike` kini di `lib/utils/search.ts`); semua admin melihat data pribadi tanpa log akses (SEC-104, keputusan pemilik).

## 5. Di luar fase ini / catatan evaluasi
Pencarian jamaah (paspor/KTP) lintas pesanan; ekspor CSV; penyuntingan oleh admin; log akses data pribadi (siapa melihat pelanggan mana) — dipertimbangkan bila diwajibkan peninjauan hukum UU PDP.

## 6. Tambah Pelanggan (rencana + keputusan, 2026-10-30)
Arahan pemilik: admin bisa MENAMBAH pelanggan lewat formulir (menggantikan "admin tak mengedit" §2.2 untuk pembuatan; edit data tetap di luar fase).

**Recheck kode (SOP 1):** identitas akun = email; password tak pernah dipasang pihak lain sebelum pemilik email membuktikan kepemilikan (`docs/arsitektur-auth.md` §3.2, SEC-02/17); login mensyaratkan `isActive` DAN `emailVerifiedAt`; `resetPassword()` SUDAH "mengaktifkan akun lama yang belum terverifikasi" (menyetel `emailVerifiedAt`) dan mematikan sesi lama; persetujuan UU PDP dicatat oleh PEMILIK email (`ConsentLog` saat daftar manual/Google/Lengkapi data) — tak pernah oleh staf; notifikasi WhatsApp hanya bila ada persetujuan (`notify.ts`, gagal-aman: email tetap).

**Keputusan (asumsi — mohon dikoreksi):**
1. **Siapa:** semua peran admin boleh menambah (tugas operasional; satu titik `lib/customers/policy.ts`).
2. **Akun lahir "belum diaktifkan":** `role pilgrim`, `isActive true`, `emailVerifiedAt null`, password ACAK yang tak diketahui siapa pun → tak bisa login sampai pemilik email membuat password lewat tautan. Admin TIDAK pernah mengetik/melihat password pelanggan.
3. **Undangan email** (kotak centang, bawaan aktif): tautan "buat password" berlaku **7 hari**, memakai alur reset-password yang ada (token 256-bit sekali pakai, hanya hash disimpan). Kirim ulang dari detail pelanggan selama akun belum diaktifkan. Pembatasan: per alamat (`authEmailSendEmail`) dan per admin (`customerInviteAdmin`).
4. **Persetujuan tidak dicatat admin.** Gerbang "Lengkapi data" diperluas: jamaah yang belum punya persetujuan Kebijakan Privasi dan/atau notifikasi WhatsApp diarahkan ke sana (bersama nomor yang sudah diisi admin) sebelum halaman jamaah mana pun dan sebelum membuat booking (juga di server).
5. **Isian:** nama dan email wajib; telepon/WhatsApp dan alamat opsional (komponen universal `ContactPicker`/`AddressPicker`, validasi server `.strict()`).
6. **Email sudah terdaftar → 409** dengan pesan jelas (konteks staf; bukan halaman publik, jadi bukan celah enumerasi).
7. **Di luar fase:** membuat booking atas nama pelanggan (engine baru), mengedit data pelanggan, impor massal, log akses (SEC-104).

### 6.1 As-built (2026-10-30)
- **Kode:** `lib/customers/create.ts` (`createCustomer`: cek email → validasi hierarki alamat → transaksi alamat + akun; password acak 256-bit yang dibuang; P2002 → 409; `inviteCustomer`: hanya pilgrim aktif yang belum diaktifkan, token `password_reset` ber-TTL 7 hari via `issueToken({ ttlMs })`, email `account_invitation`), `lib/customers/policy.ts`, `lib/validators/customers.ts` (`.strict()`), route `POST /api/v1/admin/customers` dan `POST /api/v1/admin/customers/[id]/invite` (batas laju `customerCreateAdmin`/`customerInviteAdmin` + `authEmailSendEmail` per alamat; token tak pernah di respons; log hanya id).
- **Gerbang persetujuan:** `lib/auth/contact.ts` `getOnboardingState`/`isOnboardingComplete` (kontak lengkap + `privacy_policy` + `whatsapp_notifications`) dipakai layout jamaah, halaman Lengkapi data, dan `requireContactForBooking` (server); `PUT /auth/contact` menolak bila privasi belum disetujui dan mencatatnya hanya atas tindakan pemilik, ATOMIK di dalam transaksi terkunci `updateContact` (`privacyConsent: true`); formulir Lengkapi data menampilkan kotak privasi bila perlu.
- **UI:** `/admin/customers/new` (`CreatePage` + `ContactPicker` + `AddressPicker`, kotak "kirim undangan"), tombol "Tambah Pelanggan" di daftar, detail: banner hasil undangan (`?invite=`) + kartu "Akun belum diaktifkan" dengan "Kirim undangan aktivasi".
- **Bukti:** `scripts/test-customers-create.ts` (15 uji, DB nyata + server Resend palsu: akun lahir belum diaktifkan, tebakan password tak cocok, email unik + balapan 5 admin, alamat tak yatim, tautan di EMAIL benar-benar mengaktifkan akun lewat reset-password, 7 hari, hanya hash tersimpan, tautan lama hangus, gerbang persetujuan, skema strict, guard route) + 10 mutasi tertangkap (dua yang sempat lolos diperketat); `test-auth` disesuaikan; Chrome end-to-end dengan peran **Admin biasa**: formulir → akun dibuat (email dinormalisasi huruf kecil) → banner undangan → kirim ulang → tautan (dari log dev) → buat password → langsung digerbang "Lengkapi Data" (nomor dari admin terisi, dua persetujuan) → dashboard; di DB tercatat tepat dua ConsentLog atas nama pemilik; HTTP: duplikat 409, kolom liar 400, tanpa sesi 403, undang akun aktif 409.
- **Hasil audit keamanan (subagent `security-auditor`, 2026-10-30):** 0 Critical, 0 High, 0 Medium, 6 Low. Diperbaiki: (1) rute undangan memeriksa kelayakan (`findInvitable`) SEBELUM menghabiskan kuota email per alamat, baru `sendInvitation`; (2) login Google atas akun belum diaktifkan menghanguskan semua token `password_reset` yang belum terpakai (undangan 7 hari tak boleh hidup setelah akun diambil alih lewat jalur lain); (3) persetujuan privasi dicatat di transaksi `updateContact` yang sama (tak ganda pada PUT paralel — diuji 5 paralel → 1 catatan), `ensurePrivacyConsent` dihapus; (5) `addressSchema` bermaks panjang (alamat 500, kode pos 20, kota/provinsi 100) dan `prepareAddressData` menolak `provinceId` yang tak ada; (6) akun anonim UU PDP dicek sebelum "nonaktif" supaya pesannya benar. Dicatat (SEC-106/107): serialisasi `issueToken`, token-sebelum-kirim, gerbang persetujuan hanya ditegakkan server di `POST /bookings`.
- **Penutupan SEC-106/107 (2026-10-30):** (a) `issueToken` diserialkan dengan kunci penasihat transaksi; (b) tautan undangan lama hanya dihanguskan setelah email baru benar-benar terkirim (`keepExisting` → `supersedeOlderTokens`; gagal/dilewati → `discardToken`; development mempertahankan token karena tautan ada di log); (c) `notify()` tidak mengirim email ke alamat yang belum diverifikasi pemiliknya — penting saat kelak admin memesan atas nama pelanggan; (d) gerbang langkah awal kini ditegakkan di server pada SEMUA endpoint jamaah yang mengumpulkan data pribadi/uang lewat `onboardingRefusal` (pesan, dokumen, bukti bayar, alamat, profil), tidak pada hak jamaah (batalkan, hapus, minta hapus akun).
