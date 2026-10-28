import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { costActualCreateSchema } from '@/lib/validators/costActuals'
import { requireCostRecord, requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { CostActualError, createCostActual, listCostActuals } from '@/lib/costs/actuals'

type Ctx = { params: Promise<{ id: string }> }

// Baris rencana (modal HPP awal) + pengeluaran aktual ke vendor untuk satu pesanan — INTERNAL admin.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requirePricingView()
    const { id } = await params
    return NextResponse.json(ok(await listCostActuals(id)))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/cost-actuals/GET')
  }
}

// Catat uang yang benar-benar keluar ke vendor. Catatan penyebab selisih wajib bila menyimpang dari HPP awal (aturan di lib/costs/actuals.ts).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireCostRecord()
    const { id } = await params
    const parsed = costActualCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const created = await createCostActual({ bookingId: id, ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof CostActualError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/cost-actuals/POST')
  }
}
