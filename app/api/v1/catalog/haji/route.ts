import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'
import { toCatalogHaji } from '@/lib/haji/catalog'

const q = z.object({ hajiType: z.string().optional(), year: z.coerce.number().optional() })

export async function GET(request: Request) {
  try {
    const parsed = q.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return NextResponse.json(err('Parameter tidak valid'), { status: 400 })

    const { hajiType, year } = parsed.data
    const products = await prisma.hajiProduct.findMany({
      where: { isActive: true, ...(hajiType && { hajiType }), ...(year && { year }) },
      orderBy: [{ year: 'asc' }, { price: 'asc' }],
    })
    // Peta eksplisit (tanpa kolom kuota mentah) dan produk yang belum berharga ditaruh paling akhir.
    const items = products.map(toCatalogHaji)
    items.sort((a, b) => Number(!a.priced) - Number(!b.priced)) // sort stabil: urutan tahun/harga dipertahankan di dalam tiap kelompok
    return NextResponse.json(ok(items, { total: items.length }))
  } catch (e) { console.error('[catalog/haji]', e); return NextResponse.json(err('Internal server error'), { status: 500 }) }
}
