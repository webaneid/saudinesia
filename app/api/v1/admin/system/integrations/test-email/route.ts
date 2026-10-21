import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { ok, err } from '@/lib/validators'
import { sendEmail } from '@/lib/email/resend'
import { emailContent } from '@/lib/email/templates'

const bodySchema = z.object({ to: z.string().trim().email('Format email tidak valid').max(254).optional() })

// Kirim email uji lewat Resend — untuk memastikan kunci API + domain pengirim benar setelah deploy.
// Hanya superadmin, dibatasi 5/jam per admin, dan hasilnya JUJUR (sent | failed | skipped) — tidak pernah pura-pura sukses.
export async function POST(req: Request) {
  try {
    const session = await requireSuperAdmin()

    const rl = await consume(policy('emailTestUser', session.userId))
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec)

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    // Tanpa `to` → kirim ke email akun admin sendiri (kasus normal; tidak bisa dipakai mengirim ke pihak lain tanpa sengaja).
    const admin = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true, fullName: true } })
    const to = parsed.data.to ?? admin?.email
    if (!to) return NextResponse.json(err('Alamat tujuan tidak tersedia'), { status: 400 })

    const content = emailContent({ type: 'test' }, { name: admin?.fullName ?? '' })
    const result = await sendEmail({ to, subject: content.subject, html: content.html, text: content.text, idempotencyKey: randomUUID() })

    return NextResponse.json(ok({ status: result.status, detail: result.status === 'skipped' ? result.reason : result.status === 'failed' ? result.error : null, to }))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/integrations/test-email]', e instanceof Error ? e.message : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
