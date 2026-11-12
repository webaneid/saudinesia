import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession, ADMIN_ROLES } from '@/lib/auth/session'
import { invoiceBookingInclude, buildInvoiceData } from '@/lib/pdf/invoiceData'
import { generateInvoicePdf } from '@/lib/pdf/invoice'
import { loadInvoiceLogo } from '@/lib/pdf/logo'
import { apiErrorJson } from '@/lib/errors/api'

type Params = { params: Promise<{ id: string }> }

// docs/arsitektur-booking.md §6 Step 7 — GET mengembalikan PDF langsung (bukan JSON), dipanggil
// dari tombol "Unduh Invoice" (link biasa, browser handle download). Auth: pilgrim cuma booking
// sendiri, admin bebas — pola sama persis pilgrims/[bookingId]/[pilgrimId]/documents/route.ts.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params

  const session = await getSession()
  if (!session) return apiErrorJson('unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: invoiceBookingInclude,
  })
  if (!booking) return apiErrorJson('bookingNotFound', 404)

  const isAdmin = ADMIN_ROLES.includes(session.role)
  // Booking akun lain = 404 seragam (bukan 401) — tidak membuka keberadaan booking.
  if (!isAdmin && booking.userId !== session.userId) return apiErrorJson('bookingNotFound', 404)
  if (!isAdmin && booking.status === 'draft') return apiErrorJson('bookingNotFound', 404) // draf belum diterbitkan

  try {
    const data = await buildInvoiceData(booking)
    const pdfBuffer = await generateInvoicePdf(data, await loadInvoiceLogo())

    return new NextResponse(new Blob([Uint8Array.from(pdfBuffer)]), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Cache-Control':       'private, no-store', // dokumen berisi data pribadi (SEC-80)
        'Content-Disposition': `inline; filename="${data.invoiceNumber}.pdf"`,
      },
    })
  } catch (error) {
    // Invoice tidak boleh terbit bila Σ snapshot ≠ total (invarian I4) — dicatat, klien hanya menerima 500 generik.
    console.error('[bookings/invoice]', error instanceof Error ? error.message : error)
    return apiErrorJson('internal', 500)
  }
}
