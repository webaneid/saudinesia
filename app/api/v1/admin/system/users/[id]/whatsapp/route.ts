import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { releaseWhatsappVerification } from '@/lib/auth/whatsappVerify'
import { prisma } from '@/lib/db'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'

// SEC-43: superadmin melepas verifikasi nomor WhatsApp satu akun (nomor daur ulang / disalahgunakan / permintaan bantuan).
// Nomor kontak tetap tersimpan; akun hanya berhenti menerima WhatsApp sampai dibuktikan lagi. Tanpa body.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await params
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return NextResponse.json(err('Pengguna tidak ditemukan'), { status: 404 })

    const result = await releaseWhatsappVerification({ userId: id })
    // Jejak audit tanpa PII (tanpa email/nomor): id pelaku, id target, hasil.
    console.info(`[admin/release-whatsapp] actor=${session.userId} target=${id} released=${result.released}`)
    return NextResponse.json(ok({ released: result.released }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/users/[id]/whatsapp/DELETE')
  }
}
