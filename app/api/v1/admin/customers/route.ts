import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { customerCreateSchema } from '@/lib/validators/customers'
import { requireCustomerManage } from '@/lib/customers/policy'
import { createCustomer, inviteCustomer, type InviteStatus } from '@/lib/customers/create'
import { isDeletedAccount, listCustomers } from '@/lib/customers/query'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'

const searchSchema = z.object({ q: z.string().trim().max(100).default('') })

// Cari pelanggan untuk pemilih (form booking admin, §10.3): 10 teratas, hanya id/nama/email. Daftar lengkap ada di halaman Pelanggan (server component).
export async function GET(req: Request) {
  try {
    await requireCustomerManage()
    const parsed = searchSchema.safeParse({ q: new URL(req.url).searchParams.get('q') ?? undefined })
    if (!parsed.success) return NextResponse.json(err('Pencarian tidak valid'), { status: 400 })
    const { items } = await listCustomers({ q: parsed.data.q }, { page: 1, limit: 10, skip: 0 })
    return NextResponse.json(ok(items.filter(c => !isDeletedAccount(c.email)).map(c => ({ id: c.id, fullName: c.fullName, email: c.email }))))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/GET')
  }
}

// Tambah pelanggan (docs/arsitektur-pelanggan.md §6). Akun lahir belum diaktifkan; undangan "buat password" dikirim bila diminta.
export async function POST(req: Request) {
  try {
    const session = await requireCustomerManage()
    const limit = await consume(policy('customerCreateAdmin', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const parsed = customerCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const created = await createCustomer(parsed.data)
    if (!created.ok) return NextResponse.json(err(created.message), { status: created.status })
    console.info(`[admin/customers] dibuat actor=${session.userId} customer=${created.id} invite=${parsed.data.sendInvite}`) // tanpa email/nama (PII)

    let invite: InviteStatus = 'none'
    if (parsed.data.sendInvite) {
      // Akun SUDAH dibuat; batas laju hanya menunda undangannya (kirim ulang dari detail pelanggan).
      const byAdmin = await consume(policy('customerInviteAdmin', session.userId))
      const byEmail = byAdmin.allowed ? await consume(policy('authEmailSendEmail', created.email)) : byAdmin
      if (!byEmail.allowed) invite = 'skipped'
      else { const r = await inviteCustomer(created.id); invite = r.ok ? r.status : 'failed' }
    }
    return NextResponse.json(ok({ id: created.id, invite }), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/POST')
  }
}
