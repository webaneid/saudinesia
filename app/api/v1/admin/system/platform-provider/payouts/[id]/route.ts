import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { revenueSharePayoutVoidSchema } from '@/lib/validators/revenueShare'
import { requirePayoutRecorder } from '@/lib/revenue-share/policy'
import { voidPayout } from '@/lib/revenue-share/payouts'
import { payoutFailureResponse } from '@/lib/revenue-share/http'

// Batalkan pencairan (Fase 13e-1): tandai batal + entri pembalik. Superadmin klien (bukan akun Platform Provider).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requirePayoutRecorder()
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return payoutFailureResponse('not_found')
    const parsed = revenueSharePayoutVoidSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await voidPayout(id.data, parsed.data.reason, session.userId)
    if (!r.ok) return payoutFailureResponse(r.kind)
    return NextResponse.json(ok({ id: id.data, voided: true }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/payouts/[id]/POST')
  }
}
