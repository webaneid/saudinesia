import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { requireRefundManage } from '@/lib/pricing/policy'
import { refundCandidates } from '@/lib/refunds/candidates'

// Pemilih booking di "Buat Refund" (§10.13): cari kode/nama atau `id` tepat (dari halaman booking); hanya booking yang masih punya dana dapat dikembalikan.
const query = z.object({ q: z.string().trim().max(100).optional(), id: z.uuid().optional() }).strict()

export async function GET(req: Request) {
  try {
    await requireRefundManage()
    const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err('Pencarian tidak valid'), { status: 400 })
    return NextResponse.json(ok(await refundCandidates(prisma, parsed.data)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return authFailureResponse(e, 'admin/refunds/candidates')
  }
}
