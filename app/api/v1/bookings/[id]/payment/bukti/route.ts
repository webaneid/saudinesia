import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
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

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json(err('File tidak ditemukan'), { status: 400 })

    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(err('Format file tidak didukung. Gunakan JPG, PNG, atau PDF.'), { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(err('Ukuran file maksimal 5 MB.'), { status: 400 })
    }

    let filePath = `payments/${id}/${Date.now()}-${file.name}`
    let uploaded = false

    // In production: upload to MinIO
    // In dev: skip MinIO, just record the filename
    if (process.env.NODE_ENV === 'production') {
      const { uploadBuffer, buildObjectKey, BUCKET } = await import('@/lib/storage/minio')
      const buffer = Buffer.from(await file.arrayBuffer())
      filePath = buildObjectKey('payments', id, 'bukti', file.name)
      await uploadBuffer(filePath, buffer, file.type)
      uploaded = true
    } else {
      console.log(`[DEV] Bukti transfer: ${file.name} (${(file.size / 1024).toFixed(1)} KB) — skip MinIO`)
    }

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
    }).catch(async (e: unknown) => { await discardUpload(uploaded, filePath); throw e })
    if (!created) {
      await discardUpload(uploaded, filePath) // ditolak di dalam kunci: jangan tinggalkan berkas yatim di MinIO (SEC-122)
      return NextResponse.json(err('Booking tidak dapat menerima bukti pembayaran saat ini'), { status: 422 })
    }

    return NextResponse.json(ok({ filePath }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/id/payment/bukti]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

async function discardUpload(uploaded: boolean, objectKey: string): Promise<void> {
  if (!uploaded) return
  const { deleteObject } = await import('@/lib/storage/minio')
  await deleteObject(objectKey).catch((e: unknown) => console.error('[bookings/id/payment/bukti] gagal membuang berkas yatim', e instanceof Error ? e.message : String(e)))
}
