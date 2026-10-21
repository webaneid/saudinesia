import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

const updateSchema = z.object({
  status: z.enum(['completed', 'rejected']),
  note: z.string().max(500).nullish(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await params
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const updated = await prisma.accountDeletionRequest.update({
      where: { id },
      data: {
        status: parsed.data.status,
        note: parsed.data.note,
        processedAt: new Date(),
        processedById: session.userId,
      },
    })
    return NextResponse.json(ok(updated))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/deletion-requests/[id]/PATCH]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
