import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { z } from 'zod'

const schema = z.object({
  passportNumber: z.string().optional(),
  passportExpiry: z.string().date().optional().or(z.literal('')),
  dateOfBirth:    z.string().date().optional().or(z.literal('')),
  nationality:    z.string().optional(),
})

// docs/arsitektur-manifest.md §3 — BookingPilgrim.fieldValues generik menggantikan kolom baku;
// endpoint ini sekarang menggabung (merge) ke fieldValues, bukan menulis kolom terpisah —
// fieldKey persis sama dengan nama sebelumnya (passportNumber/passportExpiry/dateOfBirth/
// nationality) supaya konsisten dengan seed default ManifestFieldRequirement.
export async function PUT(req: Request, { params }: { params: Promise<{ pilgrimId: string }> }) {
  try {
    await requireAdmin()
    const { pilgrimId } = await params
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err('Input tidak valid'), { status: 400 })

    const { passportNumber, passportExpiry, dateOfBirth, nationality } = parsed.data

    const existing = await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: pilgrimId }, select: { fieldValues: true } })
    const values = { ...(existing.fieldValues as Record<string, unknown>) }
    if (passportNumber !== undefined) values.passportNumber = passportNumber || null
    if (passportExpiry) values.passportExpiry = passportExpiry
    if (dateOfBirth) values.dateOfBirth = dateOfBirth
    if (nationality) values.nationality = nationality

    const updated = await prisma.bookingPilgrim.update({
      where: { id: pilgrimId },
      data: { fieldValues: values as Prisma.InputJsonValue },
      select: { id: true, fieldValues: true },
    })
    return NextResponse.json(ok(updated))
  } catch (e) {
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/pilgrims/passport]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
