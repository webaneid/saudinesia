import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { customerPolicySchema } from '@/lib/validators/customers'
import { requireCustomerManage } from '@/lib/customers/policy'
import { setCustomerBookingPolicy } from '@/lib/customers/bookingPolicy'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Kebijakan pemesanan pelanggan — saat ini hanya "boleh pesan visa tanpa pesawat dan hotel" (D5). Semua peran admin (D16, lib/customers/policy.ts).
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const { id } = await params
    const parsed = customerPolicySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await setCustomerBookingPolicy(id, parsed.data, session.userId)
    if (!r.ok) return NextResponse.json(err(r.message), { status: r.status })
    return NextResponse.json(ok({ allowVisaWithoutBundle: parsed.data.allowVisaWithoutBundle, changed: r.changed }))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/policy/PATCH')
  }
}
