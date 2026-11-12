import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'

// Publik, tanpa auth — rata-rata ~14 kecamatan per kab/kota (7.285/514). docs/arsitektur-alamat.md.
export async function GET(req: Request) {
  try {
    const regencyId = new URL(req.url).searchParams.get('regencyId')
    if (!regencyId) return apiErrorJson('regionParentRequired', 400)

    const districts = await prisma.addressDistrict.findMany({
      where: { regencyId },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(ok(districts))
  } catch (e) {
    console.error('[address/wilayah/districts/GET]', e)
    return apiErrorJson('internal', 500)
  }
}
