import { z } from 'zod'
import { COUNTRIES } from '@/lib/constants/countries'
import { addressSchema } from './address'

// Skema vendor + kategori (ADR-0003). Semua `.strict()` — kolom lain (mis. `systemKey`, `nameKey`, `isSystem`) tidak boleh bisa ditulis dari body.
// Field terkontrol UI mengirim '' / null untuk kolom kosong → keduanya dinormalisasi jadi null.

const COUNTRY_CODES = new Set<string>(COUNTRIES.map(c => c.code))
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)
const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max, `Maksimal ${max} karakter`).nullish())
const countryCode = z.string().refine(c => COUNTRY_CODES.has(c), 'Kode negara tidak dikenal')
const optionalCountryCode = z.preprocess(blankToNull, countryCode.nullish())
// Nomor lokal: hanya digit (spasi/strip/tanda plus dibuang), 4-20 digit — penggabungan dengan kode negara dilakukan penampil/ekspor.
const optionalPhone = z.preprocess(
  (v) => (typeof v === 'string' ? (v.replace(/[\s\-().+]/g, '') === '' ? null : v.replace(/[\s\-().+]/g, '')) : v),
  z.string().regex(/^[0-9]{4,20}$/, 'Nomor harus 4-20 digit').nullish(),
)
const optionalEmail = z.preprocess(blankToNull, z.string().trim().toLowerCase().email('Format email tidak valid').max(254).nullish())
const optionalWebsite = z.preprocess(blankToNull, z.string().trim().max(200).refine(v => {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' } catch { return false }
}, 'Website harus berupa URL http:// atau https://').nullish())

const categoryIds = z.array(z.string().uuid('Kategori tidak valid')).min(1, 'Pilih minimal satu kategori').max(12, 'Maksimal 12 kategori')
  .refine(ids => new Set(ids).size === ids.length, 'Kategori ganda')

const vendorFields = {
  name:                z.string().trim().min(1, 'Nama vendor wajib diisi').max(160, 'Nama vendor terlalu panjang'),
  countryCode:         countryCode,
  categoryIds:         categoryIds,
  contactName:         optionalText(120),
  phoneCountryCode:    optionalCountryCode,
  phone:               optionalPhone,
  whatsappCountryCode: optionalCountryCode,
  whatsapp:            optionalPhone,
  email:               optionalEmail,
  website:             optionalWebsite,
  notes:               optionalText(2000),
  address:             addressSchema.optional(), // docs/arsitektur-alamat.md §9 (upsertAddress)
  isActive:            z.boolean(),
}

// Nomor tanpa kode negara tak bermakna — pasangannya wajib ada.
function pairRule(v: { phone?: string | null; phoneCountryCode?: string | null; whatsapp?: string | null; whatsappCountryCode?: string | null }, ctx: z.RefinementCtx) {
  if (v.phone && !v.phoneCountryCode) ctx.addIssue({ code: 'custom', path: ['phoneCountryCode'], message: 'Pilih kode negara untuk nomor telepon' })
  if (v.whatsapp && !v.whatsappCountryCode) ctx.addIssue({ code: 'custom', path: ['whatsappCountryCode'], message: 'Pilih kode negara untuk nomor WhatsApp' })
}

export const vendorCreateSchema = z.object({ ...vendorFields, isActive: vendorFields.isActive.default(true) }).strict().superRefine(pairRule)

export const vendorUpdateSchema = z.object(Object.fromEntries(Object.entries(vendorFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) as {
  [K in keyof typeof vendorFields]: z.ZodOptional<(typeof vendorFields)[K]>
}).strict().superRefine(pairRule).refine(v => Object.keys(v).length > 0, { message: 'Tidak ada perubahan' })

export const vendorCategoryCreateSchema = z.object({
  name:      z.string().trim().min(2, 'Nama kategori minimal 2 karakter').max(80, 'Nama kategori terlalu panjang'),
  sortOrder: z.number().int().min(0).max(10000).optional(),
}).strict()

export const vendorCategoryUpdateSchema = z.object({
  name:      z.string().trim().min(2, 'Nama kategori minimal 2 karakter').max(80, 'Nama kategori terlalu panjang').optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isActive:  z.boolean().optional(),
}).strict().refine(v => Object.keys(v).length > 0, { message: 'Tidak ada perubahan' })

export type VendorCreate = z.infer<typeof vendorCreateSchema>
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>
