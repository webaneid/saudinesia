import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy } from '@/lib/auth/rateLimit'
import { DocumentFileRejected, prepareDocumentFile } from '@/lib/documents/file'
import { docIpLimited, readSingleFile } from '@/lib/documents/http'
import { buildObjectKey, deleteObject, uploadBuffer } from '@/lib/storage/minio'

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
      select: { id: true, status: true, confirmedAt: true },
    })
    if (!booking) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })
    if (booking.status !== 'active' || booking.confirmedAt !== null) {
      return NextResponse.json(err('Booking tidak dalam status menunggu pembayaran'), { status: 422 })
    }

    // Satu bukti menunggu verifikasi pada satu waktu (perilaku v1: dulu dijaga status `payment_review`, kini diturunkan dari adanya payment `pending`).
    if (await prisma.payment.count({ where: { bookingId: id, status: 'pending' } }) > 0) {
      return NextResponse.json(err('Bukti pembayaran sebelumnya masih menunggu verifikasi'), { status: 422 })
    }

    // Per akun, di atas batas per IP: unggahan gambar memicu pemrosesan sharp dan penulisan ke MinIO.
    const perAccount = await consume(policy('pilgrimDocUser', session.userId))
    if (!perAccount.allowed) {
      const res = NextResponse.json(err('Terlalu banyak unggahan. Coba lagi nanti.'), { status: 429 })
      res.headers.set('Retry-After', String(perAccount.retryAfterSec))
      return res
    }

    const raw = await readSingleFile(request)
    if (raw instanceof NextResponse) return raw

    // Jenis ditentukan dari ISI berkas, bukan MIME/nama dari klien; gambar dienkode ulang (EXIF/GPS dibuang). Nama asli tidak dipakai di kunci objek.
    let prepared: Awaited<ReturnType<typeof prepareDocumentFile>>
    try {
      prepared = await prepareDocumentFile(raw)
    } catch (e) {
      if (e instanceof DocumentFileRejected) return NextResponse.json(err(e.message), { status: 400 })
      throw e
    }

    const filePath = buildObjectKey('payments', id, 'bukti', `${randomUUID().slice(0, 8)}.${prepared.ext}`)
    await uploadBuffer(filePath, prepared.body, prepared.mimeType)

    // Kunci baris booking: dua unggahan serentak tak boleh sama-sama lolos pemeriksaan "tak ada bukti menunggu" di atas.
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
      const fresh = await tx.booking.findUniqueOrThrow({ where: { id }, select: { status: true, confirmedAt: true } })
      if (fresh.status !== 'active' || fresh.confirmedAt !== null) return false
      if (await tx.payment.count({ where: { bookingId: id, status: 'pending' } }) > 0) return false
      await tx.payment.create({
        data: {
          bookingId:               id,
          amount:                  0, // admin will verify actual amount
          method:                  'bank_transfer',
          status:                  'pending',
          buktiTransferPath:       filePath,
          buktiTransferUploadedAt: new Date(),
        },
      })
      return true
    }).catch(async (e: unknown) => { await discardUpload(filePath); throw e })
    if (!created) {
      await discardUpload(filePath) // ditolak di dalam kunci: jangan tinggalkan berkas yatim di MinIO (SEC-122)
      return NextResponse.json(err('Booking tidak dapat menerima bukti pembayaran saat ini'), { status: 422 })
    }

    return NextResponse.json(ok({ uploaded: true })) // kunci objek internal tidak dikirim ke klien
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/id/payment/bukti]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

async function discardUpload(objectKey: string): Promise<void> {
  await deleteObject(objectKey).catch((e: unknown) => console.error('[bookings/id/payment/bukti] gagal membuang berkas yatim', e instanceof Error ? e.message : String(e)))
}
