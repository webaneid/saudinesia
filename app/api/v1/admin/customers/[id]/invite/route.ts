import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { requireCustomerManage } from '@/lib/customers/policy'
import { findInvitable, sendInvitation } from '@/lib/customers/create'
import { authFailureResponse } from '@/lib/admin/errors'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'

type Ctx = { params: Promise<{ id: string }> }

// Kirim ulang undangan aktivasi (hanya akun yang belum diaktifkan pemiliknya).
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const { id } = await params
    const byAdmin = await consume(policy('customerInviteAdmin', session.userId))
    if (!byAdmin.allowed) return tooManyRequests(byAdmin.retryAfterSec)
    // Kelayakan DULU (permintaan yang akan ditolak tak boleh menghabiskan kuota email milik pemilik akun), baru batas per alamat, baru kirim.
    const found = await findInvitable(id)
    if (!found.ok) return NextResponse.json(err(found.message), { status: found.status })
    const byEmail = await consume(policy('authEmailSendEmail', found.user.email))
    if (!byEmail.allowed) return tooManyRequests(byEmail.retryAfterSec)

    const invite = await sendInvitation(found.user)
    return NextResponse.json(ok({ invite }))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/invite/POST')
  }
}
