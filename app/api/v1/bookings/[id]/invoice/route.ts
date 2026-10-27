import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, ADMIN_ROLES } from '@/lib/auth/session'
import { invoiceBookingInclude, buildInvoiceData } from '@/lib/pdf/invoiceData'
import { generateInvoicePdf } from '@/lib/pdf/invoice'
import { err } from '@/lib/validators'

type Params = { params: Promise<{ id: string }> }

// docs/arsitektur-booking.md §6 Step 7 — GET mengembalikan PDF langsung (bukan JSON), dipanggil
// dari tombol "Unduh Invoice" (link biasa, browser handle download). Auth: pilgrim cuma booking
// sendiri, admin bebas — pola sama persis pilgrims/[bookingId]/[pilgrimId]/documents/route.ts.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params

  const session = await getSession()
  if (!session) return NextResponse.json(err('Unauthorized'), { status: 401 })

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: invoiceBookingInclude,
  })
  if (!booking) return NextResponse.json(err('Booking tidak ditemukan'), { status: 404 })

  const isAdmin = ADMIN_ROLES.includes(session.role)
  if (!isAdmin && booking.userId !== session.userId) {
    return NextResponse.json(err('Unauthorized'), { status: 401 })
  }

  try {
    const data = await buildInvoiceData(booking)
    const pdfBuffer = await generateInvoicePdf(data)

    return new NextResponse(new Blob([Uint8Array.from(pdfBuffer)]), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${data.invoiceNumber}.pdf"`,
      },
    })
  } catch (error) {
    // Invoice tidak boleh terbit bila Σ snapshot ≠ total (invarian I4) — dicatat, klien hanya menerima 500 generik.
    console.error('[bookings/invoice]', error instanceof Error ? error.message : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
