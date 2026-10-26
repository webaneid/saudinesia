import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireManager, requireSuperAdmin, SUPERADMIN_ROLES } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { COUNTRIES, getCountryName } from '@/lib/constants/countries'
import { VENDOR_CATEGORY_SLUGS } from '@/lib/constants/vendor'
import { addressSchema } from '@/lib/validators/address'
import { createVendor, deleteOrDeactivateVendor, getVendor, listVendors, countVendors, toVendorDto, updateVendor, type VendorDto } from './service'

// PONTE SEMENTARA (ADR-0003, docs/arsitektur-vendor.md §4): route `/admin/system/settings/vendors*` dipertahankan SAMPAI F4 supaya UI lama
// (tab Pengaturan, picker di 6 editor) tetap berfungsi, tetapi isinya hanya penerjemah ke layanan baru (`lib/vendors/service.ts`) — TIDAK ADA
// logika/penulisan vendor sendiri, jadi tidak ada dualisme data. Dihapus di F4 bersama UI yang memakainya.

const LEGACY_TO_SLUG: Record<string, string> = { syarikah: 'visa', maskapai: 'airline', hotel: 'hotel', transport: 'transport', internal: 'internal' }
const SLUG_TO_LEGACY: Record<string, string> = Object.fromEntries(Object.entries(LEGACY_TO_SLUG).map(([k, v]) => [v, k]))
const ENGLISH_COUNTRIES: Record<string, string> = { 'saudi arabia': 'SA', indonesia: 'ID' }

export const legacyCategoryToSlug = (category: string | null | undefined): string => LEGACY_TO_SLUG[category ?? ''] ?? VENDOR_CATEGORY_SLUGS.other

export function legacyCountryToCode(text: string | null | undefined): string | null {
  const t = (text ?? '').trim().toLowerCase()
  if (!t) return null
  return ENGLISH_COUNTRIES[t] ?? COUNTRIES.find(c => c.name.toLowerCase() === t || c.code.toLowerCase() === t)?.code ?? null
}

function toLegacy(v: VendorDto) {
  const first = v.categories[0]
  return {
    id: v.id, name: v.name, isActive: v.isActive, address: v.address,
    category: first ? (SLUG_TO_LEGACY[first.slug] ?? 'other') : null,
    country: (v.countryCode && getCountryName(v.countryCode)) || '',
    contactInfo: v.notes,
    categories: v.categories,
  }
}

const createSchema = z.object({
  name: z.string().min(1), category: z.string().nullish(), country: z.string().nullish(), contactInfo: z.string().nullish(),
  isActive: z.boolean().optional(), address: addressSchema.optional(),
})
const updateSchema = z.object({
  name: z.string().min(1).optional(), category: z.string().nullish(), country: z.string().nullish(), contactInfo: z.string().nullish(),
  isActive: z.boolean().optional(), address: addressSchema.optional(),
})

async function categoryIdForSlug(slug: string): Promise<string | null> {
  return (await prisma.vendorCategory.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null
}

type Ctx = { params: Promise<{ id: string }> }

export async function legacyVendorsGET(req: Request) {
  try {
    const session = await requireManager()
    const legacyCategory = new URL(req.url).searchParams.get('category')
    // Dengan ?category= = pemakaian picker: hanya vendor AKTIF (vendor nonaktif ditolak saat disimpan). Kategori lama yang merupakan label modul
    // (package/tour_package/haji) kini berarti "semua vendor" — komponen biaya bebas boleh memakai vendor apa pun.
    const slug = legacyCategory ? LEGACY_TO_SLUG[legacyCategory] : undefined
    const filters = { status: legacyCategory ? ('active' as const) : ('all' as const), ...(slug ? { category: slug } : {}) }
    const total = await countVendors(filters)
    const rows = await listVendors({ ...filters, skip: 0, take: Math.max(1, Math.min(total, 500)) })
    const items = rows.map(r => toLegacy(toVendorDto(r)))
    const slim = !SUPERADMIN_ROLES.includes(session.role)
    return NextResponse.json(ok(slim ? items.map(({ id, name, category, country, isActive }) => ({ id, name, category, country, isActive })) : items))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/settings/vendors/GET')
  }
}

export async function legacyVendorsPOST(req: Request) {
  try {
    await requireSuperAdmin()
    const parsed = createSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { name, category, country, contactInfo, isActive, address } = parsed.data
    const countryCode = country ? legacyCountryToCode(country) : 'SA' // default lama: Saudi Arabia
    if (!countryCode) return NextResponse.json(err('Negara tidak dikenali — buat vendor lewat menu Sistem → Vendor'), { status: 400 })
    const categoryId = await categoryIdForSlug(legacyCategoryToSlug(category))
    if (!categoryId) return NextResponse.json(err('Kategori vendor tidak ditemukan'), { status: 400 })
    const result = await createVendor({ name, countryCode, categoryIds: [categoryId], notes: contactInfo?.trim() || null, isActive: isActive ?? true, ...(address ? { address } : {}) } as Parameters<typeof createVendor>[0])
    if (!result.ok) return NextResponse.json(err(result.message), { status: result.status })
    return NextResponse.json(ok(toLegacy(toVendorDto(result.vendor))), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/system/settings/vendors/POST')
  }
}

export async function legacyVendorPUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const current = await getVendor(id)
    if (!current) return NextResponse.json(err('Vendor tidak ditemukan'), { status: 404 })
    const { name, category, country, contactInfo, isActive, address } = parsed.data

    const update: Parameters<typeof updateVendor>[1] = {}
    if (name !== undefined) update.name = name
    if (isActive !== undefined) update.isActive = isActive
    if (address) update.address = address
    if (country) {
      const code = legacyCountryToCode(country)
      if (!code) return NextResponse.json(err('Negara tidak dikenali — ubah lewat menu Sistem → Vendor'), { status: 400 })
      if (code !== current.vendor.countryCode) update.countryCode = code
    }
    if (contactInfo !== undefined && (contactInfo?.trim() || null) !== current.vendor.notes) update.notes = contactInfo?.trim() || null
    // Form lama hanya tahu SATU kategori: ganti hanya bila kategori itu belum termasuk (jangan menimpa vendor multi-kategori).
    if (category) {
      const slug = legacyCategoryToSlug(category)
      if (!current.vendor.categories.some(c => c.slug === slug)) {
        const categoryId = await categoryIdForSlug(slug)
        if (!categoryId) return NextResponse.json(err('Kategori vendor tidak ditemukan'), { status: 400 })
        update.categoryIds = [categoryId]
      }
    }
    if (Object.keys(update).length === 0) return NextResponse.json(ok(toLegacy(toVendorDto(current.vendor))))
    const result = await updateVendor(id, update)
    if (!result.ok) return NextResponse.json(err(result.message), { status: result.status })
    return NextResponse.json(ok(toLegacy(toVendorDto(result.vendor))))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/settings/vendors/[id]/PUT')
  }
}

export async function legacyVendorDELETE(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const r = await deleteOrDeactivateVendor(id)
    if (!r.found) return NextResponse.json(err('Vendor tidak ditemukan'), { status: 404 })
    if ('blocked' in r) return NextResponse.json(err('Vendor sistem tidak dapat dihapus atau dinonaktifkan'), { status: 409 })
    return NextResponse.json(ok({ deleted: r.deleted, deactivated: !r.deleted }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/settings/vendors/[id]/DELETE')
  }
}
