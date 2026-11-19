// Pembatalan admin + refund (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-2a) terhadap DATABASE SUNGGUHAN (sekali pakai):
// keputusan uang saat batal (none/refund/retain/defer), peran uang, bukti menunggu menolak, batas refund dinilai di dalam kunci (batal = terbayar bersih,
// hidup = kelebihan bayar), siklus pending → approved → paid | rejected, uang keluar ke buku kas, billOf mengurangi refund dibayar, CHECK DB, dan penjaga penulis tunggal.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { cancelByAdmin, decideDeferred, suggestedRefund } from '@/lib/booking/adminCancel'
import { approveRefund, payRefund, proposeRefund, rejectRefund, updateRefundAmount } from '@/lib/refunds/service'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { ensureMainCashAccount } from '@/lib/cash/accounts'
import { assertThrowawayDb } from './lib/testDb'
import { evaluateRefundApproval, type ApprovalFacts } from '@/lib/refunds/approval'
import { getRefundSettings, saveRefundSettings } from '@/lib/refunds/settings'
import { addDays, todayInApp } from '@/lib/time'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n").slice(0, 20).join('\n     ')}`) }
}
const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), 'utf8')

await t('saran refund: tanpa uang 0; tanpa tanggal berangkat = seluruh terbayar; > 60 hari 100%; < 30 hari 0', () => {
  assert.equal(suggestedRefund(0, new Date('2091-01-01')), 0)
  assert.equal(suggestedRefund(1_000_000, null), 1_000_000)
  assert.equal(suggestedRefund(1_000_000, new Date('2091-01-01')), 1_000_000)
  assert.equal(suggestedRefund(1_000_000, new Date()), 0)
})

const tag = `rf${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Refund', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf Refund', role: 'manager', isActive: true, emailVerifiedAt: new Date() } })
const cash = await prisma.$transaction(tx => ensureMainCashAccount(tx))
let n = 0
/** Booking aktif + invoice: tagihan 1.110.000 (PPN ditambahkan 110.000); `paid` = pembayaran terkonfirmasi; `pending` = bukti menunggu. */
async function mk(o: { paid?: number; pending?: boolean; dep?: string | null } = {}) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: 'active', departureDate: o.dep === null ? null : new Date(o.dep ?? '2091-01-01'), season: 'regular', totalAmount: 1_000_000 } })
  await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-INV-${n}`, sequenceKey: `r${n}`.slice(0, 8), sequence: n, issuedAt: new Date(), invoiceDate: new Date('2090-03-10'), dueDate: new Date('2090-03-14'), companySnapshot: {}, taxAddedIdr: 110_000 } })
  if (o.paid) await prisma.payment.create({ data: { bookingId: b.id, amount: o.paid, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date(), destinationCashAccountId: cash } })
  if (o.pending) await prisma.payment.create({ data: { bookingId: b.id, amount: 0, claimedAmountIdr: 100_000, method: 'bank_transfer', status: 'pending' } })
  return b.id
}
const by = { byUserId: staff.id }
const status = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status
const billFor = async (id: string) => billOf(await prisma.booking.findUniqueOrThrow({ where: { id }, include: { invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } }, payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } }, refunds: billRefunds } }))

await t('BATAL tanpa uang: semua admin, keputusan `none`, satu baris pembatalan, status cancelled, tanpa refund', async () => {
  const id = await mk()
  const r = await cancelByAdmin(id, { reason: 'pelanggan minta', ...by, canMoney: false })
  assert.equal(r.kind, 'done'); assert.equal(r.kind === 'done' && r.decision, 'none')
  assert.equal(await status(id), 'cancelled')
  const c = await prisma.bookingCancellation.findUniqueOrThrow({ where: { bookingId: id } })
  assert.deepEqual([c.decision, Number(c.paidIdr), c.byCustomer, c.cancelledById, c.decidedAt], ['none', 0, false, staff.id, null])
  assert.equal(await prisma.refund.count({ where: { bookingId: id } }), 0)
  assert.equal((await cancelByAdmin(id, { reason: 'ulang', ...by, canMoney: true })).kind, 'conflict', 'batal dua kali ditolak')
})
await t('BATAL dengan uang: peran non-refund → forbidden_money; tanpa keputusan → decision_required + saran; bukti menunggu → pending_payment — tak ada yang berubah', async () => {
  const id = await mk({ paid: 500_000 })
  assert.equal((await cancelByAdmin(id, { reason: 'x batal', decision: 'retain', note: 'n', ...by, canMoney: false })).kind, 'forbidden_money')
  assert.deepEqual(await cancelByAdmin(id, { reason: 'x batal', ...by, canMoney: true }), { kind: 'decision_required', paid: 500_000, suggested: 500_000 })
  const p = await mk({ paid: 500_000, pending: true })
  assert.equal((await cancelByAdmin(p, { reason: 'x batal', decision: 'retain', note: 'n', ...by, canMoney: true })).kind, 'pending_payment')
  for (const b of [id, p]) { assert.equal(await status(b), 'active'); assert.equal(await prisma.bookingCancellation.count({ where: { bookingId: b } }), 0) }
})
await t('BATAL + REFUND: usulan pending sumber cancellation; jumlah > terbayar → over_limit dan pembatalan DI-ROLLBACK (booking tetap aktif)', async () => {
  const id = await mk({ paid: 500_000 })
  const over = await cancelByAdmin(id, { reason: 'batal refund', decision: 'refund', refundAmount: 600_000, ...by, canMoney: true })
  assert.deepEqual(over, { kind: 'over_limit', max: 500_000 })
  assert.equal(await status(id), 'active'); assert.equal(await prisma.bookingCancellation.count({ where: { bookingId: id } }), 0)
  const r = await cancelByAdmin(id, { reason: 'batal refund', decision: 'refund', refundAmount: 400_000, ...by, canMoney: true })
  assert.equal(r.kind, 'done')
  const rf = await prisma.refund.findFirstOrThrow({ where: { bookingId: id } })
  assert.deepEqual([Number(rf.amount), rf.status, rf.source, rf.createdById], [400_000, 'pending', 'cancellation', staff.id])
  const c = await prisma.bookingCancellation.findUniqueOrThrow({ where: { bookingId: id } })
  assert.deepEqual([c.decision, Number(c.paidIdr), c.decidedById], ['refund', 500_000, staff.id])
})
await t('BATAL + TAHAN: catatan wajib; BATAL + TUNDA → decideDeferred (refund) sekali saja', async () => {
  const a = await mk({ paid: 300_000 })
  assert.equal((await cancelByAdmin(a, { reason: 'tahan', decision: 'retain', ...by, canMoney: true })).kind, 'note_required')
  assert.equal((await cancelByAdmin(a, { reason: 'tahan', decision: 'retain', note: 'biaya visa hangus', ...by, canMoney: true })).kind, 'done')
  assert.equal(await prisma.refund.count({ where: { bookingId: a } }), 0)
  const d = await mk({ paid: 300_000 })
  assert.equal((await cancelByAdmin(d, { reason: 'tunda', decision: 'defer', ...by, canMoney: true })).kind, 'done')
  assert.equal((await prisma.bookingCancellation.findUniqueOrThrow({ where: { bookingId: d } })).decidedAt, null)
  assert.deepEqual(await decideDeferred(d, { decision: 'refund', refundAmount: 999_999, ...by }), { kind: 'over_limit', max: 300_000 })
  const ok = await decideDeferred(d, { decision: 'refund', ...by })
  assert.equal(ok.kind, 'done')
  assert.equal(Number((await prisma.refund.findFirstOrThrow({ where: { bookingId: d } })).amount), 300_000, 'bawaan = saran kebijakan (> 60 hari → 100%)')
  assert.equal((await decideDeferred(d, { decision: 'retain', note: 'x', ...by })).kind, 'conflict')
})
await t('SIKLUS: ubah hanya saat pending; bayar hanya approved; bayar memosting KELUAR `refund` ke buku kas dan mengurangi terbayar; tak bisa dibayar/ditolak ulang', async () => {
  const id = await mk({ paid: 800_000 })
  await cancelByAdmin(id, { reason: 'siklus', decision: 'refund', refundAmount: 500_000, ...by, canMoney: true })
  const rf = await prisma.refund.findFirstOrThrow({ where: { bookingId: id } })
  assert.deepEqual(await updateRefundAmount(rf.id, { amount: 900_000, reason: 'naik' }), { kind: 'over_limit', max: 800_000 })
  assert.equal((await updateRefundAmount(rf.id, { amount: 600_000, reason: 'disepakati' })).kind, 'done')
  assert.equal((await payRefund(rf.id, { ...by, cashAccount: { kind: 'cash' }, paidAt: new Date(), notes: null })).kind, 'conflict', 'belum disetujui')
  assert.equal((await approveRefund(rf.id, staff.id, { isSuperadmin: false })).kind, 'done')
  assert.equal((await updateRefundAmount(rf.id, { amount: 100_000, reason: 'x' })).kind, 'conflict', 'disetujui = jumlah terkunci')
  assert.equal((await payRefund(rf.id, { ...by, cashAccount: { kind: 'cash' }, paidAt: new Date(Date.now() + 3_600_000), notes: null })).kind, 'invalid_date')
  const at = new Date(Date.now() - 60_000) // sesudah disetujui (toleransi jam 5 menit)
  assert.equal((await payRefund(rf.id, { ...by, cashAccount: { kind: 'cash' }, paidAt: at, notes: 'trf BSI' })).kind, 'done')
  const es = await prisma.cashEntry.findMany({ where: { refType: 'refund', refId: rf.id } })
  assert.deepEqual(es.map(e => [e.direction, e.component, Number(e.amountIdr), e.cashAccountId, e.bookingId, e.entryDate.toISOString()]), [['out', 'refund', 600_000, cash, id, at.toISOString()]])
  const after = await prisma.refund.findUniqueOrThrow({ where: { id: rf.id } })
  assert.deepEqual([after.status, after.cashAccountId, after.paidById], ['paid', cash, staff.id])
  assert.equal((await billFor(id)).paid, 200_000, 'terbayar bersih = 800.000 − 600.000')
  assert.equal((await payRefund(rf.id, { ...by, cashAccount: { kind: 'cash' }, paidAt: at, notes: null })).kind, 'conflict')
  assert.equal((await rejectRefund(rf.id, { byUserId: staff.id, notes: null })).kind, 'conflict')
  assert.equal(await prisma.cashEntry.count({ where: { refType: 'refund', refId: rf.id } }), 1)
})
await t('KELEBIHAN BAYAR pada booking hidup: batas = terbayar − tagihan − refund terbuka; tolak membebaskan batas; booking tanpa kelebihan → 0', async () => {
  const id = await mk({ paid: 1_310_000 })
  assert.deepEqual(await proposeRefund(id, { amount: 250_000, reason: 'lebih', ...by }), { kind: 'over_limit', max: 200_000 })
  const a = await proposeRefund(id, { amount: 200_000, reason: 'lebih bayar', ...by })
  assert.equal(a.kind, 'done')
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: a.kind === 'done' ? a.refundId : '' } })).source, 'overpayment')
  assert.deepEqual(await proposeRefund(id, { amount: 1, reason: 'lagi', ...by }), { kind: 'over_limit', max: 0 })
  assert.equal((await rejectRefund(a.kind === 'done' ? a.refundId : '', { byUserId: staff.id, notes: 'salah' })).kind, 'done')
  assert.equal((await proposeRefund(id, { amount: 200_000, reason: 'ulang', ...by })).kind, 'done')
  const plain = await mk({ paid: 500_000 })
  assert.deepEqual(await proposeRefund(plain, { amount: 1, reason: 'x', ...by }), { kind: 'over_limit', max: 0 })
})
await t('AUDIT 7b-2a: tagihan naik sesudah usulan (revisi) → setujui/bayar ditolak; bayar sebelum disetujui → invalid_date; tahan/tunda tak bisa dilangkahi usulan biasa; saran 0 → jumlah wajib', async () => {
  const id = await mk({ paid: 1_310_000 })
  const a = await proposeRefund(id, { amount: 200_000, reason: 'lebih', ...by })
  const rid = a.kind === 'done' ? a.refundId : ''
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1_150_000 } }) // seperti revisi: tagihan 1.260.000 → kelebihan tinggal 50.000
  assert.deepEqual(await approveRefund(rid, staff.id, { isSuperadmin: false }), { kind: 'over_limit', max: 50_000 })
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1_000_000 } })
  assert.equal((await approveRefund(rid, staff.id, { isSuperadmin: false })).kind, 'done')
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1_150_000 } })
  assert.deepEqual(await payRefund(rid, { ...by, cashAccount: { kind: 'cash' }, paidAt: new Date(), notes: null }), { kind: 'over_limit', max: 50_000 })
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1_000_000 } })
  assert.equal((await payRefund(rid, { ...by, cashAccount: { kind: 'cash' }, paidAt: new Date('2000-01-01'), notes: null })).kind, 'invalid_date', 'sebelum disetujui')
  assert.equal(await prisma.cashEntry.count({ where: { refType: 'refund', refId: rid } }), 0)
  const r = await mk({ paid: 400_000 })
  await cancelByAdmin(r, { reason: 'tahan', decision: 'retain', note: 'hangus', ...by, canMoney: true })
  assert.equal((await proposeRefund(r, { amount: 1, reason: 'x', ...by })).kind, 'decision_pending')
  const z = await mk({ paid: 400_000, dep: '2026-11-20' }) // < 30 hari → saran 0
  assert.equal((await cancelByAdmin(z, { reason: 'mepet', decision: 'refund', ...by, canMoney: true })).kind, 'amount_required')
  assert.equal(await status(z), 'active')
})
await t('REKENING TUJUAN (SEC-244): bayar dari bank tanpa rekening → needs_recipient; rekening saat bayar disimpan; tunai boleh tanpa; usulan menyimpan & ubah mengosongkan', async () => {
  const bank = await prisma.bankAccount.create({ data: { bankName: 'BSI', accountNumber: `9${Date.now()}`.slice(0, 13), accountHolder: 'PT Uji' } })
  const target = { kind: 'bank' as const, bankAccountId: bank.id }
  const rec = { bank: 'BCA', accountNumber: '1234567890', accountName: 'Uji Refund' }
  const id = await mk({ paid: 1_510_000 }) // kelebihan 400.000
  const a = await proposeRefund(id, { amount: 100_000, reason: 'lebih', ...by })
  const rid = a.kind === 'done' ? a.refundId : ''
  assert.equal((await approveRefund(rid, staff.id, { isSuperadmin: false })).kind, 'done')
  assert.equal((await payRefund(rid, { ...by, cashAccount: target, paidAt: new Date(), notes: null })).kind, 'needs_recipient')
  assert.equal((await payRefund(rid, { ...by, cashAccount: { kind: 'qris', qrisAccountId: bank.id }, paidAt: new Date(), notes: null, recipient: rec })).kind, 'needs_account', 'QRIS tak boleh untuk uang keluar')
  assert.equal(await prisma.cashEntry.count({ where: { refType: 'refund', refId: rid } }), 0)
  assert.equal((await payRefund(rid, { ...by, cashAccount: target, paidAt: new Date(), notes: null, recipient: rec })).kind, 'done')
  const paid = await prisma.refund.findUniqueOrThrow({ where: { id: rid } })
  assert.deepEqual([paid.recipientBank, paid.recipientAccountNumber, paid.recipientAccountName], ['BCA', '1234567890', 'Uji Refund'])
  const b = await proposeRefund(id, { amount: 100_000, reason: 'lebih 2', ...by, recipient: rec })
  const rid2 = b.kind === 'done' ? b.refundId : ''
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: rid2 } })).recipientBank, 'BCA')
  assert.equal((await updateRefundAmount(rid2, { amount: 90_000, reason: 'kurangi', recipient: null })).kind, 'done')
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: rid2 } })).recipientBank, null)
  assert.equal((await approveRefund(rid2, staff.id, { isSuperadmin: false })).kind, 'done')
  assert.equal((await payRefund(rid2, { ...by, cashAccount: { kind: 'cash' }, paidAt: new Date(), notes: null })).kind, 'done', 'tunai tanpa rekening')
  await assert.rejects(prisma.refund.update({ where: { id: rid2 }, data: { recipientBank: 'BCA' } }), /refunds_recipient_shape/, 'sebagian terisi')
  await assert.rejects(prisma.refund.update({ where: { id: rid2 }, data: { recipientBank: 'BCA', recipientAccountNumber: '12ab', recipientAccountName: 'X' } }), /refunds_recipient_shape/, 'nomor bukan angka')
})
await t('FORCE-MAJEURE aturan murni: hanya refund pembatalan; di atas kebijakan wajib FM; tiga mode persetujuan', () => {
  const f = (o: Partial<ApprovalFacts>): ApprovalFacts => ({ source: 'cancellation', amount: 100, otherCancellation: 0, otherAll: 0, policyCap: 100, grandTotal: 1000, ...o })
  assert.deepEqual(evaluateRefundApproval(f({ source: 'overpayment', amount: 900, policyCap: 0 }), 'either', null), { abovePolicy: false, aboveHalf: false, needsForceMajeure: false, needsSuperadmin: false })
  assert.deepEqual(evaluateRefundApproval(f({}), 'either', null), { abovePolicy: false, aboveHalf: false, needsForceMajeure: false, needsSuperadmin: false }, 'tepat di batas = sesuai kebijakan')
  assert.equal(evaluateRefundApproval(f({ amount: 101 }), 'above_policy', null).needsForceMajeure, true)
  assert.equal(evaluateRefundApproval(f({ amount: 60, otherCancellation: 50 }), 'above_policy', 'medical').abovePolicy, true, 'refund lain dijumlah')
  assert.equal(evaluateRefundApproval(f({ amount: 101 }), 'above_policy', 'medical').needsForceMajeure, false)
  assert.equal(evaluateRefundApproval(f({ amount: 101 }), 'above_policy', 'medical').needsSuperadmin, true)
  assert.equal(evaluateRefundApproval(f({ amount: 101 }), 'above_half', 'medical').needsSuperadmin, false, '101 ≤ 50% dari 1000')
  assert.equal(evaluateRefundApproval(f({ amount: 501, policyCap: 600 }), 'above_half', null).needsSuperadmin, true)
  assert.equal(evaluateRefundApproval(f({ amount: 501, policyCap: 600 }), 'above_policy', null).needsSuperadmin, false)
  assert.equal(evaluateRefundApproval(f({ amount: 101 }), 'either', 'other').needsSuperadmin, true)
  assert.equal(evaluateRefundApproval(f({ amount: 101, policyCap: null }), 'either', null).abovePolicy, false, 'tanpa batas kebijakan')
})
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = join(dir, f)
    if (statSync(join(root, p)).isDirectory()) { if (f !== 'node_modules') walk(p, out) } else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const mgr = { isSuperadmin: false }, sup = { isSuperadmin: true }
const near = (d: number) => addDays(todayInApp(), d)
await t('FORCE-MAJEURE pembatalan: 30–60 hari = batas 50%; di atas tanpa FM ditolak dan pembatalan DI-ROLLBACK; dengan FM tersimpan; manager tak bisa menyetujui (mode bawaan), superadmin bisa', async () => {
  assert.equal((await getRefundSettings()).approvalMode, 'above_policy', 'bawaan')
  const id = await mk({ paid: 500_000, dep: near(45) })
  assert.deepEqual(await cancelByAdmin(id, { reason: 'fm', decision: 'refund', refundAmount: 300_000, ...by, canMoney: true }), { kind: 'needs_force_majeure', policyCap: 250_000 })
  assert.equal(await status(id), 'active'); assert.equal(await prisma.refund.count({ where: { bookingId: id } }), 0)
  assert.equal((await cancelByAdmin(id, { reason: 'fm', decision: 'retain', forceMajeure: 'medical', note: 'x', ...by, canMoney: true })).kind, 'force_majeure_not_applicable')
  const r = await cancelByAdmin(id, { reason: 'fm', decision: 'refund', refundAmount: 300_000, forceMajeure: 'medical', ...by, canMoney: true })
  assert.equal(r.kind, 'done')
  const rf = await prisma.refund.findFirstOrThrow({ where: { bookingId: id } })
  assert.equal(rf.forceMajeureCategory, 'medical')
  assert.deepEqual(await updateRefundAmount(rf.id, { amount: 300_000, reason: 'cabut fm', forceMajeure: null }), { kind: 'needs_force_majeure', policyCap: 250_000 }, 'mencabut FM di atas kebijakan ditolak')
  assert.equal((await updateRefundAmount(rf.id, { amount: 320_000, reason: 'fm tetap' })).kind, 'done', 'undefined = FM tetap')
  assert.deepEqual(await approveRefund(rf.id, staff.id, mgr), { kind: 'needs_superadmin' })
  assert.equal((await approveRefund(rf.id, staff.id, sup)).kind, 'done')
})
await t('FORCE-MAJEURE tunda + uang terlambat: < 30 hari = batas 0 → keputusan refund wajib FM; uang yang masuk SESUDAH batal boleh dikembalikan tanpa FM', async () => {
  const d = await mk({ paid: 300_000, dep: near(10) })
  assert.equal((await cancelByAdmin(d, { reason: 'tunda', decision: 'defer', ...by, canMoney: true })).kind, 'done')
  assert.deepEqual(await decideDeferred(d, { decision: 'refund', refundAmount: 300_000, ...by }), { kind: 'needs_force_majeure', policyCap: 0 })
  assert.equal((await decideDeferred(d, { decision: 'refund', refundAmount: 300_000, forceMajeure: 'visa_rejected', ...by })).kind, 'done')
  const late = await mk({ paid: 400_000, dep: near(10) })
  assert.equal((await cancelByAdmin(late, { reason: 'tahan', decision: 'retain', note: 'hangus', ...by, canMoney: true })).kind, 'done')
  await prisma.payment.create({ data: { bookingId: late, amount: 100_000, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date(Date.now() + 1000), destinationCashAccountId: cash } })
  const p = await proposeRefund(late, { amount: 100_000, reason: 'uang terlambat', ...by })
  assert.equal(p.kind, 'done', JSON.stringify(p))
  assert.equal((await approveRefund(p.kind === 'done' ? p.refundId : '', staff.id, mgr)).kind, 'done', 'sesuai batas (uang terlambat) → cukup manager')
})
await t('FORCE-MAJEURE hanya pembatalan: kelebihan bayar + FM ditolak layanan dan CHECK DB', async () => {
  const id = await mk({ paid: 1_200_000 })
  assert.deepEqual(await proposeRefund(id, { amount: 90_000, reason: 'lebih', forceMajeure: 'other', ...by }), { kind: 'force_majeure_not_applicable' })
  const ok = await proposeRefund(id, { amount: 90_000, reason: 'lebih', ...by })
  assert.equal(ok.kind, 'done')
  await assert.rejects(prisma.refund.update({ where: { id: ok.kind === 'done' ? ok.refundId : '' }, data: { forceMajeureCategory: 'other' } }), /refunds_force_majeure_cancellation/)
})
await t('KEBIJAKAN REFUND: simpan basi → stale; ubah mode tercatat di settings_audit; mode dibaca ULANG saat menyetujui (> 50% tagihan)', async () => {
  const s0 = await getRefundSettings()
  assert.deepEqual(await saveRefundSettings({ approvalMode: 'above_half', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }, staff.id), { kind: 'stale' })
  const id = await mk({ paid: 800_000 }) // > 60 hari: batas 100%; tagihan 1.110.000
  await cancelByAdmin(id, { reason: 'separuh', decision: 'refund', refundAmount: 600_000, ...by, canMoney: true })
  const rf = await prisma.refund.findFirstOrThrow({ where: { bookingId: id } })
  const s1 = await saveRefundSettings({ approvalMode: 'above_half', expectedUpdatedAt: s0.updatedAt }, staff.id)
  assert.equal(s1.kind, 'done')
  try {
    const audit = await prisma.settingsAudit.findFirstOrThrow({ where: { entity: 'refund_settings', staffId: staff.id }, orderBy: { at: 'desc' } })
    assert.deepEqual(audit.summary, { approvalMode: ['above_policy', 'above_half'] })
    assert.deepEqual(await approveRefund(rf.id, staff.id, mgr), { kind: 'needs_superadmin' }, '600.000 > 50% dari 1.110.000')
  } finally {
    const cur = await getRefundSettings()
    assert.equal((await saveRefundSettings({ approvalMode: 'above_policy', expectedUpdatedAt: cur.updatedAt }, staff.id)).kind, 'done')
  }
  assert.equal((await approveRefund(rf.id, staff.id, mgr)).kind, 'done', 'kembali ke bawaan: sesuai kebijakan → manager')
})
await t('PENJAGA force-majeure: refund_settings hanya ditulis lib/refunds/settings.ts; route Kebijakan Refund superadmin; aturan persetujuan hanya lib/refunds/approval.ts', () => {
  const files = [...walk('app'), ...walk('lib')]
  assert.deepEqual(files.filter(f => /refundSettings\.(create|update|upsert|delete)/.test(read(f))), ['lib/refunds/settings.ts'])
  assert.deepEqual(files.filter(f => /computeRefundAmount\(/.test(read(f))).sort(), ['lib/booking/adminCancel.ts', 'lib/refunds/approval.ts', 'lib/utils/cancellationPolicy.ts'])
  const route = read('app/api/v1/admin/finance/refund-settings/route.ts')
  assert.equal((route.match(/await requireSuperAdmin\(\)/g) ?? []).length, 2)
  assert.match(read('app/api/v1/admin/refunds/[id]/route.ts'), /approveRefund\(id\.data, session\.userId, \{ isSuperadmin: session\.role === 'superadmin' \}\)/)
  assert.match(read('lib/refunds/service.ts'), /getRefundSettings\(tx\)/)
})
await t('PENJAGA §10.13: tindakan refund hanya di halaman detail — panel booking tanpa aksi/akun kas; route lama per booking dihapus; daftar menaut ke detail + Buat Refund', () => {
  const panel = read('app/[locale]/admin/(protected)/bookings/[id]/RefundsPanel.tsx')
  assert.doesNotMatch(panel, /api\/v1\/admin\/refunds|action: 'pay'|action: 'approve'|cashOptions/)
  assert.match(panel, /finance\/refunds|refundsHref/)
  assert.ok(!existsSync(join(root, 'app/api/v1/admin/bookings/[id]/refunds')), 'route usulan lama per booking harus dihapus')
  const acts = read('app/[locale]/admin/(protected)/finance/refunds/[id]/RefundActions.tsx')
  for (const a of ['approve', 'update', 'reject', 'pay']) assert.match(acts, new RegExp(`action: '${a}'`), a)
  const list = read('app/[locale]/admin/(protected)/finance/refunds/page.tsx')
  assert.match(list, /\$\{base\}\/new/); assert.match(list, /\$\{base\}\/\$\{r\.id\}/)
  assert.match(read('lib/account/deletion.ts'), /recipientBank: null, recipientAccountNumber: null, recipientAccountName: null/)
})
await t('CHECK DB: refund paid tanpa akun/tanggal, jumlah ≤ 0, keputusan tak sesuai uang ditolak', async () => {
  const id = await mk()
  await assert.rejects(prisma.refund.create({ data: { bookingId: id, amount: 1, reason: 'x', status: 'paid' } }), /refunds_paid_check/)
  await assert.rejects(prisma.refund.create({ data: { bookingId: id, amount: 0, reason: 'x' } }), /refunds_amount_check/)
  await assert.rejects(prisma.bookingCancellation.create({ data: { bookingId: id, cancelledAt: new Date(), reason: 'x', paidIdr: 0, decision: 'refund' } }), /booking_cancellations_decision_check/)
  await assert.rejects(prisma.bookingCancellation.create({ data: { bookingId: id, cancelledAt: new Date(), reason: 'x', paidIdr: 5, decision: 'none' } }), /booking_cancellations_decision_check/)
})

await t('PENJAGA: hanya lib/refunds/service.ts membuat/mengubah refund (selain pembersihan hapus-akun); cancelBooking tak menyentuh refund; pelanggan ditolak bila ada uang; route admin memakai peran kebijakan', () => {
  const files = [...walk('app'), ...walk('lib')]
  assert.deepEqual(files.filter(f => /refund\.(create|createMany|update|upsert|delete|deleteMany)\(/.test(read(f))), ['lib/refunds/service.ts'])
  assert.deepEqual(files.filter(f => /refund\.updateMany\(/.test(read(f))), ['lib/account/deletion.ts'])
  assert.deepEqual(files.filter(f => /bookingCancellation\.create\(/.test(read(f))).sort(), ['app/api/v1/bookings/[id]/route.ts', 'lib/booking/adminCancel.ts'])
  assert.doesNotMatch(read('lib/booking/cancel.ts'), /tx\.refund/)
  const del = read('app/api/v1/bookings/[id]/route.ts')
  assert.match(del, /FOR UPDATE[\s\S]*status: \{ in: \['pending', 'confirmed'\] \}[\s\S]*'money'[\s\S]*cancelNeedsAdmin', 409/)
  assert.doesNotMatch(del, /refundAmount/)
  assert.match(read('app/api/v1/admin/bookings/[id]/cancel/route.ts'), /requireBookingCancel\(\)[\s\S]*canMoney: canManageRefund\(session\.role\)/)
  for (const f of ['app/api/v1/admin/bookings/[id]/cancel/decision/route.ts', 'app/api/v1/admin/refunds/route.ts', 'app/api/v1/admin/refunds/candidates/route.ts', 'app/api/v1/admin/refunds/[id]/route.ts']) assert.match(read(f), /await requireRefundManage\(\)/, f)
  const svc = read('lib/refunds/service.ts')
  assert.match(svc, /FOR UPDATE[\s\S]*postEntries\(tx, \{ refType: 'refund'/)
})

const ids = (await prisma.booking.findMany({ where: { userId: user.id }, select: { id: true } })).map(b => b.id)
await prisma.refund.deleteMany({ where: { bookingId: { in: ids } } }).catch(() => undefined) // refund `paid` dirujuk entri kas? tidak (refId teks) — aman dihapus
await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.booking.deleteMany({ where: { id: { in: ids } } })
await prisma.user.deleteMany({ where: { email: { contains: tag } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
