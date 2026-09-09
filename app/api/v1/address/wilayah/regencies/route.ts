import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Publik, tanpa auth — rata-rata ~14 kab/kota per provinsi (514/38), dikembalikan semua
// sekaligus per provinceId, filter/cari di sisi client (combobox). docs/arsitektur-alamat.md.
export async function GET(req: Request) {
  try {
    const provinceId = new URL(req.url).searchParams.get('provinceId')
    if (!provinceId) return NextResponse.json(err('provinceId wajib diisi'), { status: 400 })

    const regencies = await prisma.addressRegency.findMany({
      where: { provinceId },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(ok(regencies))
  } catch (e) {
    console.error('[address/wilayah/regencies/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
