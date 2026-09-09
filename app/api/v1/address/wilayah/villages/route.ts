import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Publik, tanpa auth — rata-rata ~11-12 desa/kelurahan per kecamatan (83.762/7.285), tapi
// beberapa kecamatan bisa jauh lebih banyak — dukung filter teks `q` (server-side) untuk kasus
// itu, di luar rata-rata. docs/arsitektur-alamat.md.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const districtId = searchParams.get('districtId')
    const q = searchParams.get('q')
    if (!districtId) return NextResponse.json(err('districtId wajib diisi'), { status: 400 })

    const villages = await prisma.addressVillage.findMany({
      where: { districtId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      take: 200, // batas wajar — kombinasi dengan `q` untuk kecamatan yang py banyak desa
    })
    return NextResponse.json(ok(villages))
  } catch (e) {
    console.error('[address/wilayah/villages/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
