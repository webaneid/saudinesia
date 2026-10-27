import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { withAdminPrices } from '@/lib/pricing/engine/adminRead'
import { canViewCost } from '@/lib/pricing/policy'

const requirementSchema = z.object({
  docType:     z.string().min(1),
  label:       z.string().min(1),
  description: z.string().default(''),
  required:    z.boolean().default(true),
})

// price TIDAK ada di sini secara sengaja (docs/arsitektur-harga.md §17) — produk baru dibuat
// dengan price:0, baru terisi otomatis setelah admin mengisi komponen HPP di halaman edit.
const createSchema = z.object({
  name:         z.string().min(1),
  country:      z.string().default('Saudi Arabia'),
  visaType:     z.string().min(1),
  description:  richTextField().nullish(), // teks kaya, lihat docs/arsitektur-editor-teks.md
  requirements: z.array(requirementSchema).default([]),
  priceLabel:   z.string().optional(),
  processDays:  z.coerce.number().int().positive().default(14),
  isActive:     z.boolean().default(true),
}).strict()

export async function GET() {
  try {
    const session = await requireManager()
    const products = await prisma.visaProduct.findMany({
      orderBy: [{ country: 'asc' }, { visaType: 'asc' }],
    })
    return NextResponse.json(ok(await withAdminPrices('visa', products, { includeCost: canViewCost(session.role) })))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const { name, country, visaType, description, requirements, priceLabel, processDays, isActive } = parsed.data
    // requirements Json TETAP diisi untuk kompatibilitas mundur (dibaca kode lama yang belum
    // pindah, docs/arsitektur-dokumen.md §5), tapi DocumentRequirement (di bawah) adalah sumber
    // kebenaran BARU — pemanggil baru pakai getDocumentRequirements(), bukan field ini.
    const product = await prisma.visaProduct.create({
      data: { name, country, visaType, description: emptyToNull(description), requirements, price: 0, priceLabel: priceLabel ?? 'per orang', processDays, isActive },
    })
    if (requirements.length > 0) {
      await prisma.documentRequirement.createMany({
        data: requirements.map((r, i) => ({
          productType: 'visa', productId: product.id,
          docType: r.docType, label: r.label, description: r.description, required: r.required, order: i,
        })),
      })
    }
    return NextResponse.json(ok(product), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
