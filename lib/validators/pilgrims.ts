import { z } from 'zod'
import { getCountryName } from '@/lib/constants/countries'
import { isCalendarDate } from '@/lib/time'
import { addressSchema } from './address'
import { e164Schema, emailSchema, fullNameSchema } from './auth'

// Kartu jamaah tersimpan (docs/arsitektur-jamaah.md §4–§5). `.strict()`: kolom liar (ownerId, identityId, matchStatus, nikHash, …) ditolak (SEC-03).
// NIK & nomor paspor dikirim mentah di sini dan HANYA dinormalisasi/dienkripsi di lib/pilgrims/service.ts lewat lib/pii.
// Konvensi ubah: kolom tidak dikirim (`undefined`) = tetap; `null` = dikosongkan. NIK tak pernah dikirim balik ke klien, jadi
// "tetap" adalah satu-satunya cara mengubah kolom lain tanpa mengetik ulang NIK.

const calendarDate = z.string().refine(isCalendarDate, 'Tanggal tidak valid (YYYY-MM-DD)')
const countryCode = z.string().trim().toUpperCase().refine(c => /^[A-Z]{2}$/.test(c) && getCountryName(c) !== null, 'Negara tidak dikenal')

export const savedPilgrimPassportSchema = z.object({
  number: z.string().max(40).optional(), // tidak dikirim saat ubah = nomor lama dipertahankan
  issuedAt: calendarDate.nullish(),
  expiry: calendarDate.nullish(),
}).strict()

export const savedPilgrimInputSchema = z.object({
  fullName: fullNameSchema, // sesuai paspor
  gender: z.enum(['male', 'female']).nullish(),
  birthPlace: z.string().trim().max(100).nullish(),
  birthDate: calendarDate.refine(d => d >= '1900-01-01', 'Tanggal lahir tidak valid'),
  nationality: countryCode.default('ID'),
  nik: z.string().max(40).nullish(),
  passport: savedPilgrimPassportSchema.nullish(),
  address: addressSchema.nullish(),
  phone: e164Schema.nullish(),
  whatsapp: e164Schema.nullish(),
  email: emailSchema.nullish(),
  isSelf: z.boolean().optional(), // "Saya sendiri" — satu per akun
}).strict()

export type SavedPilgrimInput = z.infer<typeof savedPilgrimInputSchema>
