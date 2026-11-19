import { Prisma, type RefundApprovalMode } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeAudit } from '@/lib/invoice/audit'

// Kebijakan refund (docs/rencana-force-majeure.md): SATU baris 'global'. Pembaca/penulis tunggal — layanan refund membaca `approvalMode` DI DALAM transaksinya.
export const REFUND_SETTINGS_ID = 'global'

type Db = Prisma.TransactionClient | typeof prisma
export type RefundSettingsDto = { approvalMode: RefundApprovalMode; updatedAt: string }

/** Baris 'global' disemai migrasi; upsert defensif untuk database uji. */
export async function getRefundSettings(db: Db = prisma): Promise<RefundSettingsDto> {
  const r = await db.refundSettings.upsert({ where: { id: REFUND_SETTINGS_ID }, create: { id: REFUND_SETTINGS_ID }, update: {} })
  return { approvalMode: r.approvalMode, updatedAt: r.updatedAt.toISOString() }
}

export type SaveRefundSettingsResult = { kind: 'done'; settings: RefundSettingsDto } | { kind: 'stale' }

/** Simpan — kunci baris, `expectedUpdatedAt` basi → `stale` (409), jejak `settings_audit` di transaksi yang sama. */
export async function saveRefundSettings(input: { approvalMode: RefundApprovalMode; expectedUpdatedAt: string }, staffId: string): Promise<SaveRefundSettingsResult> {
  return prisma.$transaction(async (tx) => {
    await tx.refundSettings.upsert({ where: { id: REFUND_SETTINGS_ID }, create: { id: REFUND_SETTINGS_ID }, update: {} })
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "refund_settings" WHERE "id" = ${REFUND_SETTINGS_ID} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    const before = await tx.refundSettings.findUniqueOrThrow({ where: { id: REFUND_SETTINGS_ID } })
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt) return { kind: 'stale' as const }
    if (before.approvalMode === input.approvalMode) return { kind: 'done' as const, settings: { approvalMode: before.approvalMode, updatedAt: before.updatedAt.toISOString() } }
    const after = await tx.refundSettings.update({ where: { id: REFUND_SETTINGS_ID }, data: { approvalMode: input.approvalMode } })
    await writeAudit(tx, staffId, 'refund_settings', REFUND_SETTINGS_ID, 'update', { approvalMode: [before.approvalMode, after.approvalMode] })
    return { kind: 'done' as const, settings: { approvalMode: after.approvalMode, updatedAt: after.updatedAt.toISOString() } }
  })
}
