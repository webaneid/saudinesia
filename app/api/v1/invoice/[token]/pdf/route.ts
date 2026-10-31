import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { clientIp, tooManyRequests } from '@/lib/auth/rateLimit'
import { loadPublicInvoice } from '@/lib/invoice/publicView'
import { generateInvoicePdf } from '@/lib/pdf/invoice'
import { loadInvoiceLogo } from '@/lib/pdf/logo'

type Ctx = { params: Promise<{ token: string }> }

// PDF invoice PUBLIK (tanpa login; tautan bertoken, docs/arsitektur-booking-engine-v2.md §10.4 6c). Tautan salah/dicabut → 404 seragam. Header no-store/noindex: next.config.ts.
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params
  try {
    const r = await loadPublicInvoice(token, clientIp(req))
    if (r.kind === 'limited') return tooManyRequests(r.retryAfterSec)
    if (r.kind === 'not_found') return NextResponse.json(err('Invoice tidak ditemukan'), { status: 404 })
    const pdf = await generateInvoicePdf(r.data, await loadInvoiceLogo())
    return new NextResponse(new Blob([Uint8Array.from(pdf)]), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.data.invoiceNumber}.pdf"` },
    })
  } catch (e) {
    console.error('[invoice/public/pdf]', e instanceof Error ? e.name : 'unknown') // tanpa token & tanpa data pribadi
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
