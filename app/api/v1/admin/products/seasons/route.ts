import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try { await requireManager(); return NextResponse.json(ok(await prisma.season.findMany({ orderBy: { startDate: 'asc' } }))) }
  catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}

export async function POST(req: Request) {
  try {
    await requireManager()
    const b = await req.json()
    const s = await prisma.season.create({ data: { name: b.name, startDate: new Date(b.startDate), endDate: new Date(b.endDate) } })
    return NextResponse.json(ok(s), { status: 201 })
  } catch { return NextResponse.json(err('Forbidden'), { status: 403 }) }
}
