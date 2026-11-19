import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { VisaEvent } from './timeline'

type Db = PrismaClient | Prisma.TransactionClient

/** Riwayat status visa per pengajuan (baca saja). `withActor` hanya untuk staf — nama petugas tak pernah dikirim ke jamaah. */
export async function visaEventsOf(ids: readonly string[], opts: { withActor?: boolean } = {}, db: Db = prisma): Promise<Map<string, Array<VisaEvent & { actor?: string | null }>>> {
  const out = new Map<string, Array<VisaEvent & { actor?: string | null }>>()
  if (ids.length === 0) return out
  const rows = await db.visaStatusEvent.findMany({
    where: { visaApplicationId: { in: [...ids] } },
    select: { visaApplicationId: true, fromStatus: true, toStatus: true, createdAt: true, ...(opts.withActor ? { actor: { select: { fullName: true } } } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  for (const r of rows) {
    const list = out.get(r.visaApplicationId) ?? []
    const actor = 'actor' in r ? (r.actor as { fullName: string } | null)?.fullName ?? null : undefined
    list.push({ fromStatus: r.fromStatus, toStatus: r.toStatus, createdAt: r.createdAt, ...(opts.withActor ? { actor } : {}) })
    out.set(r.visaApplicationId, list)
  }
  return out
}
