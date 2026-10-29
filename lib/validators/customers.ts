import { z } from 'zod'
import { addressSchema } from './address'
import { e164Schema, emailSchema, fullNameSchema } from './auth'

// Tambah pelanggan oleh admin (docs/arsitektur-pelanggan.md §6). `.strict()`: kolom liar (role, isActive, passwordHash, emailVerifiedAt, …) ditolak — tak ada jalan
// membuat staf atau akun berpassword/terverifikasi lewat sini. Email dinormalisasi huruf kecil (identitas akun, sama dengan semua jalur auth).
export const customerCreateSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  phone: e164Schema.nullish(),
  whatsapp: e164Schema.nullish(),
  address: addressSchema.nullish(),
  /** Kirim email undangan "buat password" (bawaan ya). */
  sendInvite: z.boolean().default(true),
}).strict()

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>
