import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
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
    await requireSuperAdmin()
    const category = new URL(req.url).searchParams.get('category')
    const vendors = await prisma.vendor.findMany({
      where: category ? { category } : undefined,
      include: { address: true },
      orderBy: { name: 'asc' },
    })
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
