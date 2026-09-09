import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { simulateSellPrice, type SimulateComponent } from '@/lib/pricing/simulateSellPrice'
import { z } from 'zod'

const querySchema = z.object({
  visaCost: z.coerce.number().positive(),
  visaCurrency: z.string().min(1),
  brnCost: z.coerce.number().positive().optional(),
  brnCurrency: z.string().min(1).optional(),
})

// Preview HPP/harga jual dari angka yang sedang diketik admin (belum tersimpan) — bukan
// dari ProductCost tersimpan seperti /preview. Tidak butuh productId — kalkulasi cuma
// bergantung productType ('visa', tetap sesuai halaman ini) + angka yang dikirim.
// Lihat docs/arsitektur-harga.md §16.
export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const { searchParams } = new URL(req.url)
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Parameter tidak valid'), { status: 400 })
    const { visaCost, visaCurrency, brnCost, brnCurrency } = parsed.data

    const components: SimulateComponent[] = [{ currency: visaCurrency, cost: visaCost }]
    if (brnCost != null) {
      if (!brnCurrency) return NextResponse.json(err('brnCurrency wajib diisi kalau brnCost ada'), { status: 400 })
      components.push({ currency: brnCurrency, cost: brnCost })
    }

    const result = await simulateSellPrice('visa', components)
    return NextResponse.json(ok(result))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/visa/simulate/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
