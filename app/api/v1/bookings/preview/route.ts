import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { bookingFailure, simulateBooking } from '@/lib/booking/simulate'
import { checkoutDateRefusal } from '@/lib/checkout/dates'
import { checkoutInput, checkoutSchema } from '@/lib/validators/checkout'
import { ok, err } from '@/lib/validators'
import { InvoiceError } from '@/lib/invoice/issue'

// Pratinjau harga checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5): mesin pesan yang SAMA dengan `POST /bookings`, dijalankan di transaksi yang selalu
// di-rollback — tak ada booking, kuota, snapshot, atau nomor invoice yang tersimpan. Respons = harga JUAL saja (baris invoice, pajak, total, jatuh tempo).
export async function POST(request: Request) {
  try {
    const session = await requireSession()
    if (session.role !== 'pilgrim') return NextResponse.json(err('Akun staf memesan lewat form booking admin'), { status: 403 })
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const limit = await consume(policy('bookingPreviewUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const parsed = checkoutSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const pastDate = await checkoutDateRefusal(parsed.data)
    if (pastDate) return pastDate

    const { defaultDueDays } = await getInvoiceSettings()
    try {
      const p = await simulateBooking({ userId: session.userId }, checkoutInput(parsed.data), defaultDueDays)
      return NextResponse.json(ok({ lines: p.lines, total: p.total, tax: p.tax, taxAdded: p.taxAdded, grandTotal: p.grandTotal, dueDays: p.dueDays }))
    } catch (e) {
      if (e instanceof InvoiceError) { // setelan invoice bermasalah = urusan admin; rinciannya hanya di log (sama dengan POST /bookings)
        console.error('[bookings/preview] invoice', e.message)
        return NextResponse.json(err('Pesanan belum dapat diterbitkan — silakan hubungi admin'), { status: 422 })
      }
      const f = bookingFailure(e) // galat tak dikenal dilempar ulang → 500 di bawah
      return NextResponse.json({ success: false, error: f.message, ...(f.violations ? { meta: { violations: f.violations } } : {}) }, { status: f.status })
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    console.error('[bookings/preview]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
