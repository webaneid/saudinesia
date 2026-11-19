import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { logError } from '@/lib/log'

// Dipoll halaman profil selama menunggu pengguna mengirim pesan verifikasi.
export async function GET() {
  try {
    const session = await requireSession()
    const u = await prisma.user.findUnique({ where: { id: session.userId }, select: { whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true } })
    if (!u) return apiErrorJson('accountNotFound', 404)
    return NextResponse.json(ok({ hasNumber: Boolean(u.whatsapp), verified: Boolean(u.whatsappVerifiedAt && u.verifiedWhatsapp === u.whatsapp) }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    logError('auth/whatsapp/status', error)
    return apiErrorJson('internal', 500)
  }
}
