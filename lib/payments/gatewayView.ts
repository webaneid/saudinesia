import type { Prisma } from '@prisma/client'
import { qrisSvg } from '@/lib/qris/render'
import { safeExternalUrl } from '@/lib/public-content/links'

// Tampilan satu pembayaran online untuk PEMILIK booking (Fase 9). Tanpa id transaksi/MDR gateway (internal). Server-only (QR dibuat di server).
export const gatewayViewSelect = {
  id: true, status: true, channel: true, channelName: true, payCode: true, payExpiresAt: true, claimedAmountIdr: true, serviceFeeIdr: true, createdAt: true,
} as const satisfies Prisma.PaymentSelect
type Row = Prisma.PaymentGetPayload<{ select: typeof gatewayViewSelect }>

export type GatewayView = {
  id: string; status: 'awaiting' | 'confirmed' | 'expired'; group: string; channelName: string
  kind: 'qr' | 'url' | 'code'; payCode: string | null; qrSvg: string | null; payUrl: string | null
  amount: number; fee: number; total: number; expiresAt: string | null
}

export async function gatewayView(p: Row): Promise<GatewayView> {
  const group = (p.channel ?? '').split(':')[0] ?? ''
  const amount = Number(p.claimedAmountIdr ?? 0)
  const fee = Number(p.serviceFeeIdr)
  const live = p.status === 'awaiting' && p.payCode !== null
  const url = live && /^https:\/\//i.test(p.payCode ?? '') ? safeExternalUrl(p.payCode) : null
  const kind: GatewayView['kind'] = url ? 'url' : group === 'qris' ? 'qr' : 'code'
  let qr: string | null = null
  if (live && kind === 'qr') { try { qr = await qrisSvg(p.payCode!) } catch { qr = null } }
  return {
    id: p.id, status: p.status as GatewayView['status'], group, channelName: p.channelName ?? '',
    kind, payCode: live && kind === 'code' ? p.payCode : null, qrSvg: qr, payUrl: url,
    amount, fee, total: amount + fee, expiresAt: p.payExpiresAt?.toISOString() ?? null,
  }
}
