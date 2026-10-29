import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { addressSchema } from '@/lib/validators/address'
import { prepareAddressData } from '@/lib/address/prepare'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { onboardingRefusal } from '@/lib/auth/contact'

// docs/arsitektur-alamat.md §3.1 — Address adalah entitas nilai reusable, siapa pun yang login
// boleh membuat baris baru (dipakai pilgrim mengisi manifest, bukan cuma admin).
export async function POST(req: Request) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const limit = await consume(policy('addressCreateUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)
    const parsed = addressSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const prepared = await prepareAddressData(parsed.data)
    if (!prepared.ok) return NextResponse.json(err(prepared.message), { status: 400 })

    const address = await prisma.address.create({ data: prepared.data })
    return NextResponse.json(ok(address), { status: 201 })
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    console.error('[address/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
