import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { costActualUpdateSchema, costActualVoidSchema } from '@/lib/validators/costActuals'
import { requireCostRecord } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { CostActualError, updateCostActual, voidCostActual } from '@/lib/costs/actuals'

type Ctx = { params: Promise<{ id: string; actualId: string }> }

// Ubah satu pengeluaran (baris rencana & pesanan tak dapat dipindah). Selisih/catatan dievaluasi ulang untuk barisnya.
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireCostRecord()
    const { id, actualId } = await params
    const parsed = costActualUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    await updateCostActual(id, actualId, { ...parsed.data, byUserId: session.userId })
    return NextResponse.json(ok({ id: actualId }))
  } catch (e) {
    if (e instanceof CostActualError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/cost-actuals/PUT')
  }
}

// "Hapus" = BATALKAN (alasan wajib; riwayat tetap). Membatalkan satu-satunya catatan penjelas selisih ditolak.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const session = await requireCostRecord()
    const { id, actualId } = await params
    const parsed = costActualVoidSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Alasan pembatalan wajib diisi'), { status: 400 })
    await voidCostActual(id, actualId, { reason: parsed.data.reason, byUserId: session.userId })
    return NextResponse.json(ok({ id: actualId, voided: true }))
  } catch (e) {
    if (e instanceof CostActualError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/bookings/cost-actuals/DELETE')
  }
}
