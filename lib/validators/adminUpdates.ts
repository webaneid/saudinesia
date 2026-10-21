import { z } from 'zod'
import { UserRole } from '@prisma/client'

// Skema UPDATE untuk rute admin yang dulu meneruskan body mentah ke prisma.update (mass assignment).
// `.strict()` — field di luar daftar DITOLAK (400), bukan diabaikan diam-diam, supaya klien yang salah ketahuan.

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

/**
 * PUT /api/v1/admin/products/haji/[id]. pendingQuota/bookedQuota SENGAJA tidak ada: dikelola mesin booking
 * (lib/quota/adapters) — mengubahnya dari body merusak hitungan kuota.
 */
export const hajiProductUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
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
