import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { releaseWhatsappVerification } from '@/lib/auth/whatsappVerify'
import { visibleStaffWhere } from '@/lib/auth/adminUsers'
import { prisma } from '@/lib/db'
import { auditIp, recordStaffEvent } from '@/lib/audit/staff'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'

// SEC-43: superadmin melepas verifikasi nomor WhatsApp satu akun (nomor daur ulang / disalahgunakan / permintaan bantuan).
// Nomor kontak tetap tersimpan; akun hanya berhenti menerima WhatsApp sampai dibuktikan lagi. Tanpa body.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await params
    const exists = await prisma.user.findFirst({ where: { id, ...visibleStaffWhere(session) }, select: { id: true } })
    if (!exists) return NextResponse.json(err('Pengguna tidak ditemukan'), { status: 404 })

    const result = await releaseWhatsappVerification({ userId: id })
    // Jejak staf (SEC-304) tanpa PII (tanpa email/nomor): pelaku, target, hasil.
    await recordStaffEvent(prisma, { action: 'staff_whatsapp_release', actorId: session.userId, targetUserId: id, ip: auditIp(req), summary: { released: result.released } })
    return NextResponse.json(ok({ released: result.released }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/users/[id]/whatsapp/DELETE')
  }
}
