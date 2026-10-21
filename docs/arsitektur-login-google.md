# Arsitektur — Login & Daftar dengan Google

> Status: **RENCANA 2026-10-21 — MENUNGGU KONFIRMASI keputusan §4 sebelum dieksekusi.** Pola acuan: smart-ai (ADR-0022) dan facport
> (panduan setup Google OAuth), keduanya memakai Better Auth. Saudinesia memakai **sesi JWT buatan sendiri**, jadi yang dipindahkan
> adalah **aturan keamanannya**, bukan kodenya. Tujuan operasional: saat produksi cukup mengisi `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

## 1. Keadaan aktual (recheck 2026-10-21)

- Auth: email + password (`bcryptjs`), sesi JWT `httpOnly` (`lib/auth/session.ts`). Daftar mandiri lewat `auth/register`:
  wajib **nomor WhatsApp + OTP**, akun `isActive=false` sampai OTP benar, dan **persetujuan kebijakan privasi** dicatat di `ConsentLog` (UU PDP).
- Email **tidak diverifikasi** pada akun password (tidak ada kolom `emailVerifiedAt`). Reset password hanya lewat OTP WA.
- Admin/manager/superadmin dibuat oleh superadmin dan login di `/admin/login` dengan password.
- Google: **tidak ada** apa pun.

## 2. Yang diambil dari smart-ai/facport

1. Aktif **hanya bila kredensial diisi**; tanpa itu tombol tidak tampil dan rute menolak (`GET /api/v1/auth/methods` → `{google:boolean}`).
2. **Tidak pernah menautkan otomatis** ke akun yang emailnya belum terverifikasi (mencegah *pre-hijacking*: penyerang mendaftar dengan email korban
   lebih dulu, lalu korban masuk lewat Google dan "mewarisi" akun yang sandinya dipegang penyerang).
3. Akun yang lahir dari callback OAuth hanya mendapat **peran terendah** (`pilgrim`); peran lain tidak bisa diperoleh lewat Google.
4. Pembuatan akun lewat Google dibatasi laju per IP.
5. Redirect URI persis `{APP_URL}/api/v1/auth/google/callback`, didaftarkan sekali di Google Cloud Console.

## 3. Alur (Authorization Code + PKCE, implementasi sendiri)

```
[Tombol Google] → GET /api/v1/auth/google/start
     buat state + nonce + code_verifier; simpan di cookie httpOnly bertanda tangan (jose, 10 menit, SameSite=Lax)
     302 → accounts.google.com (scope: openid email profile, code_challenge S256, prompt=select_account)
Google → GET /api/v1/auth/google/callback?code&state
     cek state == cookie; tukar code (+ code_verifier) di endpoint token Google;
     verifikasi ID token: tanda tangan via JWKS Google, iss, aud == client id, exp, nonce, email_verified == true
     ├─ googleSub sudah terdaftar        → buat sesi → redirect
     ├─ email cocok akun lama            → lihat keputusan §4-B
     └─ pengguna baru                    → simpan identitas terverifikasi di cookie bertanda tangan (15 menit)
                                           → redirect /{locale}/register/google  (form lengkapi: nama, nomor WA opsional, CENTANG PRIVASI)
POST /api/v1/auth/google/complete  (cookie identitas + consent=true) → buat User + ConsentLog → sesi → email "welcome"
```

Persetujuan privasi **sebelum** akun dibuat (UU PDP) adalah alasan ada langkah "lengkapi" — callback tidak langsung membuat akun.

## 4. Keputusan yang perlu dikonfirmasi

| # | Keputusan | Usulan | Alasan / trade-off |
|---|---|---|---|
| A | Siapa boleh masuk via Google | **Hanya `pilgrim`.** Admin/manager/superadmin tetap password di `/admin/login`; email mereka tak pernah ditautkan ke Google | Memperkecil dampak: salah ketik email admin tak berubah menjadi akses admin lewat akun Google orang lain |
| B | Google ↔ akun password yang emailnya sama | **Tidak ditautkan otomatis.** Tampilkan: "Email ini sudah terdaftar dengan password — masuk dengan password." Tautan manual dari Profil = fase lanjutan | Satu-satunya cara aman karena email akun password tak terverifikasi. Alternatif: tautkan lalu **membatalkan password lama** (mitigasi pre-hijack) — lebih mulus tapi mengejutkan pengguna sah |
| C | Nomor WA untuk pendaftar Google | **Opsional, tanpa OTP** di form lengkapi (pengingat WA hanya bila ada nomor; email tetap jalan) | Memaksa OTP membuat Google tak lebih mudah dari form biasa; nomor tak terverifikasi tidak boleh dipakai untuk reset password |
| D | Reset password untuk akun Google-only | Akun tanpa password yang diketahui (hash acak) → "Lupa password" tidak berlaku; masuk lewat Google | Tidak ada kredensial lemah yang bisa ditebak |
| E | Akun Google & `emailVerifiedAt` | Diisi saat daftar/masuk Google (email terverifikasi oleh Google) | Dasar untuk tautan aman di masa depan |

## 5. Skema (migrasi)

`User.googleSub String? @unique`, `User.emailVerifiedAt DateTime?`. `passwordHash` tetap wajib → akun Google diberi hash dari 32 byte acak
(tidak ada password yang cocok).

## 6. Keamanan

- **State** (CSRF) + **nonce** (replay ID token) + **PKCE S256**; cookie `httpOnly`, `SameSite=Lax` (harus Lax: callback adalah navigasi lintas-situs), `Secure` di produksi, bertanda tangan `jose`, kedaluwarsa singkat, dihapus setelah dipakai.
- ID token **selalu diverifikasi** (JWKS, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud`, `exp`, `nonce`, `email_verified`); tidak percaya klaim dari klien.
- Parameter `next` hanya path internal (anti open-redirect).
- Rate limit per IP di `start`/`callback`/`complete` (`lib/auth/rateLimit.ts`).
- Endpoint Google (`auth`, `token`, `jwks`) dapat di-override **hanya** saat `NODE_ENV` development/test (untuk uji dengan server palsu) — fail-closed.
- Tidak mencatat token/kode/secret; hanya hasil keputusan.
- Akun nonaktif / dalam proses hapus akun tetap mengikuti aturan sesi yang ada.

## 7. Konfigurasi & daftar periksa produksi

| Env | Keterangan |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | dari Google Cloud Console (kosong = fitur mati, tombol tak tampil) |
| `APP_URL` | origin publik; redirect URI = `{APP_URL}/api/v1/auth/google/callback` |

Google Cloud Console (sekali): buat project → **OAuth consent screen** (External; scope `openid`, `email`, `profile` — tidak butuh verifikasi manual) →
**Credentials → OAuth client ID → Web application** → *Authorized redirect URIs*: persis redirect URI di atas (+ versi `http://localhost:6260/...` untuk dev) →
salin Client ID/Secret ke `.env.production` → `docker compose up -d web`. Panel **Integrasi** di admin menampilkan redirect URI yang harus didaftarkan dan apakah Google sudah terkonfigurasi.

## 8. Fase eksekusi (setelah §4 dikonfirmasi)

1. Migrasi + `lib/auth/google.ts` (PKCE/state/verifikasi ID token) + uji dengan **server Google palsu** (token & JWKS) mencakup semua kasus tolak.
2. Rute `start`/`callback`/`complete`/`methods` + rate limit.
3. UI: tombol Google di login & daftar (hanya bila aktif), halaman lengkapi, pesan galat.
4. Dokumen setup produksi + security review (SOP langkah 5) + PR.
