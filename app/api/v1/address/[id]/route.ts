import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { addressSchema } from '@/lib/validators/address'
import { prepareAddressData } from '@/lib/address/prepare'
import { getCountryName } from '@/lib/constants/countries'
import { canAccessAddress } from '@/lib/address/access'
import { isRecordNotFound } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireSession()
    const { id } = await params
    if (!(await canAccessAddress(session, id))) return NextResponse.json(err('Alamat tidak ditemukan'), { status: 404 })
    const address = await prisma.address.findUnique({
      where: { id },
      include: { province: true, regency: true, district: true, village: true },
    })
    if (!address) return NextResponse.json(err('Alamat tidak ditemukan'), { status: 404 })

    const countryName = address.countryCode ? getCountryName(address.countryCode) : null
    return NextResponse.json(ok({ ...address, countryName }))
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    console.error('[address/[id]/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireSession()
    const { id } = await params
    if (!(await canAccessAddress(session, id))) return NextResponse.json(err('Alamat tidak ditemukan'), { status: 404 })
    const parsed = addressSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const prepared = await prepareAddressData(parsed.data)
    if (!prepared.ok) return NextResponse.json(err(prepared.message), { status: 400 })

    const address = await prisma.address.update({ where: { id }, data: prepared.data })
    return NextResponse.json(ok(address))
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    if (isRecordNotFound(e)) return NextResponse.json(err('Alamat tidak ditemukan'), { status: 404 })
    console.error('[address/[id]/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
