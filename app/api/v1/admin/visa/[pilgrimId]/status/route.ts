import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { notify } from '@/lib/notifications/notify'
import { visaStatusChangeSchema } from '@/lib/validators/visaStatus'
import { changeVisaStatus } from '@/lib/visa/status'
import { VISA_STATUS } from '@/lib/constants/booking'
import { authFailureResponse } from '@/lib/admin/errors'

// Ubah status visa satu jamaah — penulisnya `changeVisaStatus` (lib/visa/status.ts, docs/arsitektur-visa.md §9).
export async function PUT(req: Request, { params }: { params: Promise<{ pilgrimId: string }> }) {
  try {
    const session = await requireAdmin()
    const { pilgrimId } = await params
    const parsed = visaStatusChangeSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Input tidak valid'), { status: 400 })

    const r = await changeVisaStatus(pilgrimId, parsed.data, session.userId)
    if (r.kind === 'not_found') return NextResponse.json(err('Pengajuan visa tidak ditemukan'), { status: 404 })
    if (r.kind === 'invalid_transition') return NextResponse.json(err(`Transisi status tidak valid: ${VISA_STATUS[r.from].label} → ${VISA_STATUS[r.to].label}`), { status: 422 })
    if (r.kind === 'not_verified') return NextResponse.json(err('Verifikasi data jamaah ini dulu sebelum dikirim ke Syarikah'), { status: 422 })

    // Notifikasi (email; WhatsApp tidak untuk kejadian ini) — best-effort, tidak memblokir respons.
    void notify({ userId: r.userId, bookingId: r.bookingId, event: { type: 'visa_status_change', code: r.bookingCode, status: VISA_STATUS[r.status].label } })
    return NextResponse.json(ok({ status: r.status }))
  } catch (e) {
    return authFailureResponse(e, 'admin/visa/status')
  }
}
