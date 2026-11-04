import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { activeFilter, paginateCatalog, pickParam, readCatalogQuery } from '@/lib/admin/catalogQuery'
import { escapeLike } from '@/lib/utils/search'
import { z } from 'zod'
import { emptyToNull, richTextField } from '@/lib/validators/richText'
import { withAdminPrices } from '@/lib/pricing/engine/adminRead'
import { canViewCost } from '@/lib/pricing/policy'
import { documentRequirementListSchema } from '@/lib/validators/documents'
import { RequirementRejected, writeDefaultRequirements, writeRequirements } from '@/lib/documents/requirements'
import { writeDefaultManifestFields } from '@/lib/manifest/fields'

// price TIDAK ada di sini secara sengaja (docs/arsitektur-harga.md §17) — produk baru dibuat
// dengan price:0, baru terisi otomatis setelah admin mengisi komponen HPP di halaman edit.
const createSchema = z.object({
  name:         z.string().min(1),
  country:      z.string().default('Saudi Arabia'),
  visaType:     z.string().min(1),
  description:  richTextField().nullish(), // teks kaya, lihat docs/arsitektur-editor-teks.md
  // Syarat dokumen (docs/arsitektur-jamaah.md §7.6): tidak dikirim = daftar bawaan (paspor, KTP, KK, tiket PP), bisa diubah di halaman edit.
  requirements: documentRequirementListSchema.optional(),
  priceLabel:   z.string().optional(),
  processDays:  z.coerce.number().int().positive().default(14),
  isActive:     z.boolean().default(true),
}).strict()

export async function GET(req: Request) {
  try {
    const session = await requireManager()
    const cq = readCatalogQuery(new URL(req.url).searchParams)
    const like = { contains: escapeLike(cq.q), mode: 'insensitive' as const }
    const where = { ...activeFilter(cq.status), ...(cq.q ? { OR: [{ name: like }, { country: like }, { visaType: like }] } : {}) }
    const { items: products, meta } = await paginateCatalog(cq.list, () => prisma.visaProduct.count({ where }), range => prisma.visaProduct.findMany({
      where,
      orderBy: [{ country: 'asc' }, { visaType: 'asc' }, { id: 'asc' }],
      ...range,
    }))
    return NextResponse.json(ok(await withAdminPrices('visa', products, { includeCost: canViewCost(session.role) }), meta))
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
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.visaProduct.create({
        data: { name, country, visaType, description: emptyToNull(description), priceLabel: priceLabel ?? 'per orang', processDays, isActive },
      })
      const written = requirements ? await writeRequirements(tx, 'visa', product.id, requirements) : await writeDefaultRequirements(tx, 'visa', product.id)
      if (!written.ok) throw new RequirementRejected(written.error, written.field)
      await writeDefaultManifestFields(tx, 'visa', product.id) // tanpa ini form data jamaah produk baru kosong, termasuk nama
      return product
    }).catch((e: unknown) => (e instanceof RequirementRejected ? e : Promise.reject(e)))
    if (result instanceof RequirementRejected) return NextResponse.json({ ...err(result.message), ...(result.field && { meta: { field: result.field } }) }, { status: 400 })
    const product = result
    return NextResponse.json(ok(product), { status: 201 })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
