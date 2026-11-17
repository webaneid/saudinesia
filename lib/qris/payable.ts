import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { isUsableQrisPayload } from './emv'

type Db = Pick<Prisma.TransactionClient, 'qrisAccount'>

export type PayableQris = { id: string; name: string; payload: string }

// QRIS yang bisa dipakai pelanggan (Fase 8, docs/arsitektur-booking-engine-v2.md §10.11): metode QRIS aktif di Pengaturan Invoice, QRIS aktif,
// payload sah. K8-2 = SELALU TERKINI — tidak dibekukan di invoice; halaman bayar, route QR, unggah bukti, dan invoice publik memakai fungsi ini.
export async function payableQris(db: Db = prisma): Promise<PayableQris[]> {
  const { methodQris } = await getInvoiceSettings()
  if (!methodQris) return []
  const rows = await db.qrisAccount.findMany({
    where: { isActive: true, emvPayload: { not: null } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, emvPayload: true },
    take: 20,
  })
  return rows.flatMap(r => (r.emvPayload && isUsableQrisPayload(r.emvPayload) ? [{ id: r.id, name: r.name, payload: r.emvPayload }] : []))
}

/** Nilai pilihan tujuan QRIS di formulir bukti (`qris:<id>`) — bentuk yang sama dibaca `paymentTransferSchema`. */
export const qrisDestination = (id: string) => `qris:${id}`
