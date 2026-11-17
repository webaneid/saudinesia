import type { GatewayFeeRule, TaxRule } from '@prisma/client'
import { createListHandlers, type ListAdapter } from '@/lib/invoice/listHandlers'
import {
  bankAccountSchema, bankAccountUpdateSchema, gatewayFeeRuleSchema, gatewayFeeRuleUpdateSchema, qrisAccountSchema, qrisAccountUpdateSchema, taxRuleSchema, taxRuleUpdateSchema,
  type BankAccountInput, type GatewayFeeRuleInput, type QrisAccountInput, type TaxRuleInput,
} from '@/lib/validators/invoiceSettings'

// Adapter model → handler (docs/arsitektur-booking-engine-v2.md §6). Hapus = hapus sungguhan SAAT INI (belum ada yang merujuk); Fase 7 menambah FK Restrict dari pembayaran
// dan galat P2003 sudah dipetakan ke 409 "masih dipakai — nonaktifkan saja". Semua metode menerima klien transaksi (jejak ditulis di transaksi yang sama).
const order = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }]

export const bankAccountAdapter: ListAdapter<BankAccountInput> = {
  list: db => db.bankAccount.findMany({ orderBy: order }),
  get: (db, id) => db.bankAccount.findUnique({ where: { id } }),
  create: (db, d) => db.bankAccount.create({ data: d }),
  update: (db, id, d) => db.bankAccount.update({ where: { id }, data: d }),
  remove: async (db, id) => { await db.bankAccount.delete({ where: { id } }) },
  setActive: (db, id, isActive) => db.bankAccount.update({ where: { id }, data: { isActive } }),
}
export const bankAccountHandlers = createListHandlers({ tag: 'admin/system/bank-accounts', label: 'Rekening bank', entity: 'bank_account', schema: bankAccountSchema, updateSchema: bankAccountUpdateSchema, adapter: bankAccountAdapter })

export const qrisAccountAdapter: ListAdapter<QrisAccountInput> = {
  list: db => db.qrisAccount.findMany({ orderBy: order }),
  get: (db, id) => db.qrisAccount.findUnique({ where: { id } }),
  create: (db, d) => db.qrisAccount.create({ data: d }),
  update: (db, id, d) => db.qrisAccount.update({ where: { id }, data: d }),
  remove: async (db, id) => { await db.qrisAccount.delete({ where: { id } }) },
  setActive: (db, id, isActive) => db.qrisAccount.update({ where: { id }, data: { isActive } }),
}
export const qrisAccountHandlers = createListHandlers({ tag: 'admin/system/qris-accounts', label: 'Akun QRIS', entity: 'qris_account', schema: qrisAccountSchema, updateSchema: qrisAccountUpdateSchema, adapter: qrisAccountAdapter })

const taxDto = (t: TaxRule) => ({ ...t, ratePercent: Number(t.ratePercent), basisPercent: Number(t.basisPercent) })
export const taxRuleAdapter: ListAdapter<TaxRuleInput> = {
  list: async db => (await db.taxRule.findMany({ orderBy: order })).map(taxDto),
  get: async (db, id) => { const t = await db.taxRule.findUnique({ where: { id } }); return t ? taxDto(t) : null },
  create: async (db, d) => taxDto(await db.taxRule.create({ data: d })),
  update: async (db, id, d) => taxDto(await db.taxRule.update({ where: { id }, data: d })),
  remove: async (db, id) => { await db.taxRule.delete({ where: { id } }) },
  setActive: async (db, id, isActive) => taxDto(await db.taxRule.update({ where: { id }, data: { isActive } })),
}
export const taxRuleHandlers = createListHandlers({ tag: 'admin/system/tax-rules', label: 'Aturan pajak', entity: 'tax_rule', schema: taxRuleSchema, updateSchema: taxRuleUpdateSchema, adapter: taxRuleAdapter })

// Biaya layanan gateway per kelompok kanal (Fase 9, K9-2) — dibaca lib/payments/fees.ts.
const feeDto = (r: GatewayFeeRule) => ({ ...r, percent: Number(r.percent) })
export const gatewayFeeRuleAdapter: ListAdapter<GatewayFeeRuleInput> = {
  list: async db => (await db.gatewayFeeRule.findMany({ orderBy: [{ gateway: 'asc' }, ...order] })).map(feeDto),
  get: async (db, id) => { const r = await db.gatewayFeeRule.findUnique({ where: { id } }); return r ? feeDto(r) : null },
  create: async (db, d) => feeDto(await db.gatewayFeeRule.create({ data: d })),
  update: async (db, id, d) => feeDto(await db.gatewayFeeRule.update({ where: { id }, data: d })),
  remove: async (db, id) => { await db.gatewayFeeRule.delete({ where: { id } }) },
  setActive: async (db, id, isActive) => feeDto(await db.gatewayFeeRule.update({ where: { id }, data: { isActive } })),
}
export const gatewayFeeRuleHandlers = createListHandlers({ tag: 'admin/system/gateway-fees', label: 'Biaya gateway', entity: 'gateway_fee_rule', schema: gatewayFeeRuleSchema, updateSchema: gatewayFeeRuleUpdateSchema, adapter: gatewayFeeRuleAdapter })
