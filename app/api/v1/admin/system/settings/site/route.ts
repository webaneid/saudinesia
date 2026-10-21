import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { siteSettingSchema } from '@/lib/validators/siteSettings'

async function getOrCreateSiteSetting() {
  const existing = await prisma.siteSetting.findFirst()
  if (existing) return existing
  return prisma.siteSetting.create({ data: {} })
}

export async function GET() {
  try {
    await requireSuperAdmin()
    const setting = await getOrCreateSiteSetting()
    return NextResponse.json(ok(setting))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/site/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    await requireSuperAdmin()
    const parsed = siteSettingSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const setting = await getOrCreateSiteSetting()
    const updated = await prisma.siteSetting.update({
      where: { id: setting.id },
      data: parsed.data,
    })
    return NextResponse.json(ok(updated))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/system/settings/site/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
