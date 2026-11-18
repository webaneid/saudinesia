import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { revenueSharePayoutSchema } from '@/lib/validators/revenueShare'
import { requireSuperAdmin } from '@/lib/auth/session'
import { requirePayoutRecorder } from '@/lib/revenue-share/policy'
import { createPayout, listPayouts } from '@/lib/revenue-share/payouts'
import { payoutFailureResponse } from '@/lib/revenue-share/http'
import { parseListParams } from '@/lib/table/pagination'

// Pencairan bagi hasil (Fase 13e-1, §5e). Baca: semua superadmin (termasuk Platform Provider). Catat: superadmin klien, BUKAN akun Platform Provider (Q3).
const listSchema = z.object({ status: z.enum(['active', 'void']).optional().catch(undefined) })

export async function GET(req: Request) {
  try {
    await requireSuperAdmin()
    const sp = new URL(req.url).searchParams
    const q = listSchema.parse(Object.fromEntries(sp))
    const { items, meta } = await listPayouts({ status: q.status }, parseListParams(sp))
    return NextResponse.json(ok(items, meta))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/payouts/GET')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePayoutRecorder()
    const parsed = revenueSharePayoutSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await createPayout(parsed.data, session.userId)
    if (!r.ok) return payoutFailureResponse(r.kind, r.balanceIdr)
    return NextResponse.json(ok({ id: r.value.id }), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/payouts/POST')
  }
}
