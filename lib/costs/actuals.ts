import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'
import { VendorNotUsableError, assertVendorUsable } from '@/lib/vendors/integrity'

// PENGELUARAN AKTUAL ke vendor (docs/arsitektur-harga-terpadu.md §20, 7C). SATU-SATUNYA penulis `cost_actuals`. Modal di snapshot adalah RENCANA (HPP awal); di sini dicatat uang yang benar-benar
// keluar supaya terlihat di mana HPP meleset. Aturan catatan dievaluasi per BARIS rencana (snapshot): selisih = Σ aktual aktif − modal rencana; catatan wajib bila baris dinyatakan lunas dan selisih
// di luar toleransi, atau bila sudah melebihi rencana walau belum lunas. Dievaluasi ulang setelah SETIAP tambah/ubah/batal (membatalkan satu-satunya catatan penjelas ditolak).
// Rencana tak diketahui (modal null) → tak ada selisih yang bisa dihitung, tak ada catatan wajib. Batal = voidedAt, bukan hapus keras.

export class CostActualError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) { super(message); this.name = 'CostActualError' }
}

/** Toleransi selisih (rupiah). 0 = setiap selisih wajib bercatatan; sistem merekomendasikan, admin memutuskan (satu tempat untuk diubah). */
export const VARIANCE_TOLERANCE_IDR = 0
export const MIN_VARIANCE_NOTE_LENGTH = 3
const MAX_AMOUNT = MAX_PRICE_IDR * 10
const round2 = (x: number): number => Math.round(x * 100) / 100

export type ActualInput = {
  bookingId: string
  snapshotId?: string | null
  vendorId: string
  component: string
  currency: string
  amount: number
  amountIdr?: number | null
  paidAt: string
  isSettled?: boolean
  varianceNote?: string | null
}
export type ActualPatch = Partial<Pick<ActualInput, 'vendorId' | 'component' | 'currency' | 'amount' | 'amountIdr' | 'paidAt' | 'isSettled' | 'varianceNote'>>

/** Keadaan satu baris rencana. Murni — diuji tanpa DB. */
export function lineState(planIdr: number | null, entries: ReadonlyArray<{ amountIdr: number; isSettled: boolean; varianceNote: string | null }>) {
  const actualIdr = round2(entries.reduce((s, e) => s + e.amountIdr, 0))
  const settled = entries.some(e => e.isSettled)
  const varianceIdr = planIdr == null || entries.length === 0 ? null : round2(actualIdr - planIdr)
  const needsNote = varianceIdr != null && ((settled && Math.abs(varianceIdr) > VARIANCE_TOLERANCE_IDR) || varianceIdr > VARIANCE_TOLERANCE_IDR)
  const hasNote = entries.some(e => (e.varianceNote?.trim().length ?? 0) >= MIN_VARIANCE_NOTE_LENGTH)
  return { actualIdr, settled, varianceIdr, needsNote, hasNote, violation: needsNote && !hasNote }
}

const rp = (n: number) => n.toLocaleString('id-ID')

function normalize(i: Pick<ActualInput, 'component' | 'currency' | 'amount' | 'amountIdr' | 'paidAt' | 'varianceNote'>) {
  const component = i.component.trim()
  if (component.length < 1 || component.length > 120) throw new CostActualError(400, 'Komponen wajib diisi (maksimal 120 karakter)')
  const currency = i.currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new CostActualError(400, 'Mata uang harus 3 huruf (mis. IDR, SAR, USD)')
  if (!Number.isFinite(i.amount) || i.amount <= 0 || i.amount > MAX_AMOUNT) throw new CostActualError(400, 'Jumlah harus lebih dari 0 dan wajar')
  const amount = round2(i.amount)
  let amountIdr: number
  if (currency === 'IDR') amountIdr = amount
  else {
    if (i.amountIdr == null || !Number.isFinite(i.amountIdr) || i.amountIdr <= 0 || i.amountIdr > MAX_AMOUNT) throw new CostActualError(400, 'Mata uang asing: isi jumlah rupiah yang benar-benar keluar')
    amountIdr = round2(i.amountIdr)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.paidAt) || Number.isNaN(Date.parse(`${i.paidAt}T00:00:00Z`)) || new Date(`${i.paidAt}T00:00:00Z`).toISOString().slice(0, 10) !== i.paidAt) throw new CostActualError(400, 'Tanggal bayar harus berformat YYYY-MM-DD')
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
  if (i.paidAt < '2000-01-01' || i.paidAt > new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) throw new CostActualError(400, 'Tanggal bayar tidak wajar')
  const varianceNote = i.varianceNote?.trim() || null
  if (varianceNote && varianceNote.length > 500) throw new CostActualError(400, 'Catatan maksimal 500 karakter')
  return { component, currency, amount, amountIdr, paidAt: new Date(`${i.paidAt}T00:00:00Z`), varianceNote }
}

async function usableVendor(vendorId: string, db?: Parameters<typeof assertVendorUsable>[1]): Promise<void> {
  try { await assertVendorUsable(vendorId, db) } catch (e) {
    if (e instanceof VendorNotUsableError) throw new CostActualError(e.reason === 'not_found' ? 404 : 409, e.message)
    throw e
  }
}

/** Periksa baris rencana setelah mutasi (di dalam transaksi); melempar → rollback. */
async function assertLineConsistent(tx: Prisma.TransactionClient, snapshotId: string | null): Promise<void> {
  if (!snapshotId) return
  const snap = await tx.priceSnapshot.findUnique({ where: { id: snapshotId }, select: { totalCostIdr: true, description: true } })
  if (!snap) return
  const entries = (await tx.costActual.findMany({ where: { snapshotId, voidedAt: null }, select: { amountIdr: true, isSettled: true, varianceNote: true } }))
    .map(e => ({ amountIdr: Number(e.amountIdr), isSettled: e.isSettled, varianceNote: e.varianceNote }))
  const plan = snap.totalCostIdr == null ? null : Number(snap.totalCostIdr)
  const st = lineState(plan, entries)
  if (st.violation) {
    throw new CostActualError(400, `Selisih terhadap HPP awal untuk "${snap.description}": rencana Rp ${rp(plan!)}, keluar Rp ${rp(st.actualIdr)} (${st.varianceIdr! > 0 ? '+' : ''}${rp(st.varianceIdr!)}) — catatan penyebab wajib (minimal ${MIN_VARIANCE_NOTE_LENGTH} karakter) pada salah satu pengeluaran baris ini`)
  }
}

export async function createCostActual(input: ActualInput & { byUserId: string }): Promise<{ id: string }> {
  const n = normalize(input)
  return prisma.$transaction(async tx => {
    await usableVendor(input.vendorId, tx)
    const booking = await tx.booking.findUnique({ where: { id: input.bookingId }, select: { id: true } })
    if (!booking) throw new CostActualError(404, 'Pesanan tidak ditemukan')
    if (input.snapshotId) {
      // kunci baris rencana: dua pengeluaran paralel pada baris yang sama tak boleh sama-sama lolos pemeriksaan selisih
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "price_snapshots" WHERE "id" = ${input.snapshotId} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
      const snap = await tx.priceSnapshot.findUnique({ where: { id: input.snapshotId }, select: { bookingId: true, lineKey: true } })
      if (!snap || snap.bookingId !== input.bookingId) throw new CostActualError(404, 'Baris rencana tidak ditemukan pada pesanan ini')
      if (snap.lineKey.startsWith('penyesuaian')) throw new CostActualError(400, 'Baris penyesuaian harga tidak memiliki modal — pilih baris komponen/produk')
    }
    const row = await tx.costActual.create({
      data: { bookingId: input.bookingId, snapshotId: input.snapshotId ?? null, vendorId: input.vendorId, ...n, isSettled: input.isSettled ?? false, recordedBy: input.byUserId },
    })
    await assertLineConsistent(tx, input.snapshotId ?? null)
    return { id: row.id }
  })
}

export async function updateCostActual(bookingId: string, id: string, patch: ActualPatch & { byUserId: string }): Promise<void> {
  const head = await prisma.costActual.findUnique({ where: { id }, select: { bookingId: true, snapshotId: true } }) // hanya untuk tahu baris rencana yang dikunci
  if (!head || head.bookingId !== bookingId) throw new CostActualError(404, 'Pengeluaran tidak ditemukan')
  await prisma.$transaction(async tx => {
    if (head.snapshotId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "price_snapshots" WHERE "id" = ${head.snapshotId} FOR UPDATE`) // lihat createCostActual
    // Baca ULANG di dalam kunci: dua PUT paralel tak saling menimpa field yang tak mereka ubah; vendor diperiksa di transaksi yang sama.
    const current = await tx.costActual.findUnique({ where: { id } })
    if (!current || current.bookingId !== bookingId) throw new CostActualError(404, 'Pengeluaran tidak ditemukan')
    if (current.voidedAt) throw new CostActualError(409, 'Pengeluaran yang sudah dibatalkan tidak dapat diubah')
    const vendorId = patch.vendorId ?? current.vendorId
    if (vendorId !== current.vendorId) await usableVendor(vendorId, tx)
    const n = normalize({
      component: patch.component ?? current.component, currency: patch.currency ?? current.currency, amount: patch.amount ?? Number(current.amount),
      amountIdr: patch.amountIdr ?? Number(current.amountIdr), paidAt: patch.paidAt ?? current.paidAt.toISOString().slice(0, 10),
      varianceNote: patch.varianceNote !== undefined ? patch.varianceNote : current.varianceNote,
    })
    await tx.costActual.update({ where: { id }, data: { vendorId, ...n, ...(patch.isSettled !== undefined ? { isSettled: patch.isSettled } : {}) } })
    await assertLineConsistent(tx, current.snapshotId)
  })
}

/** Batalkan (bukan hapus keras). Alasan wajib; membatalkan satu-satunya catatan penjelas selisih ditolak. */
export async function voidCostActual(bookingId: string, id: string, input: { reason: string; byUserId: string }): Promise<void> {
  const reason = input.reason.trim()
  if (reason.length < MIN_VARIANCE_NOTE_LENGTH || reason.length > 500) throw new CostActualError(400, `Alasan pembatalan wajib diisi (${MIN_VARIANCE_NOTE_LENGTH}–500 karakter)`)
  const current = await prisma.costActual.findUnique({ where: { id }, select: { snapshotId: true, bookingId: true } })
  if (!current || current.bookingId !== bookingId) throw new CostActualError(404, 'Pengeluaran tidak ditemukan')
  await prisma.$transaction(async tx => {
    if (current.snapshotId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "price_snapshots" WHERE "id" = ${current.snapshotId} FOR UPDATE`)
    const res = await tx.costActual.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidedBy: input.byUserId, voidReason: reason } })
    if (res.count === 0) throw new CostActualError(409, 'Pengeluaran sudah dibatalkan')
    await assertLineConsistent(tx, current.snapshotId)
  })
}

export type ActualEntryView = {
  id: string; vendorId: string; vendorName: string; component: string; currency: string; amount: number; amountIdr: number; paidAt: string; isSettled: boolean
  varianceNote: string | null; recordedBy: string; recordedByName: string | null; createdAt: string; voided: boolean; voidReason: string | null
}
export type PlanLineView = {
  snapshotId: string; itemType: string; label: string; planIdr: number | null; plannedVendorIds: string[]
  actualIdr: number; varianceIdr: number | null; settled: boolean; needsNote: boolean; entries: ActualEntryView[]
}

/** Baris rencana (yang bermodal) + pengeluaran aktualnya, dan pengeluaran tanpa rujukan baris. INTERNAL admin. */
export async function listCostActuals(bookingId: string): Promise<{ lines: PlanLineView[]; loose: ActualEntryView[] }> {
  const [snaps, actuals] = await Promise.all([
    prisma.priceSnapshot.findMany({ where: { bookingId }, orderBy: [{ itemType: 'asc' }, { lineKey: 'asc' }] }),
    prisma.costActual.findMany({ where: { bookingId }, include: { vendor: { select: { name: true } } }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }] }),
  ])
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(actuals.map(a => a.recordedBy))] } }, select: { id: true, fullName: true } })
  const names = new Map(users.map(u => [u.id, u.fullName]))
  const view = (a: (typeof actuals)[number]): ActualEntryView => ({
    id: a.id, vendorId: a.vendorId, vendorName: a.vendor.name, component: a.component, currency: a.currency, amount: Number(a.amount), amountIdr: Number(a.amountIdr),
    paidAt: a.paidAt.toISOString().slice(0, 10), isSettled: a.isSettled, varianceNote: a.varianceNote, recordedBy: a.recordedBy, recordedByName: names.get(a.recordedBy) ?? null,
    createdAt: a.createdAt.toISOString(), voided: a.voidedAt !== null, voidReason: a.voidReason,
  })
  const bySnap = new Map<string, typeof actuals>()
  for (const a of actuals) if (a.snapshotId) bySnap.set(a.snapshotId, [...(bySnap.get(a.snapshotId) ?? []), a])
  const lines: PlanLineView[] = snaps
    .filter(s => !s.lineKey.startsWith('penyesuaian') && (s.totalCostIdr != null || bySnap.has(s.id)))
    .map(s => {
      const es = bySnap.get(s.id) ?? []
      const st = lineState(s.totalCostIdr == null ? null : Number(s.totalCostIdr), es.filter(e => !e.voidedAt).map(e => ({ amountIdr: Number(e.amountIdr), isSettled: e.isSettled, varianceNote: e.varianceNote })))
      return {
        snapshotId: s.id, itemType: s.itemType, label: s.description, planIdr: s.totalCostIdr == null ? null : Number(s.totalCostIdr),
        plannedVendorIds: Array.isArray(s.vendorIds) ? (s.vendorIds as unknown[]).filter((v): v is string => typeof v === 'string') : [],
        actualIdr: st.actualIdr, varianceIdr: st.varianceIdr, settled: st.settled, needsNote: st.needsNote && !st.hasNote, entries: es.map(view),
      }
    })
  return { lines, loose: actuals.filter(a => !a.snapshotId).map(view) }
}
