# Arsitektur — Auth berbasis Email (daftar manual + Google), tanpa OTP WhatsApp

> Status: **SEMUA FASE (1–4) SELESAI & TERVERIFIKASI SECARA LOKAL (2026-10-21/22)** — auth email manual + hapus OTP (§7), login Google (§8), Lengkapi data + lingkup WhatsApp (§9),
> verifikasi nomor WhatsApp (ADR-0002, `docs/arsitektur-whatsapp-verifikasi.md`), penutupan + review lintas fase (§10). **Belum diuji dengan layanan asli** (Resend, Google, GOWA).
> Keputusan produk dikonfirmasi pemilik (§2). Menggantikan
> `docs/arsitektur-login-google.md` (dihapus) dan bagian "Verifikasi akun / Reset password" di `docs/auth-flow.md`.
> Alasan perubahan: gateway WhatsApp pihak ketiga makin sering memblokir, jadi **WhatsApp tidak boleh lagi jadi dependensi auth**.
> Email (Resend, `docs/arsitektur-notifikasi.md`) menjadi identitas, verifikasi, dan jalur pemulihan akun. Aplikasi belum produksi
> dan tidak punya jamaah nyata — migrasi boleh destruktif pada data dev.

## 1. Keadaan AWAL sebelum Fase 1 (RIWAYAT — recheck 2026-10-21; seluruhnya sudah digantikan, lihat §3 dan §10)

| Fakta | Bukti |
|---|---|
| Daftar manual: email+password+**nomor WA**, akun `isActive=false` sampai OTP WA benar | `app/api/v1/auth/register/route.ts`, `verify-phone/route.ts` |
| Reset password: email → **OTP WA** → `resetToken` (UUID, **plaintext** di `users.resetToken`) → password baru | `forgot-password`, `verify-reset-otp`, `reset-password` |
| OTP disimpan **plaintext** di Redis dan tabel `otp_requests` | `lib/auth/otp.ts`, model `OtpRequest` |
| Verifikasi hanya untuk nomor; **email tidak pernah diverifikasi** (tidak ada `emailVerifiedAt`) | `schema.prisma` `User` |
| `isActive` dipakai ganda: "belum verifikasi" **dan** "dinonaktifkan admin" | `login/route.ts`, `admin/system/users/[id]` |
| `User.phone` **unik** (identitas OTP) dan format normalisasi hanya Indonesia (`normalizePhone` memaksa awalan 62) | `schema.prisma`, `lib/utils/phone.ts` |
| Login membedakan "akun belum aktif" (403) dari "salah password" → enumerasi email | `login/route.ts` (`!user.isActive`) |
| Register membalas 409 "Email sudah terdaftar" / "Nomor WhatsApp sudah terdaftar" → enumerasi | `register/route.ts` |
| **`PUT /auth/profile` boleh mengubah `email` tanpa verifikasi** (skema menerimanya; UI tidak mengirimnya) | `lib/validators/auth.ts` `profileSchema`, `profile/route.ts` |
| `POST /admin/system/users` membuat akun staf dengan `data` dari `b.*` tanpa Zod (SEC-08) | `admin/system/users/route.ts:34` |
| Admin/manager/superadmin login di `/admin/login` dengan password; tautan "Lupa password?" memakai alur OTP WA yang sama | `AdminLoginForm.tsx` |
| Google: tidak ada | — |
| Pengaman gerbang halaman jamaah hanya JWT (`middleware.ts` + `(pilgrim)/layout.tsx`); tidak ada cek kelengkapan data | `middleware.ts`, `(pilgrim)/layout.tsx` |

**Temuan baru dari recheck:** `PUT /auth/profile` yang menerima `email` bebas adalah celah **pengambilalihan akun** begitu login Google
menyambung akun otomatis berdasarkan email (penyerang mengganti emailnya ke email korban, korban masuk lewat Google lalu "mendarat" di akun
penyerang yang password-nya dipegang penyerang). Wajib ditutup di Fase 1 sebelum Google dibangun → dicatat **SEC-17**.

## 2. Keputusan produk (dikonfirmasi pemilik 2026-10-21)

1. **Email adalah identitas.** Dua jalur: (a) daftar manual **dengan verifikasi email** (password dipilih SETELAH tautan diklik — lihat §3.2), (b) Google. OTP WhatsApp **dihapus total** dari auth.
2. **Reset password lewat email (Resend)**, bukan WhatsApp.
3. **Staf (admin/manager/superadmin) hanya password**, tidak boleh tersambung ke Google.
4. **Daftar manual tetap meminta Telepon dan WhatsApp** (dua kolom + centang "WhatsApp sama dengan telepon"). **Daftar Google**: setelah login langsung dialihkan
   ke halaman "Lengkapi data" untuk mengisi keduanya.
5. **Gerbang keras (opsi A):** jamaah yang telepon/WhatsApp-nya belum lengkap dialihkan ke "Lengkapi data" di semua halaman jamaah sampai selesai.
6. **Nomor tidak diverifikasi.** Saat mengisi WhatsApp ditampilkan pemberitahuan bahwa notifikasi pembayaran/pembaruan dikirim via WhatsApp selain email; persetujuan itu dicatat (`ConsentLog`).
   **→ Diubah sebagian oleh ADR-0002 (2026-10-22):** nomor WhatsApp kini diverifikasi lewat pesan masuk (opsional, tidak menghalangi pemesanan; WhatsApp hanya ke nomor terverifikasi). Telepon tetap tak diverifikasi.
7. **Hapus keunikan `phone`** (nomor tak lagi identitas; keunikan pada nomor tak terverifikasi membuka "perebutan nomor").
   **→ ADR-0002:** `phone` tetap tak unik; `whatsapp` tak unik, tetapi **satu nomor hanya untuk satu akun TERVERIFIKASI** (`User.verifiedWhatsapp @unique`).
8. **Lingkup WhatsApp diperkecil:** hanya `booking_submitted`, `payment_reminder_12h/22h`, `payment_confirmed`, `payment_rejected`. `visa_status_change` dan `auto_cancelled` **hanya email**.
   Dikunci di kode (`waMessage`), tanpa saklar admin — sengaja sederhana; WhatsApp ditinjau lagi nanti.
9. **Google ↔ akun manual dengan email sama: langsung tersambung** (Google sudah memverifikasi email). Aman karena akun manual hanya bisa aktif setelah email terverifikasi (§3.3).
10. UI tombol Google mengikuti standar tampilan "Masuk dengan Google" (logo G resmi, tanpa mengubah warna logonya), diselaraskan dengan desain kita.

## 3. Arsitektur

### 3.1 Skema (migrasi destruktif-aman untuk data dev)

`User`:
- `+ emailVerifiedAt DateTime?` — satu-satunya penanda "email terbukti milik pemilik akun". Backfill: `now()` untuk baris `isActive=true` (aman: belum ada pengguna nyata; staf dibuat superadmin).
- `+ whatsapp String?` — digit E.164 tanpa `+` (mis. `628123456789`). `phone` ikut disimpan sebagai **digit E.164** (bukan lagi dinormalisasi paksa ke 62).
- `− @unique` pada `phone`; `− phoneVerifiedAt`; `− resetToken`, `− resetTokenExp`.
- `+ googleSub String? @unique` (Fase 2).
- `+ whatsappVerifiedAt DateTime?`, `+ verifiedWhatsapp String? @unique` (ADR-0002) — nomor yang terbukti; mengubah `whatsapp` mengosongkan keduanya.
- `isActive` kembali berarti **hanya** "boleh login (tidak dinonaktifkan admin)". Akun baru `isActive=true, emailVerifiedAt=null`. **Login mensyaratkan keduanya.**
- Email dinormalisasi **huruf kecil** di semua jalur (daftar, login, lupa password, Google). Migrasi menurunkan huruf email yang ada.

Model baru `AuthToken`: `id`, `type` (`registration | password_reset | whatsapp_verification`), `tokenHash String @unique` (SHA-256), `userId?` (reset), `email?` + `payload Json?` (pendaftaran: isian menunggu di token, **belum ada akun**), `expiresAt`, `usedAt?`, `createdAt`; indeks `(userId,type)`, `(email,type)`.
Token = 32 byte acak (`base64url`, 43 karakter), **hanya hash yang disimpan**. Pendaftaran berlaku 24 jam, reset 30 menit. Token baru jenis & pemilik yang sama menghanguskan yang belum terpakai.
Konsumsi atomik: `updateMany where { tokenHash, usedAt: null, expiresAt > now } set usedAt` — jika `count=0` → ditolak (tak bisa dipakai dua kali, aman balapan).

`ConsentType` += `whatsapp_notifications`. **Dihapus:** model `OtpRequest`, `lib/auth/otp.ts`, `lib/auth/otpVerify.ts`, `verify-phone`, `verify-reset-otp`, `app/api/v1/dev/otp`, `components/shared/OtpInput.tsx`, `waTemplates.otp`, skema Zod OTP.

### 3.2 Alur manual

```
Daftar (nama, email, telepon, WhatsApp) — TANPA password dan TANPA persetujuan (pengirim form belum tentu pemilik email)
  POST /auth/register → TIDAK membuat akun; isian disimpan di AuthToken(registration). Respons SERAGAM {sent:true}
    email baru       → email "Selesaikan pendaftaran" (tautan berlaku 24 jam)
    email sudah ada  → email "Anda sudah punya akun — masuk / lupa password" (tanpa tautan sakti)
Tautan → /{locale}/register/complete?token=…  Halaman memanggil POST /auth/registration/preview (hanya baca, menampilkan nama/
        email/telepon/WA agar pemilik email mengenali pendaftarannya) lalu meminta PASSWORD. Membuka halaman/GET tidak mengonsumsi token —
        pemindai tautan Gmail/antivirus meng-GET semua tautan.
  POST /auth/registration/complete {token, password, privacyConsent, whatsappConsent} → transaksi: klaim token + buat User(emailVerifiedAt=now,
        ConsentLog ×2 dicatat SAAT INI oleh pemilik email) + payload token dikosongkan → sesi → /dashboard
Login: email+password; password SALAH dan akun tak ada → sama-sama 401; status akun ("dinonaktifkan" 403 / "belum terverifikasi" 403,
        hanya akun lama) baru diungkap SETELAH password benar — tidak membocorkan keberadaan akun
Lupa password: POST /auth/forgot-password {email} → respons SERAGAM; bila akun ada → email tautan reset (30 menit)
  /{locale}/reset-password?token=…  → POST /auth/reset-password {token, newPassword} → set password,
        set emailVerifiedAt bila kosong (token terkirim ke kotak masuk = bukti kepemilikan), sesi baru
```

Pengiriman email auth: langsung `sendEmail()` (bukan `notify()`) karena hasilnya perlu diketahui dan tautan berisi token tidak boleh masuk log. Kegagalan kirim
**tidak** mengubah respons (anti-enumerasi) tetapi dicatat (tanpa token/alamat), dan UI menyediakan "Kirim ulang" dengan jeda 60 detik.
Mode `development` persis (bukan `!== 'production'`, SEC-02): bila email **tidak terkirim** (Resend belum dikonfigurasi, atau kunci placeholder/ditolak), tautan dicetak ke **log server** — tidak pernah di respons HTTP (dulu hanya untuk 'belum dikonfigurasi': kunci dev placeholder membuat daftar/reset buntu).

### 3.3 Mengapa sambung otomatis Google aman (keputusan 9)

Pre-hijacking: penyerang mendaftar dengan email korban. Karena pendaftaran manual **tidak membuat akun dan tidak menerima password** sampai pemilik email mengklik tautan,
tidak ada akun yang password-nya bisa dipasang penyerang (perbaikan dari rancangan awal yang membuat akun `isActive` dengan password dari form — celah itu ditemukan saat
merancang Fase 1: penyerang bisa menimpa password akun yang belum terverifikasi lalu korban mengklik tautan verifikasi). Saat korban masuk lewat Google (Fase 2):
- akun ada & `emailVerifiedAt` terisi → sambung (`googleSub`) dan masuk;
- akun ada & **belum** terverifikasi (hanya akun lama pra-Fase 1 — **praktis tak terjangkau**: `isActive` dicek lebih dulu dan migrasi menandai semua `isActive=true` terverifikasi; hanya keadaan sintetik, §8) → tandai terverifikasi, **ganti `passwordHash` dengan hash acak**, sambung, masuk;
- akun ada tapi **role staf** → ditolak ("Akun staf masuk dengan email & password");
- akun ada & `isActive=false` (dinonaktifkan admin) → ditolak. (Proses hapus akun belum mengubah `isActive` — SEC-44.)
Syarat tetap: `PUT /auth/profile` tidak boleh lagi mengubah email (SEC-17, ditutup Fase 1). Ganti email = fitur terpisah di masa depan (verifikasi email BARU sebelum berlaku).
Akun Google-only dapat menyetel password lewat "Lupa password" (kepemilikan email terbukti).

### 3.4 Alur Google (Authorization Code + PKCE, implementasi sendiri — tanpa Better Auth)

Dipertahankan dari rencana lama: `GET /auth/google/start` (state + nonce + code_verifier di cookie `jose` bertanda tangan 10 menit, `SameSite=Lax`, `httpOnly`) →
Google → `GET /auth/google/callback` (cek state, tukar code, **verifikasi ID token**: JWKS, `iss`, `aud`, `exp`, `nonce`, `email_verified=true`) →
`googleSub` dikenal → sesi; email cocok → aturan §3.3; pengguna baru → cookie identitas terverifikasi 15 menit → `/{locale}/register/google` (nama + **persetujuan privasi**, sebelum akun dibuat — UU PDP) →
`POST /auth/google/complete` membuat `User(googleSub, emailVerifiedAt=now, passwordHash acak)` + `ConsentLog` + email `welcome` → sesi → gerbang §3.5.
Hanya aktif bila `GOOGLE_CLIENT_ID/SECRET` **dan** `APP_URL` terisi (halaman membaca `googleConfigured()` di server; tidak ada endpoint `methods`); tidak ada parameter `next` (tujuan akhir selalu `/dashboard`, `locale` allow-list `id|en`); endpoint Google bisa di-override **hanya** saat `NODE_ENV` development/test (uji server palsu); rate limit per IP.
Redirect URI persis `{APP_URL}/api/v1/auth/google/callback`.

### 3.5 Gerbang "Lengkapi data" (keputusan 4–6)

- Halaman `/{locale}/lengkapi-data` (di luar grup `(pilgrim)` agar tidak berputar), butuh sesi. Komponen kontak bersama dengan form daftar: kode negara + Telepon + WhatsApp + centang
  "WhatsApp sama dengan telepon" (dengan *override* lokal — pelajaran derived-state `ContactPicker`; email tidak ditampilkan) + teks pemberitahuan notifikasi WhatsApp + centang persetujuan.
- `(pilgrim)/layout.tsx` (Server Component): untuk `role = pilgrim`, bila `phone` atau `whatsapp` kosong → `redirect('/{locale}/lengkapi-data')`. Staf tidak terkena.
  (`middleware.ts` berjalan di Edge tanpa Prisma, jadi cek data di layout, bukan di middleware.)
- **Penegakan di server:** `POST /bookings` menolak (422) bila telepon/WhatsApp kosong — gerbang UI saja tidak cukup (notifikasi bergantung pada nomor ini).
- `PUT /auth/contact {phone, whatsapp, whatsappConsent?}` (persetujuan hanya wajib bila akun belum punya catatannya) memperbarui nomor + `ConsentLog(whatsapp_notifications)`. Profil memakai komponen & endpoint yang sama.
- `lib/whatsapp/client.ts` kini menerima **E.164 apa adanya** (hanya membuang `+`/spasi); form menyusun E.164 lewat `e164FromCountry` (kode negara + nomor lokal). (`normalizePhone` lama dihapus — tak punya pemanggil.)
  `notify()` memakai `User.whatsapp` (bukan `phone`).

### 3.6 Rate limit (pelajaran SEC-04: setiap perlindungan harus punya pemanggil yang bisa di-`grep`)

`LIMITS` diganti: `otpSend*`/`otpVerify*` dihapus → `authEmailSendEmail` (3 per 10 menit per alamat), `authEmailSendIp` (10 per jam per IP), `authTokenIp` (30 per 10 menit per IP; token 256-bit tak bisa ditebak, ini pembatas kasar),
`resetIp` tetap. Login tetap (`loginIp`, `loginAcctIp`, `loginAcct`). Google: `googleIp` (30/10 mnt per IP). Ditambah sesudahnya: `contactUpdateUser` 5/hari dan `bookingCreateUser` 20/jam (per akun), `whatsappVerifyUser` 5/jam (per akun), `webhookIp` 3000/10 mnt, `webhookBadSigIp` 30/10 mnt (per IP) dan `webhookSender` 10/jam (per nomor pengirim), `emailTestUser` 5/jam (per admin). Sumber kebenaran: `LIMITS` di `lib/auth/rateLimit.ts`. Uji `scripts/test-rate-limit.ts` disesuaikan (uji spesifikasi "OTP 3/10 menit" diganti kebijakan baru).

## 4. Dampak ke kode (daftar kerja)

| Area | Perubahan |
|---|---|
| `schema.prisma` + migrasi | §3.1 |
| `lib/auth/` | hapus `otp.ts`, `otpVerify.ts`; tambah `tokens.ts`, `accounts.ts`, `authEmail.ts`, `google.ts`+`googleAccounts.ts`+`googleCookies.ts`, `contact.ts`, `whatsappVerify.ts`, `cookieFlags.ts`, `secret.ts` (normalisasi email ada di `emailSchema`; `email.ts` lama dihapus — tak terpakai) |
| `app/api/v1/auth/*` | tulis ulang `register`, `login`, `forgot-password`, `reset-password`; baru `registration/preview`, `registration/complete`, `contact`, `google/{start,callback,complete}`, `whatsapp/{verification,status}`, `webhooks/whatsapp`; hapus `verify-phone`, `verify-reset-otp`, `dev/otp` |
| `profile` | `PUT` tanpa `email` (`.strict()`); `GET` tanpa `phoneVerifiedAt` |
| `admin/system/users` POST | Zod `.strict()` + `emailVerifiedAt=now` (staf dibuat superadmin); `scripts/create-superadmin.ts` & `prisma/seed.ts` mengisi `emailVerifiedAt` |
| UI | `RegisterForm` (dua kolom kontak, tanpa langkah OTP), `LoginForm` (+tombol Google), `ForgotPasswordForm` (satu langkah), halaman `register/complete`, `reset-password`, `lengkapi-data`, `register/google`; hapus `OtpInput` |
| `lib/notifications` | `waMessage`: `null` untuk `visa_status_change`/`auto_cancelled`; `waTemplates.otp` dihapus; `notify()` pakai `user.whatsapp`; template email auth baru |
| Dokumen | `docs/auth-flow.md` (ditulis ulang sebagai ringkasan operasional, Fase 4), `CLAUDE.md` baris Auth & bagian WhatsApp/OTP, `docs/architecture/architecture-security.md`, `docs/deployment.md` (Google Console) |

## 5. Keamanan

- Token: acak 256-bit, hanya hash di DB, satu kali pakai atomik, kedaluwarsa singkat, tidak pernah ada di log atau `NotificationLog`.
- Anti-enumerasi: daftar, lupa password, dan urutan cek login menghasilkan respons yang sama untuk akun ada/tidak ada.
- Pemindai tautan email: konsumsi token hanya lewat `POST` dari tombol.
- Pre-hijacking & takeover lewat ganti email: §3.3 + SEC-17.
- Email auth adalah jalur kritis: domain pengirim terverifikasi (SPF/DKIM/DMARC) menjadi **syarat go-live**; kuota Resend (paket gratis ±100/hari) kemungkinan tidak cukup — butuh paket berbayar sebelum jamaah banyak.
- Dev-only hanya `NODE_ENV === 'development'` persis (SEC-02).
- Sesi JWT tidak bisa dicabut dari server (stateless): setelah reset password, sesi lama tetap berlaku sampai habis. Pre-existing, dicatat Low (SEC-18); `tokenVersion` di JWT = perbaikan kelak.

## 6. Fase eksekusi (satu PR per fase, dari `main`)

1. **Auth email (manual)** — SELESAI 2026-10-21 (§7): migrasi, token, register/complete/login/forgot/reset, hapus OTP, form kontak di daftar, perbaikan profile (SEC-17), staf `emailVerifiedAt`, uji + CI.
2. **Google** — SELESAI 2026-10-22 (§8): `lib/auth/google.ts` + server Google palsu, rute `start/callback/complete`, aturan sambung §3.3, UI tombol & halaman lengkapi, panel Integrasi.
3. **Lengkapi data** — SELESAI 2026-10-22 (§9): gerbang di layout, `PUT /auth/contact`, `ConsentLog` WhatsApp, penegakan di `POST /bookings`, lingkup WhatsApp, profil. (WA client E.164 sudah di Fase 1.)
4. **Penutupan:** hapus sisa kode/dok OTP, `CLAUDE.md`, security review akhir lintas fase.

## 7. Bukti verifikasi Fase 1 (as-built, 2026-10-21)

- `tsc --noEmit` bersih, `bun run build` 0 error. `scripts/test-auth.ts` (19 uji, DB sekali pakai + Resend palsu): pendaftaran tidak membuat akun,
  hanya hash token di DB, tautan sekali pakai, **balapan** (dua penyelesaian/reset bersamaan → tepat satu), kedaluwarsa, token berbentuk salah, jenis token
  tidak tertukar, **anti-pre-hijacking**, akun dinonaktifkan tak bisa direset, isi email (tautan, escape HTML, tanpa token di subjek), kegagalan Resend.
  **Uji mutasi:** klaim tanpa `usedAt: null`, token lama tak dihanguskan, pratinjau yang mengonsumsi — masing-masing membuat uji gagal (satu mutasi awalnya lolos →
  ditambah uji balapan reset). Rantai `bun run test` + CI: rate limit, email, notify, auth.
- Browser + HTTP (dev server di DB sekali pakai + Resend palsu): daftar lewat form → email terkirim (alamat huruf kecil) → **belum ada akun di DB** →
  halaman tautan menampilkan isian (nomor E.164) → pilih password → akun dibuat (`emailVerifiedAt`, 2 ConsentLog, hash bcrypt) → langsung di dashboard.
  Tautan dipakai ulang → 401; daftar email lama vs baru → respons identik; login huruf besar email → 200; salah password vs akun tak ada → identik;
  akun nonaktif / akun lama belum terverifikasi → 403 **hanya setelah password benar**; `PUT /auth/profile` dengan `email` → 400 (SEC-17 ditutup); forgot-password
  (ada/tak ada/nonaktif) → respons identik, email hanya untuk akun aktif; reset → sesi + login password baru; tautan reset sekali pakai; reset mengaktifkan akun lama;
  rate limit forgot/register per email → request ke-4 = 429; `verify-phone`, `verify-reset-otp`, `dev/otp` → 404.
- **Belum diverifikasi:** Resend NYATA (butuh domain terverifikasi), tampilan email di klien email sungguhan, alur Google (Fase 2), gerbang Lengkapi data (Fase 3).
- **Audit keamanan independen** (subagent `security-auditor`, read-only, 2026-10-21): 0 Critical, 0 High, 1 Medium, 8 Low. Tidak ada jalur pengambilalihan akun. Diperbaiki di fase ini:
  SEC-19 (Medium — persetujuan dicatat saat pemilik email menyelesaikan, bukan oleh pengirim form; nomor tampil samar di email; payload dibuang), SEC-20 (timing),
  SEC-21 (nama berisi tautan/karakter kontrol), SEC-22 (IPv6 /64), SEC-23 (log PII), SEC-24 (retensi `auth_tokens` + cron), SEC-25 (alamat di galat Resend); SEC-15/16/17 ditutup.
  Dicatat terbuka: SEC-26 (atomisitas batas login per akun), SEC-27 (seed tanpa penjaga), SEC-14/18 (sudah ada). Stub 410 `auth/otp/*` dihapus. Perubahan konsekuensi:
  form daftar tidak lagi memuat centang persetujuan — persetujuan privasi + WhatsApp dicentang di halaman penyelesaian (§3.2).

## 8. Fase 2 — Login Google (as-built, 2026-10-22)

**Implementasi** (menyimpang dari rencana §3.4 pada tiga hal, semuanya penyederhanaan):
- Tidak ada `GET /auth/methods`: halaman `login`/`register` adalah Server Component yang memanggil `googleConfigured()` langsung dan meneruskan prop ke form.
- Halaman lengkapi (`/{locale}/register/google`) membaca identitas dari cookie bertanda tangan di server (tanpa endpoint `pending`); `POST /auth/google/complete` menerima `{fullName, privacyConsent}`.
- Pengguna Google baru hanya menyetujui **kebijakan privasi** di sana; persetujuan notifikasi WhatsApp + nomor telepon/WhatsApp dikumpulkan di "Lengkapi data" (Fase 3).

**Berkas:** `lib/auth/google.ts` (protokol: state/nonce/PKCE S256, tukar kode, verifikasi ID token via JWKS, cookie bertanda tangan dengan kunci turunan SHA-256 + audience per jenis — tak bisa ditukar dengan JWT sesi), `lib/auth/googleAccounts.ts` (aturan §3.3, klaim tautan atomik `updateMany where googleSub null`), `lib/auth/googleCookies.ts` (cookie `SameSite=Lax`: callback adalah navigasi lintas-situs), rute `auth/google/{start,callback,complete}`, `GoogleButton` (logo "G" resmi), migrasi `20261022090000_user_google_sub` (`User.googleSub @unique`). Email `welcome` dikirim untuk pendaftaran Google dan manual.
Aturan sambung (diuji): `sub` dikenal → masuk (tetap benar walau email di Google berubah); email cocok akun pilgrim aktif → tersambung otomatis; akun lama belum terverifikasi → tersambung + password dimatikan; **staf tak pernah** (ditolak, tak diubah); nonaktif ditolak; email sudah tersambung ke Google LAIN → konflik; pengguna baru → cookie identitas 15 menit → persetujuan → akun.
Galat dikembalikan sebagai kode di `/login?error=google_*` (allow-list di halaman, bukan teks mentah dari query).

**Bukti verifikasi:**
- `scripts/test-google.ts` (36 uji; server Google palsu dengan kunci RSA nyata, **PKCE diverifikasi di sisi server palsu**; tiap uji "ditolak" didahului kontrol positif — sebelumnya 5 uji lolos hampa karena token tiruan tak memuat `nonce`, ditemukan dari kasus sukses yang gagal): nonce salah, audience salah, issuer salah, kedaluwarsa, kunci lain, tanpa sub/email, `email_verified` false/"true"/hilang, endpoint token menolak/tanpa id_token/tak terjangkau, konfusi algoritma HS256, override endpoint hanya development/test, cookie tak bisa ditukar dengan JWT sesi, aturan akun (sambung, legacy, staf ×3, nonaktif, konflik, balapan, duplikat).
- **Uji mutasi** 12 pengaman: 10 membuat uji gagal. 2 selamat dan ternyata *equivalent*: audience cookie (berlebih — kunci turunan sudah memisahkan) dan cek konflik awal (berlebih — klaim atomik menutupnya).
- Browser + HTTP (dev server + Google palsu penuh: redirect, PKCE, token RSA): tombol → halaman lengkapi (email huruf kecil, nama dari Google) → **belum ada akun** → setuju → akun dibuat + email sambutan → dashboard; akun manual (email beda huruf) tersambung langsung tanpa halaman lengkapi; staf → `/login?error=google_staff`, tidak ada sesi/tautan; state salah / tanpa cookie / cookie dipakai ulang → `google_failed`; ditolak di Google → `google_denied`; `locale` liar tak dipakai mentah; tanpa kredensial: tombol hilang, `start` → `google_unavailable`, halaman lengkapi tanpa cookie → `google_expired`.
- **Belum diverifikasi:** Google asli (butuh kredensial + redirect URI terdaftar + aplikasi berstatus *In production*), tampilan di layar persetujuan Google.
- **Audit keamanan independen Fase 2** (subagent `security-auditor`, read-only): 0 Critical, 0 High, 0 Medium, 5 Low — semuanya diperbaiki (SEC-28/29/30) kecuali pola locale di halaman non-auth (SEC-31, terbuka). Dari audit juga: uji ditambah — **kedaluwarsa cookie** (TTL produksi tepat 600/900 detik + kedaluwarsa nyata), **RS384 dengan JWKS tanpa `alg`** (membuktikan opsi `algorithms` benar-benar membatasi), **override production** untuk token/JWKS/issuer/auth (bukan hanya `buildAuthUrl`), token tanpa `exp`/`iat`, `googleConfigured` butuh `APP_URL`; 6 mutan baru semuanya tertangkap.
- **Rute HTTP** (state/cookie sekali pakai, allow-list `locale`, `createSession` hanya setelah semua cek) tak bisa diuji skrip Bun (butuh `next/headers`): diverifikasi manual (browser + curl, atas) dan sebagian dijaga langkah smoke CI **"auth email dan Google di image produksi"** (register/forgot seragam, token ngawur 404/401, rute OTP lama 404, `google/start` tanpa kredensial → `google_unavailable`, `google/callback` tanpa cookie → `google_failed`, `google/complete` tanpa cookie 401, tombol Google tersembunyi). Skrip langkah itu dijalankan lokal sebelum commit.
- **Koreksi §7:** klaim "reset mengaktifkan akun lama" hanya berlaku untuk keadaan sintetik (`isActive=true, emailVerifiedAt=null`): migrasi Fase 1 hanya mem-backfill `isActive=true`, jadi akun lama `isActive=false` tak punya jalur pemulihan lewat Google/lupa password (admin harus mengaktifkannya). Tak berdampak — belum ada pengguna nyata.

## 9. Fase 3 — Lengkapi data & lingkup WhatsApp (as-built, 2026-10-22)

- **Gerbang:** `(pilgrim)/layout.tsx` (Server Component) — untuk `role = pilgrim` dengan telepon **atau** WhatsApp kosong → `redirect /{locale}/lengkapi-data`. Halaman itu di luar grup `(pilgrim)` (tak berputar), butuh sesi (`middleware` PROTECTED + cek di halaman), mengalihkan ke dashboard bila sudah lengkap dan ke `/admin` untuk staf. Staf tidak terkena gerbang.
- **Penegakan di server:** `POST /bookings` → **422** bila telepon/WhatsApp pilgrim kosong (sebelum validasi isi) — gerbang UI saja tidak cukup karena notifikasi bergantung pada nomor.
- **`PUT /auth/contact`** (`lib/auth/contact.ts`): `{phone, whatsapp, whatsappConsent?}` E.164 `.strict()`. Persetujuan notifikasi WhatsApp wajib **sekali** bila akun belum punya catatannya (pengguna Google baru; akun legacy) — dicatat di `ConsentLog(whatsapp_notifications)` dalam transaksi yang sama; mengubah nomor berikutnya tidak meminta ulang. Pendaftar manual sudah menyetujui saat menyelesaikan pendaftaran.
- **UI:** `LengkapiDataForm` dan `ProfileForm` memakai `ContactPicker` (`showEmail={false}`; dua kolom + centang "Sama dengan nomor HP" dengan override lokal) diisi dari nomor tersimpan lewat `contactFromStored` (`splitE164`: kode panggilan terpanjang menang). Pemberitahuan: notifikasi WhatsApp dikirim selain email; nomor tidak diverifikasi.
- **Lingkup WhatsApp** (`waMessage`, `lib/notifications/events.ts`): hanya `booking_submitted`, `payment_reminder_12h/22h`, `payment_confirmed`, `payment_rejected`. `visa_status_change` dan `auto_cancelled` **email saja**. Dikunci di kode (tanpa saklar admin — sengaja sederhana). Template WA yang tak terpakai dibiarkan (ditinjau saat WhatsApp dibuka lagi).
- **SEC-31 ditutup:** `safeLocale()` kini dipakai di SEMUA `redirect(`/${locale}/…`)` (7 titik tersisa di `admin/*`, `(pilgrim)/*`).

**Bukti verifikasi:**
- 15 uji baru (`test-auth` 19→28, `test-notify` 14→20; termasuk yang ditambah setelah audit, di bawah): `isContactComplete`; `e164FromCountry`↔`splitE164` (ID, SA, +1268 Antigua mengalahkan +1, pulang-pergi); `contactSchema` (`.strict()`, E.164); `updateContact` (persetujuan wajib sekali, penolakan tak menyimpan apa pun, ubah nomor tanpa meminta ulang, tak dobel, `not_found`); lingkup WhatsApp (5 kejadian WA, 4 email-saja; kejadian email-saja dengan nomor WA ada **tidak** memanggil gateway dan tak menulis log WA).
- Browser + HTTP (Google palsu + DB sekali pakai): pengguna Google baru → langsung di `/lengkapi-data`; `/dashboard`, `/profile`, `/bookings` → 307 ke sana; `POST /bookings` → 422; `PUT /auth/contact` dengan nomor tanpa kode negara → 400, tanpa persetujuan → 400, field asing (`role`) → 400, tanpa sesi → 401; isi form (WhatsApp mengikuti telepon) → tersimpan E.164 + `ConsentLog` → dashboard; sesudahnya `dashboard`/`profile` 200 dan `POST /bookings` lolos gerbang kontak (gagal di validasi isi → 400); profil terisi dari data tersimpan tanpa centang persetujuan; staf tidak terkena gerbang. CI smoke diperluas (`PUT /auth/contact`, `POST /bookings`, `lengkapi-data` tanpa sesi).
- **Belum diverifikasi:** kirim WhatsApp ke gateway nyata (kondisi diblokir justru alasan lingkup diperkecil).
- **Audit keamanan independen Fase 3** (`security-auditor`): 0 Critical, 0 High, **2 Medium**, 5 Low. Diperbaiki: SEC-32 dimitigasi (rate limit `contactUpdateUser` 5/hari dan `bookingCreateUser` 20/jam; `notify()` hanya mengirim WA bila ada `ConsentLog` dan maks **10 WA per nomor tujuan per 24 jam** lintas akun; email `contact_changed` ke pemilik akun tiap nomor yang sudah ada berganti), SEC-34 (kunci `FOR UPDATE`), SEC-36 (uji: `requireContactForBooking` + uji sumber route memastikan penjaga mendahului `request.json()`/transaksi; `phone`≠`whatsapp` di data uji; body gateway digit-saja; 16 digit/non-digit), SEC-37 (profil kirim ulang nomor hanya bila diubah), log PII + JSON rusak di `POST /bookings` (SEC-23). **Terbuka (keputusan pemilik):** SEC-33 — persetujuan WhatsApp wajib tanpa jalur penarikan (UU PDP) dan SEC-35 (versi persetujuan); serta risiko sisa SEC-32 (verifikasi nomor bertentangan dengan keputusan produk 6).
- **Uji mutasi** 7 pengaman baru (FOR UPDATE, persetujuan diminta, `changed`, penjaga ConsentLog di notify, batas harian, penjaga route): semua tertangkap; satu kontrol (select ekstra) tetap lulus.

## 10. Penutupan Fase 4 (2026-10-22)

**Review keamanan lintas fase** (`security-auditor`, seluruh sistem auth + inventaris 131 rute API + infra + kecocokan dokumen): 0 Critical, 0 High, 2 Medium (usulan naik kelas: SEC-18 sesi tak bisa dicabut, SEC-44
penghapusan akun tak menghapus apa pun — keduanya **blocker go-live**), 11 Low baru, 1 butir "perlu dicek manual". Tidak ada rantai pengambilalihan akun lintas fase.

**Butir yang dicek manual dan TERBUKTI bug nyata — diperbaiki:** cookie sesi `SameSite=Strict` tidak dikirim pada rantai redirect yang diawali dari situs lain, sehingga login Google asli berakhir di halaman login
padahal sesi sudah dibuat (juga tautan di email notifikasi tampak "logout"). Direproduksi dengan Google palsu di `127.0.0.1` (situs berbeda dari aplikasi di `localhost`; Google palsu di `localhost` yang sama situs
menyembunyikan masalah ini): sebelum → mendarat di `/id/login`; sesudah (cookie `Lax`) → langsung `/id/dashboard`. **Keputusan 2026-10-22 mengubah aturan Strict di CLAUDE.md** (`docs/decisions.md`). CSRF tetap tertutup:
Lax tidak dikirim pada POST/PUT/DELETE lintas-situs dan semua operasi pengubah data bukan GET.
Penjaga: `lib/auth/cookieFlags.ts` (`SESSION_SAME_SITE`, `cookieSecure()`), diuji termasuk uji sumber agar tak kembali ke `strict`.

**Penguatan lain dari review (diperbaiki + diuji + uji mutasi):** `Secure` cookie kini fail-closed (`NODE_ENV !== 'development'`, bukan `=== 'production'`); `JWT_SECRET` divalidasi saat dipakai (≥32 karakter, bukan placeholder/awalan contoh, entropi
tidak rendah — `lib/auth/secret.ts`, juga untuk kunci turunan cookie Google); `NEXT_PUBLIC_BUSINESS_WA` placeholder (`628xxxxxxxxxx`) tak lagi dianggap terisi (`businessWaDigits`); batas password dihitung dalam **byte**
(bcrypt 72 byte); `auth/profile` JSON rusak → 400; `X-Powered-By` dimatikan; kontainer `migrate` hanya menerima `DATABASE_URL`.
**Kode mati dihapus:** `normalizePhone`, `phoneSchema`, `lib/auth/email.ts`, kunci i18n `otp/sendOtp/verifyOtp`. Template WA yang tak terpakai dipertahankan dengan catatan.

**Koreksi dokumen (hasil audit kecocokan):** §1 diberi label riwayat; keputusan 6/7 diberi catatan ADR-0002; §3.1 memuat kolom verifikasi WhatsApp dan nilai enum baru; `GET /auth/methods`, parameter `next`,
`verify-email`, `resend-verification` dihapus dari klaim; daftar `LIMITS` dilengkapi; `docs/auth-flow.md` ditulis ulang; dokumen lama yang memuat OTP (`architecture.md`, `spec.md`, `arsitektur-komponen-kontak.md`,
`arsitektur-notifikasi.md`, `architecture-security.md`, `RETROFIT-GAPS.md`, `docker-compose.prod.yml`, CLAUDE.md) diberi banner/koreksi.

**Daftar terbuka sebelum go-live** (lihat Register `docs/lessons-learned.md`): SEC-18 (sesi stateless — tonggak: `tokenVersion`/cek DB, utamanya jalur admin), SEC-44 (anonimisasi akun UU PDP), SEC-05 (17 advisory dependency high), SEC-26/27
(batas login atomik, seed tanpa penjaga), SEC-43 (alat admin lepas nomor), SEC-47 (BOLA `address/[id]`), serta uji dengan layanan asli (Resend: SPF/DKIM/DMARC; Google: redirect URI + status *In production* — dan konfirmasi login tidak
terpental ke halaman login; GOWA: bentuk `from`/`/app/status`) dan cek DB produksi bebas akun pra-migrasi.

**Hitungan uji terkini (Fase 4):** `test-rate-limit` 14, `test-email` 20, `test-notify` 29, `test-auth` 33, `test-google` 36, `test-whatsapp` 24 (semua lulus; angka di §7–§9 adalah hitungan saat fase itu dikerjakan).

