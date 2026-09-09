import { z } from 'zod'
import { addressSchema } from './address'

export const passwordSchema = z
  .string()
  .min(8, 'Password minimal 8 karakter')
  .regex(/[a-zA-Z]/, 'Password harus mengandung huruf')
  .regex(/[0-9]/, 'Password harus mengandung angka')
  .regex(/[^a-zA-Z0-9]/, 'Password harus mengandung karakter spesial (!@#$%...)')

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
  email: z.string().email('Format email tidak valid'),
  password: passwordSchema,
  phone: z
    .string()
    .min(9, 'Nomor terlalu pendek')
    .max(15, 'Nomor terlalu panjang')
    .regex(/^[0-9+\s-]+$/, 'Format nomor tidak valid'),
})

export const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Password tidak boleh kosong'),
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Format email tidak valid'),
})

export const verifyResetOtpSchema = z.object({
  phone: z.string().min(9).max(15),
  code: z.string().length(6).regex(/^\d+$/),
})

export const resetPasswordSchema = z.object({
  resetToken: z.string().uuid('Token tidak valid'),
  newPassword: passwordSchema,
})

export const verifyPhoneSchema = z.object({
  phone: z.string().min(9).max(15),
  code: z.string().length(6).regex(/^\d+$/),
})

export const profileSchema = z.object({
  fullName: z.string().min(2, 'Nama minimal 2 karakter').max(100),
  email: z.string().email('Format email tidak valid').optional(),
  address: addressSchema.optional(), // docs/arsitektur-alamat.md §9 — alamat rumah jamaah
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ProfileInput = z.infer<typeof profileSchema>
