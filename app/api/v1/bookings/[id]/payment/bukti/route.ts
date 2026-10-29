import { NextResponse } from 'next/server'
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
      where: { id, userId: session.userId },
      select: { id: true, status: true },
    })
    if (!booking) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })
    if (booking.status !== 'awaiting_payment') {
      return NextResponse.json(err('Booking tidak dalam status menunggu pembayaran'), { status: 422 })
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

    // In production: upload to MinIO
    // In dev: skip MinIO, just record the filename
    if (process.env.NODE_ENV === 'production') {
      const { uploadBuffer, buildObjectKey, BUCKET } = await import('@/lib/storage/minio')
      const buffer = Buffer.from(await file.arrayBuffer())
      filePath = buildObjectKey('payments', id, 'bukti', file.name)
      await uploadBuffer(filePath, buffer, file.type)
    } else {
      console.log(`[DEV] Bukti transfer: ${file.name} (${(file.size / 1024).toFixed(1)} KB) — skip MinIO`)
    }

    await prisma.payment.create({
      data: {
        bookingId:               id,
        amount:                  0, // admin will verify actual amount
        method:                  'bank_transfer',
        status:                  'pending',
        buktiTransferPath:       filePath,
        buktiTransferUploadedAt: new Date(),
      },
    })

    await prisma.booking.update({ where: { id }, data: { status: 'payment_review' } })

    return NextResponse.json(ok({ filePath }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[bookings/id/payment/bukti]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
