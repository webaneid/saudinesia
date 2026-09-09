import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Publik, tanpa auth — rata-rata ~14 kecamatan per kab/kota (7.285/514). docs/arsitektur-alamat.md.
export async function GET(req: Request) {
  try {
    const regencyId = new URL(req.url).searchParams.get('regencyId')
    if (!regencyId) return NextResponse.json(err('regencyId wajib diisi'), { status: 400 })

    const districts = await prisma.addressDistrict.findMany({
      where: { regencyId },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(ok(districts))
  } catch (e) {
    console.error('[address/wilayah/districts/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
