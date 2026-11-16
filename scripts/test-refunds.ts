// Pembatalan admin + refund (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-2a) terhadap DATABASE SUNGGUHAN (sekali pakai):
// keputusan uang saat batal (none/refund/retain/defer), peran uang, bukti menunggu menolak, batas refund dinilai di dalam kunci (batal = terbayar bersih,
// hidup = kelebihan bayar), siklus pending → approved → paid | rejected, uang keluar ke buku kas, billOf mengurangi refund dibayar, CHECK DB, dan penjaga penulis tunggal.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { cancelByAdmin, decideDeferred, suggestedRefund } from '@/lib/booking/adminCancel'
import { approveRefund, payRefund, proposeRefund, rejectRefund, updateRefundAmount } from '@/lib/refunds/service'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { ensureMainCashAccount } from '@/lib/cash/accounts'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
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
  assert.equal((await approveRefund(rf.id, staff.id)).kind, 'done')
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
  assert.deepEqual(await approveRefund(rid, staff.id), { kind: 'over_limit', max: 50_000 })
  await prisma.booking.update({ where: { id }, data: { totalAmount: 1_000_000 } })
  assert.equal((await approveRefund(rid, staff.id)).kind, 'done')
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
await t('CHECK DB: refund paid tanpa akun/tanggal, jumlah ≤ 0, keputusan tak sesuai uang ditolak', async () => {
  const id = await mk()
  await assert.rejects(prisma.refund.create({ data: { bookingId: id, amount: 1, reason: 'x', status: 'paid' } }), /refunds_paid_check/)
  await assert.rejects(prisma.refund.create({ data: { bookingId: id, amount: 0, reason: 'x' } }), /refunds_amount_check/)
  await assert.rejects(prisma.bookingCancellation.create({ data: { bookingId: id, cancelledAt: new Date(), reason: 'x', paidIdr: 0, decision: 'refund' } }), /booking_cancellations_decision_check/)
  await assert.rejects(prisma.bookingCancellation.create({ data: { bookingId: id, cancelledAt: new Date(), reason: 'x', paidIdr: 5, decision: 'none' } }), /booking_cancellations_decision_check/)
})

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = join(dir, f)
    if (statSync(join(root, p)).isDirectory()) { if (f !== 'node_modules') walk(p, out) } else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
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
  for (const f of ['app/api/v1/admin/bookings/[id]/cancel/decision/route.ts', 'app/api/v1/admin/bookings/[id]/refunds/route.ts', 'app/api/v1/admin/refunds/[id]/route.ts']) assert.match(read(f), /await requireRefundManage\(\)/, f)
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
