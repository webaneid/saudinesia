import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { notify } from '@/lib/notifications/notify'
import { isValidVisaStatusTransition } from '@/lib/validators/visaStatus'
import { z } from 'zod'

const VISA_STATUS_LABELS: Record<string, string> = {
  pending_documents:     'Menunggu Dokumen',
  documents_complete:    'Dokumen Lengkap',
  submitted_to_syarikah: 'Dikirim ke Syarikah',
  in_review:             'Sedang Diproses',
  issued:                'Visa Terbit',
  rejected:              'Ditolak',
}

const schema = z.object({
  status: z.enum(['pending_documents','documents_complete','submitted_to_syarikah','in_review','issued','rejected']),
  notes: z.string().optional(),
  rejectionReason: z.string().optional(),
})

export async function PUT(req: Request, { params }: { params: Promise<{ pilgrimId: string }> }) {
  try {
    await requireAdmin()
    const { pilgrimId } = await params
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err('Input tidak valid'), { status: 400 })

    const { status, notes, rejectionReason } = parsed.data

    const pilgrim = await prisma.bookingPilgrim.findUnique({
      where: { id: pilgrimId },
      include: { booking: { include: { user: true } }, visaApplication: true },
    })
    if (!pilgrim) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    if (!pilgrim.visaApplication) return NextResponse.json(err('Visa application tidak ditemukan'), { status: 404 })

    // Validasi transisi status server-side — docs/arsitektur-visa.md §7 Gap #5 (sebelumnya
    // hanya ditegakkan di client, endpoint ini bisa dipanggil langsung untuk melompat status)
    if (!isValidVisaStatusTransition(pilgrim.visaApplication.status, status)) {
      return NextResponse.json(
        err(`Transisi status tidak valid: ${pilgrim.visaApplication.status} → ${status}`),
        { status: 422 },
      )
    }

    const updated = await prisma.visaApplication.update({
      where: { bookingPilgrimId: pilgrimId },
      data: {
        status,
        ...(notes ? { notes } : {}),
        ...(rejectionReason ? { rejectionReason } : {}),
        ...(status === 'submitted_to_syarikah' ? { submittedAt: new Date() } : {}),
        ...(status === 'issued' ? { issuedAt: new Date() } : {}),
      },
    })

    // Notifikasi (WhatsApp + email) — best-effort, tidak memblokir respons
    void notify({
      userId: pilgrim.booking.user.id,
      bookingId: pilgrim.bookingId,
      event: { type: 'visa_status_change', code: pilgrim.booking.bookingCode, status: VISA_STATUS_LABELS[status] ?? status },
    })

    return NextResponse.json(ok(updated))
  } catch (e) {
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/visa/status]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
