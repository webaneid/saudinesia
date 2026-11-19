import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { qrisMerchantName } from '@/lib/qris/emv'

type Tx = Prisma.TransactionClient
export type AuditEntity = 'invoice_settings' | 'bank_account' | 'qris_account' | 'tax_rule' | 'gateway_fee_rule' | 'public_page' | 'platform_provider_account' | 'refund_settings'
export type AuditAction = 'create' | 'update' | 'delete' | 'toggle'

/** Tulis satu baris jejak (SEC-109) DI DALAM transaksi perubahan — tanpa jejak, perubahan ikut dibatalkan. Tabel append-only (trigger). */
export async function writeAudit(tx: Tx, staffId: string, entity: AuditEntity, entityId: string, action: AuditAction, summary: Prisma.InputJsonValue): Promise<void> {
  await tx.settingsAudit.create({ data: { staffId, entity, entityId, action, summary } })
}

/** Nomor rekening disamarkan: hanya 4 karakter terakhir. */
export const maskAccountNumber = (n: string): string => (n.length <= 4 ? '••••' : `••••${n.slice(-4)}`)

/** Tampilan aman suatu baris untuk jejak (rahasia disamarkan, kolom internal dibuang). */
export function auditView(entity: AuditEntity, row: Record<string, unknown>): Record<string, Prisma.InputJsonValue | null> {
  const out: Record<string, Prisma.InputJsonValue | null> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'id' || k === 'createdAt' || k === 'updatedAt') continue
    if ((entity === 'bank_account' || entity === 'platform_provider_account') && k === 'accountNumber') out[k] = maskAccountNumber(String(v))
    else if (entity === 'qris_account' && k === 'emvPayload') out[k] = v == null ? null : qrisAuditView(String(v))
    else out[k] = v === undefined ? null : (v as Prisma.InputJsonValue | null)
  }
  return out
}

/** Payload QRIS di jejak (Fase 8, K8-2: payload langsung mengarahkan pembayaran): nama merchant + sidik SHA-256 — cukup untuk membuktikan merchant mana yang aktif, tanpa menyalin payload. */
function qrisAuditView(payload: string): string {
  return `${qrisMerchantName(payload) ?? '(tanpa nama)'} · sha256:${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`
}

/** Hanya kolom yang BERUBAH: `{ kolom: [lama, baru] }`; teks kaya cukup "berubah" (isinya panjang). */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>, longText: readonly string[] = []): Record<string, Prisma.InputJsonValue> {
  const out: Record<string, Prisma.InputJsonValue> = {}
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null)) continue
    out[k] = longText.includes(k) ? 'berubah' : [(before[k] ?? null) as Prisma.InputJsonValue, (after[k] ?? null) as Prisma.InputJsonValue]
  }
  return out
}
