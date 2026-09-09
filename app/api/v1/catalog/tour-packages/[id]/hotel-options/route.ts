import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'

type Ctx = { params: Promise<{ id: string }> }

// Publik, tanpa auth — cuma expose hotelOptions (harga pass-through, sama pola catalog/transport
// menampilkan vehiclePrice). TIDAK proxy seluruh breakdown (components punya vendorId/HPP
// internal yang tidak untuk publik) — docs/arsitektur-ziarah.md §12.8.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const breakdown = await computeTourPackageBreakdown(id)
    return NextResponse.json(ok(breakdown.hotelOptions))
  } catch (error) {
    console.error('[catalog/tour-packages/[id]/hotel-options]', error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
