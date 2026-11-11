import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/auth/session'
import { ok } from '@/lib/validators'
import { safeLocale } from '@/lib/utils/locale'

// Dua pemanggil: `fetch` dari dasbor admin (JSON) dan formulir "Keluar" di area jamaah (kiriman form biasa). Kiriman form dulu mendarat di
// halaman JSON mentah — kini dialihkan 303 ke halaman masuk dalam bahasa yang dikirim (audit front-end 2026-11-11). Locale lewat daftar putih
// (`safeLocale`), tujuan selalu path relatif tetap — tak ada pengalihan ke alamat luar.
export async function POST(req: Request) {
  await clearSession()
  const type = req.headers.get('content-type') ?? ''
  if (type.startsWith('application/x-www-form-urlencoded')) {
    // Teks biasa, bukan formData(): route ini bukan unggahan (batas 1 MB Caddy berlaku; scripts/test-body-limit.ts).
    const form = new URLSearchParams(await req.text().catch(() => ''))
    const locale = safeLocale(form.get('locale') ?? '')
    // Location relatif: di belakang proxy `req.url` bisa memuat host internal kontainer.
    return new NextResponse(null, { status: 303, headers: { Location: `/${locale}/login` } })
  }
  return NextResponse.json(ok(null))
}
