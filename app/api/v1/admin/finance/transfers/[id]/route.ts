import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { cashTransferActionSchema } from '@/lib/validators/cashTransfers'
import { requireCashTransfer } from '@/lib/pricing/policy'
import { voidTransfer } from '@/lib/cash/transfers'
import { transferFailureResponse } from '@/lib/cash/transfersHttp'

// Batalkan transfer (§10.14 Fase 12b): tandai batal + entri pembalik di buku kas. Manager + superadmin.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCashTransfer()
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return transferFailureResponse('not_found')
    const parsed = cashTransferActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    const r = await voidTransfer(id.data, parsed.data.reason, session.userId)
    if (!r.ok) return transferFailureResponse(r.kind)
    return NextResponse.json(ok({ id: id.data, voided: true }))
  } catch (e) {
    return authFailureResponse(e, 'admin/finance/transfers/[id]/POST')
  }
}
