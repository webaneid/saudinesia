import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { notify } from '@/lib/notifications/notify'
import { isValidVisaStatusTransition } from '@/lib/validators/visaStatus'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'

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
  notes: z.string().max(2000).optional(),
  rejectionReason: z.string().max(2000).optional(),
}).strict()

export async function PUT(req: Request, { params }: { params: Promise<{ pilgrimId: string }> }) {
  try {
    await requireAdmin()
    const { pilgrimId } = await params
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err('Input tidak valid'), { status: 400 })

    const { status, notes, rejectionReason } = parsed.data

    const pilgrim = await prisma.bookingPilgrim.findUnique({
      where: { id: pilgrimId },
      select: { bookingId: true, booking: { select: { bookingCode: true, user: { select: { id: true } } } }, visaApplication: { select: { status: true } } }, // tanpa kolom tersegel
    })
    if (!pilgrim) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    if (!pilgrim.visaApplication) return NextResponse.json(err('Visa application tidak ditemukan'), { status: 404 })

    // Validasi transisi status server-side — docs/arsitektur-visa.md §4 (dulu Gap #5: sebelumnya
    // hanya ditegakkan di client, endpoint ini bisa dipanggil langsung untuk melompat status)
    if (!isValidVisaStatusTransition(pilgrim.visaApplication.status, status)) {
      return NextResponse.json(
        err(`Transisi status tidak valid: ${pilgrim.visaApplication.status} → ${status}`),
        { status: 422 },
      )
    }

    // Dikirim ke Syarikah hanya untuk data jamaah yang sudah diverifikasi petugas (docs/arsitektur-jamaah.md §8.4 butir 5). Status pemeriksaan
    // dibaca ulang di dalam kunci FOR SHARE (SEC-202): pembukaan ulang serentak (dokumen diganti/ditolak) menunggu atau ditunggu, tak terselip.
    const updated = await prisma.$transaction(async (tx) => {
      // $queryRaw: Prisma ORM tidak punya SELECT ... FOR SHARE.
      const held = await tx.$queryRaw<{ reviewStatus: string }[]>`SELECT "reviewStatus"::text AS "reviewStatus" FROM "booking_pilgrims" WHERE "id" = ${pilgrimId} FOR SHARE`
      if (status === 'submitted_to_syarikah' && held[0]?.reviewStatus !== 'verified') return null
      return tx.visaApplication.update({
        where: { bookingPilgrimId: pilgrimId },
        data: {
          status,
          ...(notes ? { notes } : {}),
          ...(rejectionReason ? { rejectionReason } : {}),
          ...(status === 'submitted_to_syarikah' ? { submittedAt: new Date() } : {}),
          ...(status === 'issued' ? { issuedAt: new Date() } : {}),
        },
      })
    })
    if (!updated) return NextResponse.json(err('Verifikasi data jamaah ini dulu sebelum dikirim ke Syarikah'), { status: 422 })

    // Notifikasi (WhatsApp + email) — best-effort, tidak memblokir respons
    void notify({
      userId: pilgrim.booking.user.id,
      bookingId: pilgrim.bookingId,
      event: { type: 'visa_status_change', code: pilgrim.booking.bookingCode, status: VISA_STATUS_LABELS[status] ?? status },
    })

    return NextResponse.json(ok(updated))
  } catch (e) {
    return authFailureResponse(e, 'admin/visa/status')
  }
}
