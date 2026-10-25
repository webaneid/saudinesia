import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { emailSchema, passwordSchema } from './auth'
import { richTextField } from './richText'

// Skema UPDATE untuk rute admin yang dulu meneruskan body mentah ke prisma.update (mass assignment).
// `.strict()` — field di luar daftar DITOLAK (400), bukan diabaikan diam-diam, supaya klien yang salah ketahuan.

/** POST /api/v1/admin/system/users — akun STAF (jamaah mendaftar sendiri lewat /auth/register atau Google). Role pilgrim tidak boleh dibuat di sini. */
export const staffCreateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Nama minimal 2 karakter').max(100),
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(['admin', 'manager', 'superadmin']).default('admin'),
  })
  .strict()

/** PUT /api/v1/admin/system/users/[id] — hanya role & status aktif. passwordHash, resetToken, email, dst TIDAK boleh lewat sini. */
export const userAdminUpdateSchema = z
  .object({
    role: z.nativeEnum(UserRole).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.isActive !== undefined, { message: 'Tidak ada perubahan' })

const nullableDate = z
  .string()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === '') return null
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal tidak valid' })
      return z.NEVER
    }
    return d
  })

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD')
  .refine(v => !Number.isNaN(new Date(v).getTime()), 'Tanggal tidak valid')
  .transform(v => new Date(v))

/**
 * POST /api/v1/admin/products/seasons. Sebelumnya `new Date(b.startDate)` dari body mentah (tanggal rusak → Invalid Date → galat DB
 * → 403). Nama = nilai yang dipahami `detectSeason()` (lib/utils/season.ts) dan ditawarkan form admin.
 */
export const seasonCreateSchema = z
  .object({
    name: z.enum(['regular', 'ramadan', 'hajj']),
    startDate: isoDate,
    endDate: isoDate,
  })
  .strict()
  .refine(v => v.endDate >= v.startDate, { message: 'Tanggal akhir tidak boleh sebelum tanggal mulai', path: ['endDate'] })

/**
 * POST /api/v1/admin/products/catering. Sebelumnya route membaca body mentah tanpa Zod (harga NaN, tipe liar ke Prisma).
 * Nilai boardType/menuStyle = opsi yang ditawarkan form admin dan dipetakan label-nya di halaman publik.
 */
export const cateringOptionCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    boardType: z.enum(['full_board', 'half_board']),
    menuStyle: z.enum(['asian', 'arabic', 'western']),
    description: richTextField().nullish(), // teks kaya (docs/arsitektur-editor-teks.md)
    pricePerPersonRegular: z.number().min(0),
    pricePerPersonRamadan: z.number().min(0),
    pricePerPersonHajj: z.number().min(0),
  })
  .strict()

/**
 * POST /api/v1/admin/products/haji. Sebelumnya route membaca body mentah tanpa Zod (angka NaN, tipe liar masuk ke Prisma).
 * Kuota terpakai (pendingQuota/bookedQuota) tidak ada: dikelola mesin booking.
 */
export const hajiProductCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    hajiType: z.enum(['furoda', 'khusus', 'reguler', 'plus']),
    year: z.number().int().min(2000).max(2100),
    description: richTextField().nullish(), // teks kaya (docs/arsitektur-editor-teks.md)
    departureDate: nullableDate.optional(),
    returnDate: nullableDate.optional(),
    durationDays: z.number().int().min(1).max(365).nullable().optional(),
    includes: z.array(z.string().max(300)).max(100).default([]),
    price: z.number().min(0),
    totalQuota: z.number().int().min(0),
  })
  .strict()

/**
 * PUT /api/v1/admin/products/haji/[id]. pendingQuota/bookedQuota SENGAJA tidak ada: dikelola mesin booking
 * (lib/quota/adapters) — mengubahnya dari body merusak hitungan kuota.
 */
export const hajiProductUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: richTextField().nullish(), // teks kaya (docs/arsitektur-editor-teks.md); dulu string maks 5000 — JSON dokumen jauh lebih panjang dari teksnya
    hajiType: z.enum(['furoda', 'khusus', 'reguler', 'plus']).optional(),
    year: z.number().int().min(2000).max(2100).optional(),
    departureDate: nullableDate.optional(),
    returnDate: nullableDate.optional(),
    durationDays: z.number().int().min(1).max(365).nullable().optional(),
    includes: z.array(z.string().max(300)).max(100).optional(),
    price: z.number().min(0).optional(),
    totalQuota: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Tidak ada perubahan' })
