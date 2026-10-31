import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { BOOKING_MODULES, bookingCatalog } from '@/lib/booking/catalog'
import { authFailureResponse } from '@/lib/admin/errors'

const querySchema = z.object({ module: z.enum(BOOKING_MODULES) })

// Pilihan produk per modul untuk popup "Tambah produk" di form booking admin (lib/booking/catalog.ts). Harga jual saja.
export async function GET(req: Request) {
  try {
    await requireBookingManage()
    const parsed = querySchema.safeParse({ module: new URL(req.url).searchParams.get('module') })
    if (!parsed.success) return NextResponse.json(err('Modul tidak dikenal'), { status: 400 })
    return NextResponse.json(ok(await bookingCatalog(parsed.data.module)))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/catalog/GET')
  }
}
