import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { bookingCompletionSchema } from '@/lib/validators/completion'
import { canReopenBooking, requireBookingComplete } from '@/lib/booking/policy'
import { COMPLETION_BLOCKER_LABEL, completeBooking, reopenBooking } from '@/lib/booking/completion'

// Tandai selesai (semua admin) / Buka kembali (manager/superadmin) — Fase 13d, docs/arsitektur-bagi-hasil.md §5d. Aturan sungguhan di lib/booking/completion.ts.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireBookingComplete() // semua admin; sesi diperiksa sebelum membaca body
    const parsed = bookingCompletionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })
    if (parsed.data.action === 'reopen' && !canReopenBooking(session.role)) return NextResponse.json(err('Membuka kembali pesanan selesai hanya oleh manager/superadmin'), { status: 403 })
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const r = parsed.data.action === 'complete' ? await completeBooking(id.data, session.userId) : await reopenBooking(id.data, session.userId)
    switch (r.kind) {
      case 'not_found': return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
      case 'owner_unavailable': return NextResponse.json(err('Akun pelanggan ini sudah dihapus atau nonaktif — pesanan tidak dapat dibuka kembali'), { status: 409 })
      case 'not_completed': return NextResponse.json(err('Pesanan ini tidak berstatus selesai'), { status: 409 })
      case 'blocked': return NextResponse.json({ ...err(r.blockers.map(b => COMPLETION_BLOCKER_LABEL[b]).join('; ')), meta: { blockers: r.blockers } }, { status: 409 })
      case 'done': return NextResponse.json(ok({ status: parsed.data.action === 'complete' ? 'completed' : 'active' }))
    }
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/completion')
  }
}
