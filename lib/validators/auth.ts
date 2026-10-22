import { z } from 'zod'
import { addressSchema } from './address'
import { TOKEN_PATTERN } from '@/lib/auth/tokenPattern'

export const passwordSchema = z
  .string()
  .min(8, 'Password minimal 8 karakter')
  .regex(/[a-zA-Z]/, 'Password harus mengandung huruf')
  .regex(/[0-9]/, 'Password harus mengandung angka')
  .regex(/[^a-zA-Z0-9]/, 'Password harus mengandung karakter spesial (!@#$%...)')
  // bcrypt hanya membaca 72 BYTE pertama: karakter non-ASCII (mis. emoji/aksara) bisa >1 byte, jadi hitung byte — bukan karakter — agar tak terpotong diam-diam.
  .refine((v) => new TextEncoder().encode(v).length <= 72, 'Password maksimal 72 byte (karakter non-ASCII dihitung lebih dari satu)')

/** Email selalu dinormalisasi huruf kecil di batas validasi — semua pemanggil menerima nilai yang sudah rapi. */
export const emailSchema = z.string().trim().toLowerCase().email('Format email tidak valid').max(254)

/** Nomor telepon/WhatsApp: digit E.164 tanpa "+" (kode negara + nomor), 8–15 digit. Klien menyusunnya dari kode negara + nomor lokal. */
export const e164Schema = z.string().regex(/^[1-9]\d{7,14}$/, 'Nomor tidak valid (sertakan kode negara)')

const localeSchema = z.enum(['id', 'en']).default('id')
const tokenSchema = z.string().regex(TOKEN_PATTERN, 'Tautan tidak valid')

// Pendaftaran manual TIDAK memuat password: akun dibuat setelah pemilik email mengklik tautan dan memilih password sendiri
// (docs/arsitektur-auth.md §3.2) — menutup pre-hijacking.
// Nama masuk ke email resmi Saudinesia yang dikirim ke pemilik email (bisa orang lain): tanpa karakter kontrol (baris palsu di
// versi teks) dan tanpa pola tautan/alamat (celah phishing lewat domain pengirim tepercaya).
const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Nama minimal 2 karakter')
  .max(100)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Nama mengandung karakter tidak valid')
  .refine((v) => !/:\/\/|@/.test(v), 'Nama tidak boleh berisi tautan atau alamat email')

// Persetujuan TIDAK diminta di sini: pengirim form belum tentu pemilik email. Persetujuan diberikan pemilik email di halaman
// penyelesaian (completeRegistrationSchema) dan dicatat pada waktu itu.
export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    phone: e164Schema,
    whatsapp: e164Schema,
    locale: localeSchema,
  })
  .strict()

/** Data isian pendaftaran yang menunggu di AuthToken.payload sampai tautan diklik. */
export const registrationPayloadSchema = z.object({
  fullName: z.string(),
  phone: e164Schema,
  whatsapp: e164Schema,
})

export const tokenOnlySchema = z.object({ token: tokenSchema }).strict()

// Pengguna Google baru: nama boleh disunting (diprefill dari Google); persetujuan privasi wajib sebelum akun dibuat.
export const googleCompleteSchema = z
  .object({
    fullName: fullNameSchema,
    privacyConsent: z.literal(true, { errorMap: () => ({ message: 'Anda harus menyetujui Kebijakan Privasi' }) }),
  })
  .strict()

export const completeRegistrationSchema = z
  .object({
    token: tokenSchema,
    password: passwordSchema,
    privacyConsent: z.literal(true, { errorMap: () => ({ message: 'Anda harus menyetujui Kebijakan Privasi' }) }),
    whatsappConsent: z.literal(true, { errorMap: () => ({ message: 'Anda harus menyetujui pemberitahuan WhatsApp' }) }),
  })
  .strict()

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password tidak boleh kosong'),
})

export const forgotPasswordSchema = z.object({ email: emailSchema, locale: localeSchema }).strict()

export const resetPasswordSchema = z.object({ token: tokenSchema, newPassword: passwordSchema }).strict()

// `email` SENGAJA tidak ada: email adalah identitas akun, mengubahnya tanpa verifikasi membuka pengambilalihan akun
// (SEC-17). Ganti email = fitur terpisah dengan verifikasi email BARU.
export const profileSchema = z
  .object({
    fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
    address: addressSchema.optional(), // docs/arsitektur-alamat.md §9 — alamat rumah jamaah
  })
  .strict()

// Telepon + WhatsApp akun. `whatsappConsent` hanya wajib bila akun belum pernah menyetujui (dicek server — lib/auth/contact.ts).
export const contactSchema = z
  .object({ phone: e164Schema, whatsapp: e164Schema, whatsappConsent: z.boolean().optional() })
  .strict()

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ProfileInput = z.infer<typeof profileSchema>
