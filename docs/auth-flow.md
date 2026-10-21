> **DISUPERSEDE 2026-10-21 oleh `docs/arsitektur-auth.md` dan ADR-0001** (auth berbasis email, tanpa OTP WhatsApp).
> Dokumen ini dipertahankan sebagai riwayat; bagian verifikasi akun / reset password / peran WhatsApp di bawah sudah TIDAK berlaku
> setelah Fase 1 dieksekusi.

# Saudinesia — Auth Flow (Final)

## Prinsip

| Concern | Mekanisme |
|---------|-----------|
| Login | Email + Password |
| Verifikasi akun baru | OTP ke WhatsApp (ganti email verification) |
| Reset password | OTP ke WhatsApp → set password baru |
| Notifikasi booking/visa | WhatsApp (GOWA) |

GOWA = notification layer, bukan auth dependency.  
Login tetap bisa meski GOWA down.

---

## Password Rules
- Minimal 8 karakter
- Minimal 1 huruf (a-z / A-Z)
- Minimal 1 angka (0-9)
- Minimal 1 karakter spesial (`!@#$%^&*` dll)

---

## User Roles & Cara Akun Dibuat

| Role | Cara dibuat | Login |
|------|-------------|-------|
| Pilgrim / Agent | Self-register | Email + Password |
| Admin (Ops) | Dibuat Super Admin di dashboard | Email + Password |
| Super Admin | Seed script | Email + Password |

---

## Alur Detail

### 1. Registrasi (Pilgrim & Agent)

```
Step 1 — Form:
  • Nama lengkap
  • Email
  • Password (strength: huruf + angka + spesial, min 8)
  • Nomor WhatsApp

  POST /api/v1/auth/register
    → Validasi semua field
    → Cek email belum dipakai
    → Hash password (bcrypt)
    → Buat user (isActive: false)
    → Kirim OTP ke WhatsApp

Step 2 — Verifikasi WA:
  • Input 6 digit OTP

  POST /api/v1/auth/verify-phone { phone, code }
    → Verifikasi OTP dari otp_requests
    → Set user.isActive = true, phoneVerifiedAt = now()
    → Buat session (JWT cookie)
    → Redirect ke /dashboard
```

### 2. Login

```
POST /api/v1/auth/login { email, password }
  → Cari user by email
  → Cek isActive (harus true)
  → bcrypt.compare(password, passwordHash)
  → Buat session
  → Redirect ke /dashboard atau /admin
```

### 3. Forgot Password

```
Step 1 — Masukkan email:
  POST /api/v1/auth/forgot-password { email }
    → Cari user by email, cek phoneVerifiedAt tidak null
    → Kirim OTP ke phone
    → Return { phone: "628xxx***xxx" } (masked)

Step 2 — Masukkan OTP:
  POST /api/v1/auth/verify-reset-otp { phone, code }
    → Verifikasi OTP
    → Buat resetToken (UUID) + resetTokenExp (+ 15 menit)
    → Simpan ke user
    → Return { resetToken }

Step 3 — Password baru:
  POST /api/v1/auth/reset-password { resetToken, newPassword }
    → Cari user by resetToken, cek exp belum lewat
    → Validasi password strength
    → Hash + update password
    → Clear resetToken
    → Buat session
    → Redirect ke dashboard
```

### 4. Logout

```
POST /api/v1/auth/logout → clear cookie
```

---

## Schema Changes (Prisma)

### Kolom baru di `users`:

```
email            String   @unique          ← primary login identifier
passwordHash     String                    ← bcrypt hash
phoneVerifiedAt  DateTime?                 ← null = WA belum diverifikasi
resetToken       String?                   ← UUID satu kali pakai
resetTokenExp    DateTime?                 ← expired 15 menit
```

### Kolom yang berubah:

```
fullName   String    ← dari nullable jadi required
phone      String?   ← tetap optional di DB, required di form registrasi
isActive   Boolean   ← false saat register, true setelah OTP verify
```

---

## API Routes

```
POST /api/v1/auth/register          → daftar (nama+email+password+phone)
POST /api/v1/auth/verify-phone      → verifikasi OTP WA → aktifkan akun
POST /api/v1/auth/login             → email + password → session
POST /api/v1/auth/logout            → clear cookie
POST /api/v1/auth/forgot-password   → email → OTP ke WA
POST /api/v1/auth/verify-reset-otp  → OTP → resetToken
POST /api/v1/auth/reset-password    → resetToken + password baru
PUT  /api/v1/auth/profile           → update nama/email
```

---

## Halaman UI

```
/[locale]/(auth)/login/             ← email + password (ganti OTP form)
/[locale]/(auth)/register/          ← step 1: form | step 2: OTP verify
/[locale]/(auth)/forgot-password/   ← step 1: email | step 2: OTP | step 3: password baru
/[locale]/admin/login/              ← email + password, dark theme (ganti OTP form)
```

---

## Komponen Tetap Dipakai

- `OtpInput`, `OtpCountdown`, `useOtpCountdown` — dipakai di register step 2 & forgot password
- `lib/auth/otp.ts` — `generateOtp`, `storeOtp`, `verifyAndConsumeOtp`
- `lib/auth/session.ts` — tidak berubah

## Dependensi Baru

```bash
bun add bcryptjs && bun add -D @types/bcryptjs
```
