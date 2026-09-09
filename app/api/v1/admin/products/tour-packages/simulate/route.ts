import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { simulateSellPrice } from '@/lib/pricing/simulateSellPrice'
import { z } from 'zod'

const querySchema = z.object({
  cost:     z.coerce.number().positive(),
  currency: z.string().min(1),
})

// Preview HPP/harga jual per komponen dari angka yang sedang diketik admin (belum tersimpan) —
// pola identik /api/v1/admin/products/flight/simulate. Array 1 elemen = margin per-komponen
// (docs/arsitektur-ziarah.md §8.3), sama matematikanya dengan sum-lalu-margin saat cuma 1 item.
export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const { searchParams } = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const { cost, currency } = parsed.data

    const result = await simulateSellPrice('tour_package', [{ currency, cost }])
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/simulate/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
