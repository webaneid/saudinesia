import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { onboardingRefusal } from '@/lib/auth/contact'
import { ok } from '@/lib/validators'
import { addressSchema } from '@/lib/validators/address'
import { prepareAddressData } from '@/lib/address/prepare'
import { getCountryName } from '@/lib/constants/countries'
import { canAccessAddress } from '@/lib/address/access'
import { isRecordNotFound } from '@/lib/admin/errors'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireSession()
    const { id } = await params
    if (!(await canAccessAddress(session, id))) return apiErrorJson('addressNotFound', 404)
    const address = await prisma.address.findUnique({
      where: { id },
      include: { province: true, regency: true, district: true, village: true },
    })
    if (!address) return apiErrorJson('addressNotFound', 404)

    const countryName = address.countryCode ? getCountryName(address.countryCode) : null
    return NextResponse.json(ok({ ...address, countryName }))
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    console.error('[address/[id]/GET]', e)
    return apiErrorJson('internal', 500)
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal
    const { id } = await params
    if (!(await canAccessAddress(session, id))) return apiErrorJson('addressNotFound', 404)
    const parsed = addressSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)

    const prepared = await prepareAddressData(parsed.data)
    if (!prepared.ok) return apiErrorJson(prepared.code, 400)

    const address = await prisma.address.update({ where: { id }, data: prepared.data })
    return NextResponse.json(ok(address))
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    if (isRecordNotFound(e)) return apiErrorJson('addressNotFound', 404)
    console.error('[address/[id]/PUT]', e)
    return apiErrorJson('internal', 500)
  }
}
