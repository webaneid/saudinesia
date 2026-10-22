# Evaluasi lokal (tanpa VPS, tanpa kredensial asli)

Semua fitur yang butuh layanan luar — **email (Resend), login Google, WhatsApp (GOWA)** — bisa dievaluasi penuh di komputer ini lewat simulasi lokal.
Tidak ada yang dikirim keluar mesin Anda.

## Menjalankan

```bash
bun install
bun run db:deploy      # terapkan migrasi ke database dev (.env.local → DATABASE_URL); aman diulang
bun run dev:eval       # simulasi Resend/Google/GOWA + aplikasi di http://localhost:6260
```

`bun run dev:eval` menyalakan empat hal sekaligus (Ctrl+C menghentikan semuanya). Env simulasi hanya berlaku untuk proses ini — `.env.local` tidak diubah:

| Alamat | Apa | Dipakai untuk |
|---|---|---|
| http://localhost:6260 | Aplikasi | semuanya |
| http://localhost:6299 | **Kotak masuk email** (simulasi Resend) | tautan daftar, reset password, email notifikasi — klik "Buka tautan di email" |
| http://localhost:6297 | **WhatsApp** (simulasi GOWA) | pesan keluar dari aplikasi + **simulator pesan masuk** untuk verifikasi nomor |
| (muncul saat menekan tombol Google) | **Pemilih akun Google palsu** | login/daftar Google (alur OAuth + PKCE + token RSA sungguhan) |

Mode ini mematikan rate limit (supaya bisa mengulang daftar/lupa password dengan email yang sama). Untuk menguji rate limit pakai `bun run dev` biasa.
Port aplikasi bisa diganti: `EVAL_APP_PORT=6270 bun run dev:eval`. Data yang dibuat tersimpan di database dev Anda.

## Akun staf (dari seed, hanya dev)

| Email | Peran | Password |
|---|---|---|
| `admin@saudinesia.local` | superadmin | `Admin@1234` |
| `manager@saudinesia.local` | manager | `Admin@1234` |
| `ops@saudinesia.local` | admin | `Admin@1234` |

Masuk di http://localhost:6260/id/admin/login. Staf **hanya** password (Google ditolak untuk staf). Superadmin baru: `bun scripts/create-superadmin.ts --email … --name "…" --password-stdin`.
Jangan menjalankan `bun run db:seed` hanya untuk evaluasi — ia menghapus data katalog/harga.

## Daftar periksa evaluasi

**1. Daftar manual** — `/id/register`: isi nama, email, telepon, WhatsApp → "Cek Email Anda" → buka kotak masuk (6299) → "Buka tautan di email" → halaman menampilkan isian Anda → centang dua persetujuan, pilih password → akun aktif, masuk ke dashboard. *Akun baru dibuat hanya setelah tautan diklik* (sebelumnya tidak ada akun).
**2. Daftar ulang email yang sama** — respons sama persis ("Cek Email Anda"); di kotak masuk muncul email "Anda sudah punya akun" tanpa tautan sakti.
**3. Lupa password** — `/id/forgot-password` → email di kotak masuk → tautan → password baru → otomatis masuk. Tautan hanya sekali pakai; coba buka lagi → ditolak.
**4. Login Google** — `/id/login` → "Masuk dengan Google" → pemilih akun palsu:
  - email baru → halaman "Lengkapi Pendaftaran" (setujui privasi) → akun dibuat → **dialihkan ke "Lengkapi Data"** (telepon + WhatsApp wajib);
  - email **sama dengan akun manual** (mis. daftar manual `a@x.test` lalu Google dengan `a@x.test`) → langsung masuk, tersambung otomatis;
  - email staf (`admin@saudinesia.local`) → ditolak dengan pesan "Akun staf masuk dengan email dan password";
  - hilangkan centang "terverifikasi" → ditolak; klik "Batal" → pesan dibatalkan.
**5. Lengkapi Data** — jamaah tanpa telepon/WhatsApp dialihkan dari semua halaman jamaah; dua kolom + centang "Sama dengan nomor HP"; coba buka `/id/dashboard` langsung. Server juga menolak pemesanan tanpa nomor (422).
**6. Verifikasi WhatsApp** — Profil (atau banner di dashboard) → "Verifikasi WhatsApp" → muncul kode `VERIF XXXXXXXX` → buka simulator (6297): isi **nomor yang sama dengan nomor WhatsApp akun** dan pesan `VERIF XXXXXXXX` → kirim → halaman Profil otomatis berubah **Terverifikasi** dan balasan otomatis muncul di daftar pesan keluar.
  - Kirim dari nomor lain → tidak terverifikasi. Dua akun dengan nomor yang sama: hanya yang pertama membuktikan yang menang, yang kedua dapat balasan "sudah dipakai akun lain".
  - Ganti nomor WhatsApp di Profil → verifikasi dicabut.
**7. Notifikasi** — lakukan pemesanan (Visa/Transport lewat katalog) lalu konfirmasi pembayaran dari admin: email selalu muncul di kotak masuk; WhatsApp **hanya** muncul di 6297 untuk akun yang nomornya terverifikasi.
**8. Panel admin → Pengaturan → Integrasi & Notifikasi** — status Resend, GOWA (aktif/terputus), Google, dan URL webhook; tombol "Kirim uji" email; saklar email.
**9. Jaring pengaman email** — matikan simulasi GOWA (hentikan dan nyalakan lagi tanpa verifikasi): email tetap sampai untuk semua kejadian.

## Yang disimulasikan vs yang nyata

Disimulasikan: pengiriman email, layar Google, gateway WhatsApp. **Nyata**: seluruh logika aplikasi — token, sesi, verifikasi ID token (RSA/JWKS/nonce/PKCE), tanda tangan HMAC webhook, database, aturan akun.
**Belum teruji sampai ada layanan asli** (tidak bisa dibuktikan secara lokal): kiriman email ke inbox sungguhan (domain SPF/DKIM/DMARC), tampilan di klien email, layar persetujuan Google, perilaku GOWA asli (apakah pengirim selalu berbentuk nomor, bentuk `/app/status`). Langkahnya ada di `docs/deployment.md` §6 dan `docs/arsitektur-whatsapp-verifikasi.md` §6.

## Masalah umum

- *"Port … sudah dipakai"* — hentikan proses lain di port 6297/6298/6299 atau sesi `dev:eval` sebelumnya.
- *Tombol Google tidak tampil* — hanya muncul lewat `dev:eval` (atau bila `GOOGLE_CLIENT_ID/SECRET` + `APP_URL` terisi).
- *`bun run dev` biasa dan email* — `.env.local` memakai kunci Resend placeholder: email gagal terkirim, tetapi **tautan daftar/reset dicetak ke terminal server** (khusus development) supaya alur tak buntu.
- Sebelum 3 migrasi terakhir diterapkan ke database dev, dibuat cadangan `pg_dump` di `~/saudinesia-dev-backup-20261022.dump` (di luar repo). Pulihkan bila perlu: `pg_restore --clean --if-exists -d saudinesia ~/saudinesia-dev-backup-20261022.dump`.
