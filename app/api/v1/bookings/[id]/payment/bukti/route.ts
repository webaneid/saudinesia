import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { cashAccountForSnapshot, ensureQrisCashAccount } from '@/lib/cash/accounts'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy } from '@/lib/auth/rateLimit'
import { DocumentFileRejected, prepareDocumentFile } from '@/lib/documents/file'
import { docIpLimited, readFileWithFields } from '@/lib/documents/http'
import { buildObjectKey, deleteObject, uploadBuffer } from '@/lib/storage/minio'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'
import { bookingPayTo } from '@/lib/invoice/banks'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { claimRefusal, paymentLimits, type ClaimRefusal } from '@/lib/payments/limits'
import { paymentTransferSchema, TRANSFER_KEYS } from '@/lib/validators/paymentTransfer'
import { formatRupiah } from '@/lib/utils'
import { payableQris } from '@/lib/qris/payable'
import { logError } from '@/lib/log'

const CLOCK_SKEW_MS = 5 * 60_000 // jam perangkat pelanggan boleh sedikit meleset dari server

// Bukti transfer + data transfer (Fase 7a F2, docs/arsitektur-booking-engine-v2.md §10.7). Nominal diisi pelanggan (bawaan sisa tagihan) dan
// dinilai `paymentLimits` di DALAM kunci booking (P2: minimal DP/sisa menuju DP, maksimal sisa). `amount` tetap 0 sampai admin memverifikasi;
// yang diklaim pelanggan disimpan terpisah (`claimedAmountIdr`). Rekening tujuan dipilih dari daftar yang sama dengan halaman (`bookingPayTo`).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const limited = await docIpLimited(request)
    if (limited) return limited
    const { id } = await params

    const booking = await prisma.booking.findFirst({
      where: { id, userId: session.userId, status: { not: 'draft' } }, // draf = 404, sama seperti GET
      select: { id: true, status: true, createdAt: true, invoice: { select: { bankSnapshot: true } } },
    })
    if (!booking) return apiErrorJson('bookingNotFound', 404)
    // Booking hidup menerima bukti selama masih ada sisa — termasuk cicilan/pelunasan sesudah kursi terkonfirmasi (Fase 7a F3; sisa dinilai di dalam kunci).
    if (booking.status !== 'active') return apiErrorJson('bookingNotAwaitingPayment', 422)
    // Tanpa rekening tujuan, bukti transfer tak punya arti (pelanggan bisa saja mentransfer ke rekening yang salah) — K3, evaluasi 2026-11-14.
    const payTo = await bookingPayTo(booking.invoice)
    const qrisList = await payableQris() // Fase 8: QRIS aktif saat ini (K8-2) juga tujuan bayar
    if (payTo.length === 0 && qrisList.length === 0) return apiErrorJson('paymentNoDestination', 409)

    // Satu bukti menunggu verifikasi pada satu waktu (perilaku v1: dulu dijaga status `payment_review`, kini diturunkan dari adanya payment `pending`).
    if (await prisma.payment.count({ where: { bookingId: id, status: 'pending' } }) > 0) {
      return apiErrorJson('paymentProofPending', 422)
    }
    // Fase 9 (K9-3): pembayaran online yang masih menunggu harus dibatalkan dulu — dua jalur bayar serentak = bayar ganda.
    if (await prisma.payment.count({ where: { bookingId: id, status: 'awaiting' } }) > 0) return apiErrorJson('onlinePaymentActive', 409)

    // Per akun, di atas batas per IP: unggahan gambar memicu pemrosesan sharp dan penulisan ke MinIO.
    const perAccount = await consume(policy('pilgrimDocUser', session.userId))
    if (!perAccount.allowed) {
      const res = apiErrorJson('tooManyUploads', 429)
      res.headers.set('Retry-After', String(perAccount.retryAfterSec))
      return res
    }

    const read = await readFileWithFields(request, TRANSFER_KEYS)
    if (read instanceof NextResponse) return read
    const parsed = paymentTransferSchema.safeParse(read.raw)
    if (!parsed.success) return zodFailure(parsed.error)
    const input = parsed.data
    if (input.transferredAt.getTime() > Date.now() + CLOCK_SKEW_MS) return apiErrorJson('paymentTimeFuture', 400, { field: 'transferredAt' })
    if (input.transferredAt.getTime() < booking.createdAt.getTime() - CLOCK_SKEW_MS) return apiErrorJson('paymentTimeInvalid', 400, { field: 'transferredAt' }) // tak ada tagihan sebelum booking dibuat
    const dest = input.destination.kind === 'bank' ? payTo[input.destination.index] : undefined
    const destQris = input.destination.kind === 'qris' ? qrisList.find(q => q.id === (input.destination as { id: string }).id) : undefined
    if (!dest && !destQris) return apiErrorJson('paymentDestinationRequired', 400, { field: 'destination' })
    const destinationLabel = (dest ? `${dest.bankName} ${dest.accountNumber} a.n. ${dest.accountHolder}` : `QRIS ${destQris?.name ?? ''}`).slice(0, 200)
    const { minimumFirstPaymentPercent } = await getInvoiceSettings()

    // Jenis ditentukan dari ISI berkas, bukan MIME/nama dari klien; gambar dienkode ulang (EXIF/GPS dibuang). Nama asli tidak dipakai di kunci objek.
    let prepared: Awaited<ReturnType<typeof prepareDocumentFile>>
    try {
      prepared = await prepareDocumentFile(read.file)
    } catch (e) {
      if (e instanceof DocumentFileRejected) return apiErrorJson(e.code, 400, { field: 'file' })
      throw e
    }

    const filePath = buildObjectKey('payments', id, 'bukti', `${randomUUID().slice(0, 8)}.${prepared.ext}`)
    await uploadBuffer(filePath, prepared.body, prepared.mimeType)

    // Kunci baris booking: dua unggahan serentak tak boleh sama-sama lolos; tagihan dan terbayar dibaca ULANG di dalam kunci.
    const result = await prisma.$transaction(async (tx): Promise<'closed' | ClaimRefusal | null> => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
      const fresh = await tx.booking.findUniqueOrThrow({
        where: { id },
        select: {
          status: true, totalAmount: true,
          invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } },
          payments: { where: { status: { in: ['pending', 'confirmed', 'awaiting'] } }, select: { status: true, amount: true } },
          refunds: billRefunds,
        },
      })
      if (fresh.status !== 'active') return 'closed'
      if (fresh.payments.some(p => p.status === 'pending' || p.status === 'awaiting')) return 'closed'
      const refused = claimRefusal(paymentLimits(billOf(fresh), minimumFirstPaymentPercent), input.amount)
      if (refused) return refused
      // Fase 7b-1: rekening tujuan → akun kas (null bila rekening sudah dihapus; admin memilih saat verifikasi). Fase 8: QRIS → akun kas QRIS (null bila QRIS dinonaktifkan sementara itu).
      const destinationCashAccountId = dest ? await cashAccountForSnapshot(tx, dest) : await ensureQrisCashAccount(tx, destQris!.id, { requireActive: true })
      await tx.payment.create({
        data: {
          bookingId:               id,
          amount:                  0, // jumlah terverifikasi diisi admin
          claimedAmountIdr:        input.amount,
          transferredAt:           input.transferredAt,
          senderBank:              input.senderBank,
          senderAccountName:       input.senderAccountName,
          destinationLabel,
          destinationCashAccountId,
          payerNote:               input.note ?? null,
          method:                  destQris ? 'qris' : 'bank_transfer',
          status:                  'pending',
          buktiTransferPath:       filePath,
          buktiTransferUploadedAt: new Date(),
        },
        select: { id: true },
      })
      return null
    }).catch(async (e: unknown) => { await discardUpload(filePath); throw e })
    if (result !== null) {
      await discardUpload(filePath) // ditolak di dalam kunci: jangan tinggalkan berkas yatim di MinIO (SEC-122)
      if (result === 'closed') return apiErrorJson('bookingCannotTakeProof', 422)
      if (result.code === 'paymentAmountBelowMin') return apiErrorJson(result.code, 422, { field: 'amount', params: { min: formatRupiah(result.min) } })
      if (result.code === 'paymentAmountAboveBalance') return apiErrorJson(result.code, 422, { field: 'amount', params: { max: formatRupiah(result.max) } })
      return apiErrorJson(result.code, 422)
    }

    return NextResponse.json(ok({ uploaded: true })) // kunci objek internal tidak dikirim ke klien
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return apiErrorJson('unauthorized', 401)
    }
    logError('bookings/id/payment/bukti', error)
    return apiErrorJson('internal', 500)
  }
}

async function discardUpload(objectKey: string): Promise<void> {
  await deleteObject(objectKey).catch((e: unknown) => logError('bookings/id/payment/bukti gagal membuang berkas yatim', e))
}
