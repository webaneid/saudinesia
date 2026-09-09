import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { getDocumentRequirements } from '@/lib/documents/getRequirements'

const requirementSchema = z.object({
  docType:     z.string().min(1),
  label:       z.string().min(1),
  description: z.string().default(''),
  required:    z.boolean().default(true),
})

// price TIDAK ada di sini secara sengaja — VisaProduct.price cuma boleh diisi oleh
// refreshVisaProductCache() (docs/arsitektur-harga.md §17), bukan input admin manual.
const updateSchema = z.object({
  name:         z.string().min(1).optional(),
  country:      z.string().optional(),
  visaType:     z.string().optional(),
  description:  z.string().nullable().optional(),
  requirements: z.array(requirementSchema).optional(),
  priceLabel:   z.string().nullable().optional(),
  processDays:  z.coerce.number().int().positive().optional(),
  isActive:     z.boolean().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const product = await prisma.visaProduct.findUnique({ where: { id } })
    if (!product) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    // docs/arsitektur-dokumen.md §4 — sumber kebenaran BARU, dikirim berdampingan `requirements`
    // (Json lama, deprecated) supaya builder bisa pindah bertahap tanpa breaking.
    const documentRequirements = await getDocumentRequirements('visa', id)
    return NextResponse.json(ok({ ...product, documentRequirements }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json(err('Data tidak valid'), { status: 400 })

    const product = await prisma.visaProduct.update({ where: { id }, data: parsed.data })
    // Replace-all DocumentRequirement kalau requirements dikirim — sumber kebenaran baru
    // (docs/arsitektur-dokumen.md §4), requirements Json tetap ikut ditulis untuk kompatibilitas
    // mundur (dari input yang sama, tidak ada risiko drift).
    if (parsed.data.requirements) {
      await prisma.documentRequirement.deleteMany({ where: { productType: 'visa', productId: id } })
      if (parsed.data.requirements.length > 0) {
        await prisma.documentRequirement.createMany({
          data: parsed.data.requirements.map((r, i) => ({
            productType: 'visa', productId: id,
            docType: r.docType, label: r.label, description: r.description, required: r.required, order: i,
          })),
        })
      }
    }
    return NextResponse.json(ok(product))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    await prisma.visaProduct.delete({ where: { id } })
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/[id]/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
