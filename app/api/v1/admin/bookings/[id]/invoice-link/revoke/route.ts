import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { revokeInvoiceLink } from '@/lib/invoice/issue'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Cabut tautan invoice publik: versi tautan +1 (semua tautan lama mati; tautan baru langsung berlaku). Isi invoice tak berubah — bukan revisi.
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const { id } = await params
    const r = await revokeInvoiceLink(id)
    if (!r) return NextResponse.json(err('Invoice tidak ditemukan'), { status: 404 })
    console.info(`[invoice-link] tautan booking ${id} dicabut oleh ${session.userId} (versi ${r.linkVersion})`) // tanpa token
    return NextResponse.json(ok(r))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/invoice-link/revoke')
  }
}
