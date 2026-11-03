import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'
import { RequirementRejected, requirementsOf, writeRequirements } from '@/lib/documents/requirements'
import { documentRequirementListSchema } from '@/lib/validators/documents'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { deleteVisaProduct } from '@/lib/admin/productDelete'
import { visaFeeRules, visaPriceSummary } from '@/lib/pricing/engine/read'
import { visaRequiredComponentsSchema } from '@/lib/validators/visa'

// price TIDAK ada di sini secara sengaja — VisaProduct.price cuma boleh diisi oleh
// repriceOwner('visa', id) (lib/pricing/engine) (docs/arsitektur-harga.md §17), bukan input admin manual.
const updateSchema = z.object({
  name:         z.string().min(1).optional(),
  country:      z.string().optional(),
  visaType:     z.string().optional(),
  // Teks kaya (docs/arsitektur-editor-teks.md): divalidasi daftar putih & dibersihkan; '' / tanpa teks bermakna → null.
  description:  richTextField().nullish(),
  requirements: documentRequirementListSchema.optional(), // ganti-semua syarat dokumen (lib/documents/requirements.ts)
  priceLabel:   z.string().nullable().optional(),
  processDays:  z.coerce.number().int().positive().optional(),
  isActive:     z.boolean().optional(),
  // Aturan ketergantungan (docs/arsitektur-booking-engine-v2.md §10.2) — bentuk dijaga skema yang SAMA dengan pembacanya (lib/booking/rules.ts).
  requiredComponents: visaRequiredComponentsSchema.optional(),
}).strict()

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const product = await prisma.visaProduct.findUnique({ where: { id } })
    if (!product) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const documentRequirements = await requirementsOf('visa', id)
    const [summary, rules] = await Promise.all([visaPriceSummary([id]), visaFeeRules([id])])
    return NextResponse.json(ok({ ...product, price: summary.get(id)?.from ?? 0, durationFeeRules: rules.get(id) ?? [], documentRequirements }))
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
    const body = await req.json().catch(() => null)
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const { description, requirements, ...fields } = parsed.data
    // Produk + syarat dokumen dalam SATU transaksi — syarat tak pernah setengah tersimpan.
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.visaProduct.update({
        where: { id },
        data: { ...fields, ...(description !== undefined && { description: emptyToNull(description) }) },
      })
      if (requirements) {
        const written = await writeRequirements(tx, 'visa', id, requirements)
        if (!written.ok) throw new RequirementRejected(written.error, written.field)
      }
      return product
    }).catch((e: unknown) => (e instanceof RequirementRejected ? e : Promise.reject(e)))
    if (result instanceof RequirementRejected) return NextResponse.json({ ...err(result.message), ...(result.field && { meta: { field: result.field } }) }, { status: 400 })
    const product = result
    return NextResponse.json(ok({ ...product, price: (await visaPriceSummary([id])).get(id)?.from ?? 0, durationFeeRules: (await visaFeeRules([id])).get(id) ?? [] }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Produk visa tidak ditemukan'), { status: 404 })
    console.error('[admin/products/visa/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Hapus sungguhan hanya bila tak ada riwayat yang merujuk; selain itu nonaktif (lib/admin/productDelete.ts).
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    return NextResponse.json(ok(await deleteVisaProduct(id)))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Produk visa tidak ditemukan'), { status: 404 })
    console.error('[admin/products/visa/[id]/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
