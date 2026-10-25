import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Dipakai healthcheck Docker/deploy. Tanpa auth & tanpa data apa pun selain status — hanya memastikan
// proses hidup DAN database terjangkau. Jangan menambah detail (versi, host, dsb.) ke response.
export const dynamic = 'force-dynamic'

// Endpoint publik: tanpa cache, siapa pun bisa memicu satu query DB per permintaan. Hasil SEHAT disimpan singkat dan permintaan
// bersamaan berbagi satu pengecekan (SEC-50). Kegagalan TIDAK di-cache — pemulihan DB terdeteksi di permintaan berikutnya.
const OK_TTL_MS = 5_000
let okUntil = 0
let inflight: Promise<void> | null = null

async function checkDatabase(): Promise<void> {
  if (Date.now() < okUntil) return
  inflight ??= prisma.user.findFirst({ select: { id: true } })
    .then(() => { okUntil = Date.now() + OK_TTL_MS })
    .finally(() => { inflight = null })
  await inflight
}

export async function GET() {
  try {
    await checkDatabase()
    return NextResponse.json(ok({ status: 'ok' }))
  } catch {
    return NextResponse.json(err('Service unavailable'), { status: 503 })
  }
}
