import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { FeeRule } from '@/lib/payments/feeCalc'

export { gatewayFee, type FeeRule } from '@/lib/payments/feeCalc'

/** Aturan biaya layanan aktif suatu gateway (Fase 9, K9-2). */
export async function feeRulesOf(gateway: 'ipaymu' | 'xendit', db: Pick<Prisma.TransactionClient, 'gatewayFeeRule'> = prisma): Promise<FeeRule[]> {
  const rows = await db.gatewayFeeRule.findMany({ where: { gateway, isActive: true }, select: { channelGroup: true, percent: true, flatIdr: true } })
  return rows.map(r => ({ channelGroup: r.channelGroup, percent: Number(r.percent), flatIdr: r.flatIdr }))
}
