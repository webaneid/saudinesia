import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { syncAndNotify } from '@/lib/payments/gateway'

// Admin: "Periksa status" pembayaran online (Fase 9) — tak ada verifikasi manual untuk pembayaran gateway; status hanya dari iPaymu.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const r = await syncAndNotify(id)
    if (r.kind === 'not_found') return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    if (r.kind === 'unavailable') return NextResponse.json(err('Kunci iPaymu belum terpasang di server'), { status: 409 })
    return NextResponse.json(ok({ state: r.kind }))
  } catch (e) {
    return authFailureResponse(e, 'admin/payments/check')
  }
}
