import { NextResponse } from 'next/server'
import { previewRegistration } from '@/lib/auth/accounts'
import { clientIp, consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { tokenOnlySchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'

// Halaman tautan pendaftaran memanggil ini untuk menampilkan isian. Hanya membaca — TIDAK mengonsumsi token
// (pemindai tautan email meng-GET halaman; konsumsi hanya lewat POST dari tombol).
export async function POST(request: Request) {
  try {
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('authTokenIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }
    const parsed = tokenOnlySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err('Tautan tidak valid atau sudah kedaluwarsa.'), { status: 400 })

    const preview = await previewRegistration(parsed.data.token)
    if (!preview) return NextResponse.json(err('Tautan tidak valid atau sudah kedaluwarsa.'), { status: 404 })
    return NextResponse.json(ok(preview))
  } catch (error) {
    console.error('[auth/registration/preview]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
