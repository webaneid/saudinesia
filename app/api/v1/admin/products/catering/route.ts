import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try { await requireManager(); return NextResponse.json(ok(await prisma.cateringOption.findMany())) }
  catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}

export async function POST(req: Request) {
  try {
    await requireManager(); const b = await req.json()
    const c = await prisma.cateringOption.create({ data: { name: b.name, boardType: b.boardType, menuStyle: b.menuStyle, pricePerPersonRegular: +b.pricePerPersonRegular, pricePerPersonRamadan: +b.pricePerPersonRamadan, pricePerPersonHajj: +b.pricePerPersonHajj } })
    return NextResponse.json(ok(c), { status: 201 })
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}
