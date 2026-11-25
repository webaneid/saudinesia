# Rencana — Profil jamaah mengikuti Data Jamaah + verifikasi WhatsApp yang jelas

> Permintaan pemilik 2026-11-25. Cabang `feat/profil-jamaah`, satu PR, tiga fase (P1 → P2 → P3). Terkait: `docs/arsitektur-data-jamaah.md`,
> `docs/arsitektur-jamaah.md`, `docs/arsitektur-whatsapp-verifikasi.md`, ADR-0002, ADR-0005, ADR-0006.

## 1. Permintaan dan keputusan pemilik

1. Data di Profil = data yang diatur di Produk → Data Jamaah. Berlaku juga untuk **semua kartu jamaah** (Jamaah Saya, popup pesanan, admin).
2. Tampilan Profil lebih menarik dan sederhana.
3. Verifikasi WhatsApp: tombol **"Verifikasi Sekarang"**, nomor WhatsApp Saudinesia **sesuai hasil scan** ditampilkan, tombol **salin** untuk kirim manual.
4. "Untuk profil tidak harus diwajibkan semua, kecuali saat dia ingin mendaftar sebagai jamaah, maka muncul popup jika data belum dilengkapi …
   alamat dan nama lengkap saja yang wajib, nomor WhatsApp yang wajib verified, simple itu saja dulu."
5. Penyimpanan: satu formulir → **akun + kartu "Saya sendiri"**.

## 2. Recheck kode (2026-11-25, `main` 8641ca5)

- Profil hanya menyimpan nama, kontak, alamat akun; tak tersambung katalog `pilgrim_fields` maupun kartu "Saya sendiri".
- `SavedPilgrimFields` menampilkan SEMUA kolom bawaan (termasuk NIK, tempat lahir, tanggal terbit paspor, alamat yang **nonaktif** di katalog);
  hanya kolom buatan admin yang mengikuti katalog.
- `lib/pilgrims/service.ts` mewajibkan NIK untuk setiap WNI ≥ 2 tahun (ADR-0005/K2) walau kolom NIK nonaktif → menyembunyikan kolom saja akan
  membuat kartu WNI tak bisa disimpan sama sekali. Perlu ADR baru (ADR-0006).
- SEC-312: ubah kartu tanpa `gender`/`birthPlace` mengosongkannya (kolom lain: tak dikirim = tetap).
- Kode verifikasi memakai nomor env `NEXT_PUBLIC_BUSINESS_WA`, bukan nomor yang benar-benar tertaut lewat scan: bila berbeda, pesan pengguna
  masuk ke nomor yang tidak mengirim webhook dan verifikasi tak pernah berhasil.
- Kartu "Saya sendiri" yang sudah ada langsung dipakai "Jadikan saya jamaah" walau isinya belum lengkap.

## 3. Rancangan

### P1 — Verifikasi WhatsApp
- Nomor tujuan HANYA dari `linkedWhatsappNumber()` (`lib/whatsapp/number.ts`): `whatsapp.status()` terhubung + nomor JID (cache 15 detik). Tak
  terhubung → **tidak tersedia** (503 `whatsappUnavailable`), tanpa jatuh ke env: kode yang dikirim ke nomor tanpa webhook tak pernah terverifikasi.
- `GET /api/v1/auth/whatsapp/verification` → `{ businessNumber | null }` (tampil sebelum tombol ditekan); `POST` tetap menerbitkan kode.
- UI: nomor yang diverifikasi terlihat; tombol utama "Verifikasi Sekarang" (membuka WhatsApp dengan pesan siap kirim); bagian "Kirim manual" berisi
  nomor Saudinesia + pesan, masing-masing bertombol salin; status "menunggu pesan Anda". ADR-0002 tidak berubah (pesan masuk, tak memblokir apa pun).

### P2 — Kartu jamaah mengikuti katalog
- `GET /api/v1/pilgrim-fields` mengembalikan semua kolom AKTIF; `SavedPilgrimFields` menampilkan kolom bawaan yang aktif saja (label, urutan dalam
  bagiannya, tanda wajib dari katalog) + kolom buatan admin. Nama dan tanggal lahir selalu tampil (sistem membutuhkannya). Katalog gagal dimuat →
  semua kolom (perilaku lama).
- Kolom tersembunyi tak pernah dikosongkan: formulir mengirim balik nilai kartu, dan server (SEC-312) menganggap tak dikirim = tetap.
- NIK wajib (WNI) dan paspor wajib (WNA) hanya bila kolomnya aktif dan bertanda Wajib, dan tidak untuk kartu "Saya sendiri" (ADR-0006); tanpa NIK kartu tak punya
  identitas gudang (`unmatched`, sama dengan bayi).

### P3 — Profil
- Wajib simpan: Nama Lengkap + Alamat (server & klien). Kolom katalog aktif lain opsional; tanggal lahir wajib begitu data jamaah lain diisi.
- Simpan: kartu "Saya sendiri" (bila ada data jamaah atau kartunya sudah ada) → akun (nama, alamat) → kontak (hanya bila nomor berubah).
- WhatsApp: status tampil menonjol sampai terverifikasi. **Tidak memblokir pemesanan** (ADR-0002).
- Popup: "Jadikan saya jamaah" membuka formulir kelengkapan bila kartu belum ada ATAU kolom wajib masih kosong; popup mewajibkan kolom wajib katalog.

## 4. Uji
Skrip: `test-pilgrims`, `test-pilgrim-data`, `test-pilgrim-form`, `test-whatsapp*`, `test-i18n-coverage`, `test-api-errors`; browser di basis data
sekali pakai (dev:eval + simulator GOWA): verifikasi, simpan profil, kartu, popup pesanan; HP dan desktop.
