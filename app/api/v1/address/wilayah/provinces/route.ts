import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Publik, tanpa auth — data referensi wilayah (docs/arsitektur-alamat.md), sama pola catalog publik.
// Cuma 38 baris — dikembalikan semua sekaligus, filter/cari dilakukan di sisi client (combobox).
export async function GET() {
  try {
    const provinces = await prisma.addressProvince.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json(ok(provinces))
  } catch (e) {
    console.error('[address/wilayah/provinces/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
