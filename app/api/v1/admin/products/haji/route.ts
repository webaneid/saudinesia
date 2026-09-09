import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try {
    await requireManager()
    return NextResponse.json(ok(await prisma.hajiProduct.findMany({ orderBy: { year: 'asc' } })))
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const b = await req.json()
    const p = await prisma.hajiProduct.create({ data: {
      name: b.name, hajiType: b.hajiType, year: +b.year,
      description: b.description || null,
      departureDate: b.departureDate ? new Date(b.departureDate) : null,
      returnDate: b.returnDate ? new Date(b.returnDate) : null,
      durationDays: b.durationDays ? +b.durationDays : null,
      includes: b.includes ?? [],
      price: +b.price, priceLabel: 'per orang',
      totalQuota: +b.totalQuota, images: [],
    }})
    return NextResponse.json(ok(p), { status: 201 })
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}
