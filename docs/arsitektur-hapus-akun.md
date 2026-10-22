# Arsitektur — Penghapusan Akun (UU PDP) — SEC-44

> Status: **SELESAI & TERVERIFIKASI (2026-10-22)** — as-built di §9; §2–§4 sudah mencerminkan perubahan dari review keamanan (DEL-01..08).
> Konteks: `docs/lessons-learned.md` SEC-44 (Medium, blocker go-live), `docs/RETROFIT-GAPS.md` #2, `docs/decisions.md` 2026-09-15.
> Bergantung pada: pencabutan sesi (`docs/arsitektur-auth.md` §11) — penghapusan akun harus memutus semua sesi.

## 1. Recheck dokumen vs kode (SOP langkah 1, 2026-10-22)

Dokumen lama (`decisions.md` 2026-09-15, komentar `schema.prisma`): "permintaan masuk antrean, diproses manual superadmin; bukan hard-delete otomatis". Kode aktual:

| Klaim / harapan | Kenyataan di kode |
|---|---|
| Superadmin "memproses" permintaan | `PATCH /admin/deletion-requests/[id]` hanya `update` status `completed|rejected` + `processedAt`. **Tidak menghapus/anonimkan apa pun**: akun tetap aktif dan bisa login, `email`/`fullName`/`phone`/`whatsapp`/`googleSub`/`passwordHash`/`Address`/`NotificationLog.recipient+messagePreview`/`BookingPilgrim.fieldValues`/`Document` (+ objek MinIO) utuh; nomor WhatsApp terverifikasi tetap mengunci nomor; email tak bisa dipakai mendaftar ulang. Catatan audit UU PDP menjadi palsu. |
| Transisi status | Tidak ada state machine: `completed` bisa ditimpa `rejected` dan sebaliknya. |
| Validasi input | `await req.json()` tanpa `.catch` (JSON rusak → 500; pola SEC-49); id tak ada → Prisma P2025 → 500; `console.error('…', e)` mencetak objek galat penuh (pola SEC-23). |
| Pengajuan | `POST /account/deletion-requests`: `requireSession()` saja — akun staf/agen pun bisa mengajukan; tanpa rate limit. |
| UI jamaah | `DeletionRequestCard` menjanjikan "riwayat transaksi tetap disimpan sesuai kewajiban hukum/pajak" — kebijakan retensi memang sudah dijanjikan ke pengguna. |

## 2. Keputusan desain (default yang dipilih; butuh peninjauan hukum sebelum go-live)

> Ini bukan nasihat hukum. Halaman `/privacy` sudah ditandai "draft, perlu review legal"; aturan retensi di bawah ikut harus ditinjau penasihat hukum/pajak pemilik.

1. **Anonimisasi, bukan hard delete.** `Booking`/`Payment`/`Refund` (angka, kode, tanggal, status) dipertahankan untuk kewajiban pembukuan/pajak (janji kepada pengguna). Yang dihapus/diacak adalah **data pribadi**. `ConsentLog` dipertahankan (bukti persetujuan; hanya `userId` + jenis + versi — tak memuat PII setelah akun dianonimkan). `AccountDeletionRequest` dipertahankan sebagai catatan akuntabilitas.
2. **Hanya jamaah (`pilgrim`) lewat jalur ini.** Staf/agen dikeluarkan dengan menonaktifkan akun (SEC-18), bukan jalur UU PDP.
3. **Syarat sebelum diproses (blocker, dicek ulang di dalam transaksi dengan kunci baris):**
   - tidak ada booking berstatus `awaiting_payment`, `payment_review`, `confirmed`, `active` (jamaah membatalkan dulu atau menunggu selesai);
   - tidak ada `Refund` berstatus `pending`/`approved` (uang belum tuntas);
   - peran harus `pilgrim`.
   Pemeriksaan di pratinjau (non-kunci) dipakai UI; keputusan otoritatif di dalam transaksi.
4. **Satu transaksi, urutan tetap, aman diulang:** kunci baris permintaan + pengguna (`FOR UPDATE`) → cek ulang SEMUA syarat → BARU hapus objek MinIO (idempoten; objek hilang ≠ galat) → ubah DB. Dengan urutan ini tidak ada jalur abort (penolakan/penarikan paralel, blocker baru, konfirmasi salah) yang terjadi SETELAH berkas terhapus (DEL-03; rancangan awal menghapus berkas dulu di luar kunci dan itu salah). MinIO gagal → rollback total (akun kembali aktif), permintaan tetap `pending`. DB gagal sesudah objek terhapus → ulang aman.
5. **Konfirmasi tak bisa diklik tanpa sadar:** admin harus mengetik ulang email pemilik akun (`confirmEmail`) untuk `completed`; UI memperlihatkan pratinjau (apa yang dihapus, jumlahnya, blocker) lebih dulu.
6. **Pemberitahuan ke subjek data:** email SAAT PENGAJUAN ("bukan Anda? batalkan"), saat selesai, dan saat ditolak (dengan catatan) — ke alamat ASLI; alamat tidak disimpan di mana pun setelah selesai; gagal kirim tidak membatalkan apa pun (dicatat tanpa PII).
6a. **Masa tunggu 72 jam** (`MIN_WAIT_HOURS`) sebelum `completed` boleh dieksekusi (blocker di server); penolakan tidak menunggu. Menangkal penghapusan seketika oleh pemegang sesi curian dan memberi pemilik sah waktu membatalkan (DEL-02). **Default saya, bukan keputusan pemilik** — ubah konstanta bila perlu.
6b. **Pemilik bisa menarik permintaan** selagi `pending` (`DELETE /account/deletion-requests`, status `withdrawn`).
7. **Ringkasan penghapusan** (`erasureSummary`: jumlah baris per jenis, tanpa PII) disimpan di permintaan — bukti akuntabilitas.

## 3. Apa yang terjadi pada tiap data

| Data | Perlakuan | Alasan |
|---|---|---|
| `User.email` | → `deleted-<id>@deleted.invalid` (unik, TLD `.invalid` tak bisa dikirimi) | email asli bebas dipakai mendaftar ulang |
| `User.fullName` | → `Akun Dihapus` | |
| `phone`, `whatsapp`, `whatsappVerifiedAt`, `verifiedWhatsapp`, `googleSub` | → `null` | membebaskan kunci unik nomor/Google |
| `passwordHash` | → hash acak yang tak pernah disimpan | tak bisa login |
| `isActive`, `sessionVersion` | `false`, `+1` | semua sesi mati seketika (SEC-18) |
| `Address` | `User.addressId` → `null`, baris `Address` dihapus | alamat rumah |
| `AuthToken` | semua milik `userId` + token pendaftaran ber-email lama dihapus | token/email |
| `NotificationLog` milik pengguna | `recipient` → `[dihapus]`, `messagePreview`/`error` → `null` | nomor/email/isi pesan; baris dipertahankan untuk audit pengiriman |
| `BookingPilgrim.fieldValues` (paspor, KTP, tgl lahir, kontak, dst.) pada booking pengguna | → `{}`; `userId` → `null` | PII inti, termasuk keluarga yang didaftarkan |
| `Document` + objek MinIO (scan paspor/KTP) | baris dihapus + objek dihapus | PII inti |
| `VisaApplication.notes`/`rejectionReason`, `Booking.notes`, `BookingTransport.pickupDetail`/`dropoffDetail`, `Payment.notes`, `Refund.notes` | → `null` | teks bebas bisa memuat nama/nomor/alamat (DEL-01). `Refund.reason` hanya string sistem → dibiarkan |
| `GroupMember` milik pengguna | `userId`/`inviteToken` → `null` | |
| `Booking`, `Payment` (+ bukti transfer), `Refund`, `ConsentLog`, `AccountDeletionRequest` | **dipertahankan** | kewajiban pembukuan/pajak, bukti persetujuan, akuntabilitas |

Sisa risiko yang diketahui dan diterima: bukti transfer (`Payment.buktiTransferPath`) bisa memuat nama/rekening pengirim — dipertahankan bersama catatan pembayaran (kewajiban retensi); `Booking`/invoice historis tidak lagi menampilkan nama jamaah (manifest dikosongkan).

## 4. API

| Method | Path | Akses | Perilaku |
|---|---|---|---|
| GET | `/api/v1/account/deletion-requests` | sesi | status terakhir (`select` eksplisit: tanpa catatan admin/ringkasan — DEL-05) |
| POST | `/api/v1/account/deletion-requests` | sesi, **hanya `pilgrim`**, rate limit `deletionRequestUser` | buat permintaan (kunci baris pengguna: tepat satu `pending`, 409 bila ada — DEL-06) + email ke pemilik |
| DELETE | `/api/v1/account/deletion-requests` | sesi | tarik permintaan `pending` → `withdrawn` (409 bila tak ada) |
| GET | `/api/v1/admin/deletion-requests/[id]/preview` | superadmin | `{ eligible, blockers[], willErase{…}, user }` — baca saja |
| PATCH | `/api/v1/admin/deletion-requests/[id]` | superadmin (401 tanpa sesi, 403 peran lain) | `{status:'rejected', note}` atau `{status:'completed', note, confirmEmail}`; hanya dari `pending` (409 selain itu); `completed` → 422 bila blocker, 409 bila email konfirmasi salah/state berubah |

Kode: `lib/account/deletion.ts` (`previewDeletion`, `executeDeletion`, `rejectDeletion`, `submitDeletionRequest`, `withdrawDeletionRequest`), skema `+AccountDeletionRequest.erasureSummary Json?` dan enum `withdrawn`.

## 5. Uji yang akan dibuktikan (`scripts/test-deletion.ts`, DB sekali pakai + penyimpanan palsu)

Anonimisasi lengkap (tiap kolom di §3), data yang harus bertahan, akun lain tak tersentuh, sesi lama mati, login mustahil, email & nomor bisa dipakai lagi, tiap blocker menolak (dengan kontrol positif), gagal hapus MinIO ⇒ DB tak berubah lalu coba ulang berhasil, dua eksekusi bersamaan ⇒ tepat satu menang, penolakan dipicu tepat di tengah eksekusi (deterministik), pengajuan paralel ⇒ satu pending, penarikan, masa tunggu, transisi status ilegal ditolak, pemindai skema (tiap kolom `userId` punya perlakuan eksplisit), penjaga sumber route. **Uji mutasi dijalankan manual saat verifikasi** (menonaktifkan tiap kontrol satu per satu lewat skrip sementara, tidak disimpan di repo); hasil di §9.

## 6. Risiko / batasan

- Booking dibuat tepat di celah antara pengecekan syarat dan commit: `POST /bookings` berjalan `Serializable` dan `UPDATE users` di awal transaksi membuat insert yang menunggu gagal serialisasi (penalaran, belum diuji). Refund `pending` buatan admin tepat di celah (INFO-2) diterima.
- **Terbuka (SEC-57, Low):** unggahan dokumen yang sedang berjalan atau `notify()` yang sedang terbang saat commit bisa meninggalkan berkas/log baru pada akun yang sudah dianonimkan; penyapuan berkas per awalan `pilgrims/<id>/` belum dibuat. Juga: bila bucket MinIO diberi versioning, `removeObject` hanya membuat delete marker; retensi cadangan DB/MinIO dan isi email di Resend di luar kendali kode.
- Penghapusan objek MinIO tak dapat dibatalkan — itu sebabnya ada pratinjau + `confirmEmail`.
- Cadangan (backup DB/MinIO) tetap memuat data lama sampai masa retensi cadangan habis — kebijakan retensi cadangan harus mengikuti (belum ada backup terjadwal; `docs/RETROFIT-GAPS.md`).

## 9. As-built dan bukti (2026-10-22)

**Pemeriksaan ulang (SOP langkah 1)** menemukan di luar SEC-44 asli: transisi status tak dijaga, akun staf bisa mengajukan, JSON rusak → 500, galat Prisma dicetak penuh. Semua ditutup.

**Verifikasi.** `scripts/test-deletion.ts` — **25 uji** terhadap DB sekali pakai + penyimpanan/email palsu (masuk `bun run test` dan CI). **Uji mutasi manual**: 17 mutan kontrol pertama (manifest, dokumen, alamat, tiap blocker, konfirmasi email, log notifikasi, nomor WA, objek MinIO, guard pending, token email, teks bebas, tautan manifest orang lain, group member, email asli, cakupan terlalu luas) + 9 mutan kontrol baru (masa tunggu, `pickupDetail`/`Payment.notes`/`Refund.notes`, kunci permintaan, kunci pengajuan, penarikan tanpa guard, akun sudah dianonimkan, email pengajuan) — semua terbunuh. Mutan kunci permintaan semula bertahan karena kunci pengguna + pengecekan akun-sudah-dianonimkan ikut mencegah; ditambah tes deterministik "penolakan di tengah eksekusi" yang kini membunuhnya. **E2E curl** terhadap aplikasi berjalan + MinIO lokal sungguhan: pengajuan 201/409/429, staf 403, tanpa sesi 401, jamaah memanggil admin 403, validasi (JSON rusak, field asing, id tak ada, email salah, blocker), berkas paspor jamaah yang diproses benar-benar hilang dari bucket dan berkas jamaah yang ditolak tetap ada, sesi & login lama 401, email lama bisa mendaftar ulang, masa tunggu menolak lalu lolos setelah 80 jam, penarikan, GET jamaah tanpa catatan admin. **UI admin** di browser: pratinjau, tombol terkunci sampai email benar, daftar menyegarkan diri.

**Review independen (`security-auditor`):** 0 Critical, 0 High, 2 Medium (DEL-01 PII teks bebas tertinggal — ditutup; DEL-02 sesi curian bisa mengajukan tanpa sepengetahuan pemilik — ditutup: email pengajuan + penarikan + masa tunggu), 6 Low (DEL-03 urutan berkas-lalu-keputusan, DEL-05 GET membocorkan catatan admin, DEL-06 pending ganda, DEL-08 401≠403 — ditutup; DEL-04 tulis terlambat — terbuka, SEC-57; DEL-07 tes — diperkuat: perilaku nyata untuk pengajuan/penarikan/balapan, pemindai skema per kolom `userId`, klaim mutasi dikoreksi jujur di §5), 7 Info (dicatat). Register: SEC-44, SEC-54..57.
