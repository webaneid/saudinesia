import { NextResponse } from 'next/server'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { cashTransferCreateSchema, cashTransferListSchema } from '@/lib/validators/cashTransfers'
import { requireCashTransfer, requireCashView } from '@/lib/pricing/policy'
import { createTransfer, listTransfers } from '@/lib/cash/transfers'
import { transferFailureResponse } from '@/lib/cash/transfersHttp'
import { parseListParams } from '@/lib/table/pagination'

// Transfer antar akun kas (§10.14 Fase 12b). Baca: semua admin; catat: manager + superadmin (K12-1).
export async function GET(req: Request) {
  try {
    await requireCashView()
    const sp = new URL(req.url).searchParams
    const q = cashTransferListSchema.parse(Object.fromEntries(sp))
    const { items, meta } = await listTransfers({ status: q.status }, parseListParams(sp))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    return authFailureResponse(e, 'admin/finance/transfers/GET')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireCashTransfer()
    const parsed = cashTransferCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const r = await createTransfer(parsed.data, session.userId)
    if (!r.ok) return transferFailureResponse(r.kind)
    return NextResponse.json(ok({ id: r.value.id }), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/finance/transfers/POST')
  }
}
