import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

// Dipoll halaman profil selama menunggu pengguna mengirim pesan verifikasi.
export async function GET() {
  try {
    const session = await requireSession()
    const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true } })
    if (!u) return NextResponse.json(err('Akun tidak ditemukan.'), { status: 404 })
    return NextResponse.json(ok({ hasNumber: Boolean(u.whatsapp), verified: Boolean(u.whatsappVerifiedAt && u.verifiedWhatsapp === u.whatsapp) }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    console.error('[auth/whatsapp/status]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
