import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Dipakai healthcheck Docker/deploy. Tanpa auth & tanpa data apa pun selain status — hanya memastikan
// proses hidup DAN database terjangkau. Jangan menambah detail (versi, host, dsb.) ke response.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.user.findFirst({ select: { id: true } })
    return NextResponse.json(ok({ status: 'ok' }))
  } catch {
    return NextResponse.json(err('Service unavailable'), { status: 503 })
  }
}
