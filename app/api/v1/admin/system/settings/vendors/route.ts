import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager, requireSuperAdmin, SUPERADMIN_ROLES } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { addressSchema } from '@/lib/validators/address'
import { upsertAddress } from '@/lib/address/prepare'
import { z } from 'zod'

const createSchema = z.object({
  name:        z.string().min(1),
  category:    z.string().optional(),
  country:     z.string().default('Saudi Arabia'),
  contactInfo: z.string().optional(),
  isActive:    z.boolean().default(true),
  address:     addressSchema.optional(), // docs/arsitektur-alamat.md §9
})

export async function GET(req: Request) {
  try {
    // SEC-61(b): editor produk (manager) memuat daftar vendor untuk dropdown HPP — perlu membaca, tidak perlu mengelola. Manager hanya
    // dapat kolom pemilih; kontak & alamat vendor tetap khusus superadmin (yang juga satu-satunya yang boleh menulis).
    const session = await requireManager()
    const full = SUPERADMIN_ROLES.includes(session.role)
    const category = new URL(req.url).searchParams.get('category')
    const where = category ? { category } : undefined
    const orderBy = [{ name: 'asc' as const }, { id: 'asc' as const }]
    const vendors = full
      ? await prisma.vendor.findMany({ where, include: { address: true }, orderBy })
      : await prisma.vendor.findMany({ where, select: { id: true, name: true, category: true, country: true, isActive: true }, orderBy })
    return NextResponse.json(ok(vendors))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/vendors/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin()
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { address, ...rest } = parsed.data

    let addressId: string | undefined
    if (address) {
      const result = await upsertAddress(null, address)
      if (!result.ok) return NextResponse.json(err(result.message), { status: 400 })
      addressId = result.id
    }

    const vendor = await prisma.vendor.create({ data: { ...rest, ...(addressId ? { addressId } : {}) } })
    return NextResponse.json(ok(vendor), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/vendors/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
