import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { simulateSellPrice } from '@/lib/pricing/simulateSellPrice'
import { z } from 'zod'

const querySchema = z.object({
  hargaTiket: z.coerce.number().positive(),
  currency: z.string().min(1),
})

// Preview HPP/harga jual dari angka yang sedang diketik admin (belum tersimpan) — pola identik
// /api/v1/admin/products/visa/simulate (docs/arsitektur-harga.md §16), cuma productType beda.
// Tidak butuh scheduleId — kalkulasi cuma bergantung productType ('flight') + angka yang dikirim.
export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const { searchParams } = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const { hargaTiket, currency } = parsed.data

    const result = await simulateSellPrice('flight', [{ currency, cost: hargaTiket }])
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/flight/simulate/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
