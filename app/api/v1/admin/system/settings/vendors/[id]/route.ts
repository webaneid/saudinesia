import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { addressSchema } from '@/lib/validators/address'
import { upsertAddress } from '@/lib/address/prepare'
import { z } from 'zod'

const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  category:    z.string().nullable().optional(),
  country:     z.string().optional(),
  contactInfo: z.string().nullable().optional(),
  isActive:    z.boolean().optional(),
  address:     addressSchema.optional(), // docs/arsitektur-alamat.md §9
})

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const { address, ...rest } = parsed.data

    const data: Record<string, unknown> = { ...rest }
    if (address) {
      const existing = await prisma.vendor.findUniqueOrThrow({ where: { id }, select: { addressId: true } })
      const result = await upsertAddress(existing.addressId, address)
      if (!result.ok) return NextResponse.json(err(result.message), { status: 400 })
      data.addressId = result.id
    }

    const vendor = await prisma.vendor.update({ where: { id }, data })
    return NextResponse.json(ok(vendor))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Vendor tidak ditemukan'), { status: 404 })
    console.error('[admin/system/settings/vendors/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    // Vendor dipakai ProductCost/PreferredVendor — nonaktifkan (isActive:false), bukan hapus fisik,
    // supaya tidak kena FK constraint kalau sudah ada HPP yang mereferensikannya (pola sama dengan
    // kenapa vehicle Transport juga tidak punya DELETE fisik, lihat docs/arsitektur-transportasi.md §3).
    const vendor = await prisma.vendor.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json(ok(vendor))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Vendor tidak ditemukan'), { status: 404 })
    console.error('[admin/system/settings/vendors/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
