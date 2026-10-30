import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient
export type AuditEntity = 'invoice_settings' | 'bank_account' | 'qris_account' | 'tax_rule' | 'customer_policy'
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
    if (entity === 'bank_account' && k === 'accountNumber') out[k] = maskAccountNumber(String(v))
    else if (entity === 'qris_account' && k === 'emvPayload') out[k] = v == null ? null : `(${String(v).length} karakter)`
    else out[k] = v === undefined ? null : (v as Prisma.InputJsonValue | null)
  }
  return out
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
