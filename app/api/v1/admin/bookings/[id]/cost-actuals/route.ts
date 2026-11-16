import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { costActualCreateSchema } from '@/lib/validators/costActuals'
import { requireCostRecord, requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { CostActualError, createCostActual, listCostActuals } from '@/lib/costs/actuals'
import { cashTargetOptions, parseCashTarget } from '@/lib/cash/accounts'

type Ctx = { params: Promise<{ id: string }> }

// Baris rencana (modal HPP awal) + pengeluaran aktual ke vendor untuk satu pesanan — INTERNAL admin.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requirePricingView()
    const { id } = await params
    const [list, cashOptions] = await Promise.all([listCostActuals(id), cashTargetOptions()]) // pilihan akun kas pembayar (Fase 7b-2b)
    return NextResponse.json(ok({ ...list, cashOptions }))
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
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const cashAccount = parseCashTarget(parsed.data.cashAccount)
    if (!cashAccount) return NextResponse.json(err('Pilih akun kas pembayar'), { status: 400 })
    const created = await createCostActual({ bookingId: id, ...parsed.data, cashAccount, byUserId: session.userId })
    return NextResponse.json(ok(created), { status: 201 })
  } catch (e) {
    if (e instanceof CostActualError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/cost-actuals/POST')
  }
}
