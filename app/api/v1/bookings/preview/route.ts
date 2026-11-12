import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { onboardingRefusal } from '@/lib/auth/contact'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { bookingFailure, bookingFailureJson, simulateBooking } from '@/lib/booking/simulate'
import { cartDateRefusal } from '@/lib/checkout/dates'
import { cartInput, checkoutCartSchema } from '@/lib/validators/checkout'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'
import { InvoiceError } from '@/lib/invoice/issue'

// Pratinjau harga checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5): mesin pesan yang SAMA dengan `POST /bookings`, dijalankan di transaksi yang selalu
// di-rollback — tak ada booking, kuota, snapshot, atau nomor invoice yang tersimpan. Respons = harga JUAL saja (baris invoice, pajak, total, jatuh tempo).
export async function POST(request: Request) {
  try {
    const session = await requireSession()
    if (session.role !== 'pilgrim') return apiErrorJson('staffUseAdminForm', 403)
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const limit = await consume(policy('bookingPreviewUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const parsed = checkoutCartSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)
    const pastDate = await cartDateRefusal(parsed.data)
    if (pastDate) return pastDate

    const { defaultDueDays } = await getInvoiceSettings()
    try {
      const p = await simulateBooking({ userId: session.userId }, cartInput(parsed.data), defaultDueDays)
      return NextResponse.json(ok({ lines: p.lines, total: p.total, tax: p.tax, taxAdded: p.taxAdded, grandTotal: p.grandTotal, dueDays: p.dueDays }))
    } catch (e) {
      if (e instanceof InvoiceError) { // setelan invoice bermasalah = urusan admin; rinciannya hanya di log (sama dengan POST /bookings)
        console.error('[bookings/preview] invoice', e.message)
        return apiErrorJson('orderNotIssuable', 422)
      }
      return bookingFailureJson(bookingFailure(e)) // galat tak dikenal dilempar ulang → 500 di bawah
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    console.error('[bookings/preview]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
