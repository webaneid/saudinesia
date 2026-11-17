// Buku kas minimal (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-1) terhadap DATABASE SUNGGUHAN (sekali pakai):
// append-only di DB (UPDATE/DELETE/TRUNCATE ditolak trigger, CHECK jumlah/bentuk), pecahan pokok/PPN/kelebihan tepat sen, posting saat verifikasi di transaksi yang sama
// (idempoten, penolakan tak memosting, akun wajib), akun kas dari rekening bukti / pilihan admin, entri pembalik, ringkasan saldo, dan penjaga penulis tunggal.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { processPayment } from '@/lib/payments/process'
import { postEntries, reverseEntries, splitPaymentCredit } from '@/lib/cash/ledger'
import { cashAccountForSnapshot, ensureBankCashAccount, ensureGatewayCashAccount, ensureMainCashAccount, ensureQrisCashAccount, parseCashTarget } from '@/lib/cash/accounts'
import { cashBookEntries, cashBookSummary } from '@/lib/cash/query'
import { cashFlow } from '@/lib/cash/flow'
import { csvCell } from '@/lib/reports/csv'
import { createTransfer, transferAccountOptions, voidTransfer } from '@/lib/cash/transfers'
import { cashTransferCreateSchema } from '@/lib/validators/cashTransfers'
import { taxInvoices, taxSummary } from '@/lib/reports/tax'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), 'utf8')

// ── murni ────────────────────────────────────────────────────────────────────────────────────────
await t('splitPaymentCredit: pokok + PPN proporsional tagihan, kelebihan di atas sisa, sisa pembulatan ke pokok, tanpa baris nol', () => {
  assert.deepEqual(splitPaymentCredit({ amount: 555_000, balanceBefore: 1_110_000, grandTotal: 1_110_000, taxAdded: 110_000 }), [{ component: 'pokok', amountIdr: 500_000 }, { component: 'ppn', amountIdr: 55_000 }])
  assert.deepEqual(splitPaymentCredit({ amount: 333_333, balanceBefore: 1_110_000, grandTotal: 1_110_000, taxAdded: 110_000 }), [{ component: 'pokok', amountIdr: 300_300 }, { component: 'ppn', amountIdr: 33_033 }])
  assert.deepEqual(splitPaymentCredit({ amount: 1_200_000, balanceBefore: 1_000_000, grandTotal: 1_000_000, taxAdded: 0 }), [{ component: 'pokok', amountIdr: 1_000_000 }, { component: 'kelebihan', amountIdr: 200_000 }])
  assert.deepEqual(splitPaymentCredit({ amount: 50_000, balanceBefore: -10_000, grandTotal: 1_000_000, taxAdded: 0 }), [{ component: 'kelebihan', amountIdr: 50_000 }], 'sudah lebih bayar → seluruhnya kelebihan')
  assert.deepEqual(splitPaymentCredit({ amount: 0.01, balanceBefore: 1, grandTotal: 0, taxAdded: 0 }), [{ component: 'pokok', amountIdr: 0.01 }], 'tagihan nol → tanpa PPN, tanpa bagi nol')
  for (const amount of [1, 99_999.99, 123_456.78, 7]) { // jumlah komponen = jumlah diterima, tepat sen
    const sum = splitPaymentCredit({ amount, balanceBefore: 100_000, grandTotal: 333_333.33, taxAdded: 33_033.33 }).reduce((s, l) => s + Math.round(l.amountIdr * 100), 0)
    assert.equal(sum, Math.round(amount * 100), `Σ komponen = ${amount}`)
  }
})
await t('parseCashTarget: hanya bank:<uuid>, qris:<uuid> (Fase 8) atau cash', () => {
  assert.deepEqual(parseCashTarget('qris:3f1e2d4c-1111-4222-8333-944455556666'), { kind: 'qris', qrisAccountId: '3f1e2d4c-1111-4222-8333-944455556666' })
  assert.deepEqual(parseCashTarget('cash'), { kind: 'cash' })
  assert.deepEqual(parseCashTarget('bank:3f1e2d4c-1111-4222-8333-944455556666'), { kind: 'bank', bankAccountId: '3f1e2d4c-1111-4222-8333-944455556666' })
  for (const bad of ['', 'bank:', 'bank:x', 'qris:', 'qris:x', "bank:3f1e2d4c-1111-4222-8333-944455556666' OR 1=1"]) assert.equal(parseCashTarget(bad), null, bad)
})

// ── basis data ───────────────────────────────────────────────────────────────────────────────────
const tag = `cb${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Kas', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf Kas', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const bank = await prisma.bankAccount.create({ data: { bankName: `${tag} BSI`, accountNumber: '7001', accountHolder: 'PT Uji', isActive: true } })
const bank2 = await prisma.bankAccount.create({ data: { bankName: `${tag} BRI`, accountNumber: '7002', accountHolder: 'PT Uji', isActive: true } })
let n = 0
/** Booking aktif + invoice: subtotal 1.000.000, PPN ditambahkan 110.000 → tagihan 1.110.000. */
async function mk(o: { dest?: string | null; claimed?: number } = {}) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: 'active', departureDate: new Date('2091-01-01'), season: 'regular', totalAmount: 1_000_000 } })
  await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-INV-${n}`, sequenceKey: `c${n}`.slice(0, 8), sequence: n, issuedAt: new Date(), invoiceDate: new Date('2090-03-10'), dueDate: new Date('2090-03-14'), companySnapshot: {}, taxAddedIdr: 110_000 } })
  const pay = await prisma.payment.create({ data: { bookingId: b.id, amount: 0, claimedAmountIdr: o.claimed ?? null, method: 'bank_transfer', status: 'pending', transferredAt: new Date('2090-03-11T03:00:00Z'), destinationCashAccountId: o.dest ?? null } })
  return { booking: b.id, pay: pay.id }
}
const entriesOf = (refId: string) => prisma.cashEntry.findMany({ where: { refId }, orderBy: { component: 'asc' } })

await t('akun kas: dibuat sekali per rekening (serentak tak menggandakan), Kas tunai satu; rekening dari snapshot bukti dicocokkan (bank+nomor), yang sudah dihapus → null', async () => {
  const [a, b] = await Promise.all([prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)), prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id))])
  assert.equal(a, b)
  assert.equal(await prisma.cashAccount.count({ where: { bankAccountId: bank.id } }), 1)
  const c1 = await prisma.$transaction(tx => ensureMainCashAccount(tx)); const c2 = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  assert.equal(c1, c2)
  assert.equal(await prisma.$transaction(tx => cashAccountForSnapshot(tx, { bankName: bank.bankName, accountNumber: bank.accountNumber })), a)
  assert.equal(await prisma.$transaction(tx => cashAccountForSnapshot(tx, { bankName: 'Bank Hilang', accountNumber: '0' })), null)
  await prisma.bankAccount.update({ where: { id: bank2.id }, data: { isActive: false } })
  assert.equal(await prisma.$transaction(tx => ensureBankCashAccount(tx, bank2.id, { requireActive: true })), null, 'pilihan admin: rekening nonaktif ditolak')
  await prisma.bankAccount.update({ where: { id: bank2.id }, data: { isActive: true } })
})

await t('VERIFIKASI memosting uang masuk di transaksi yang sama: pokok + PPN ke akun rekening bukti, tanggal = waktu transfer, booking & staf tercatat; konfirmasi ulang = conflict tanpa entri ganda', async () => {
  const acct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
  const { booking, pay } = await mk({ dest: acct, claimed: 555_000 })
  const r = await processPayment(pay, { action: 'confirm', byUserId: staff.id })
  assert.equal(r.kind, 'done')
  const es = await entriesOf(pay)
  assert.deepEqual(es.map(e => [e.component, Number(e.amountIdr), e.direction, e.cashAccountId, e.bookingId, e.createdById, e.refType]), [
    ['pokok', 500_000, 'in', acct, booking, staff.id, 'payment'], ['ppn', 55_000, 'in', acct, booking, staff.id, 'payment']])
  assert.equal(es[0]!.entryDate.toISOString(), '2090-03-11T03:00:00.000Z')
  assert.equal((await processPayment(pay, { action: 'confirm', byUserId: staff.id })).kind, 'conflict')
  assert.equal((await entriesOf(pay)).length, 2)
})
await t('pilihan admin MENANG atas rekening bukti; tanpa keduanya → needs_account dan TIDAK ada yang berubah (status, jumlah, kuota, entri)', async () => {
  const acct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
  const a = await mk({ dest: acct })
  assert.equal((await processPayment(a.pay, { action: 'confirm', amount: 1_110_000, cashAccount: { kind: 'bank', bankAccountId: bank2.id }, byUserId: staff.id })).kind, 'done')
  const acct2 = (await prisma.cashAccount.findUniqueOrThrow({ where: { bankAccountId: bank2.id } })).id
  assert.deepEqual([...new Set((await entriesOf(a.pay)).map(e => e.cashAccountId))], [acct2])
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: a.pay } })).destinationCashAccountId, acct2, 'akun final tersimpan di pembayaran')
  const b = await mk({ dest: null })
  assert.equal((await processPayment(b.pay, { action: 'confirm', amount: 100_000, byUserId: staff.id })).kind, 'needs_account')
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: b.pay } })
  assert.deepEqual([p.status, Number(p.amount), p.confirmedAt], ['pending', 0, null])
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b.booking } })).confirmedAt, null)
  assert.equal((await entriesOf(b.pay)).length, 0)
  assert.equal((await processPayment(b.pay, { action: 'confirm', amount: 100_000, cashAccount: { kind: 'cash' }, byUserId: staff.id })).kind, 'done', 'kas tunai')
  await prisma.bankAccount.update({ where: { id: bank2.id }, data: { isActive: false } })
  const c = await mk({ dest: null })
  assert.equal((await processPayment(c.pay, { action: 'confirm', amount: 100_000, cashAccount: { kind: 'bank', bankAccountId: bank2.id }, byUserId: staff.id })).kind, 'needs_account', 'rekening nonaktif tak bisa dipilih')
  await prisma.bankAccount.update({ where: { id: bank2.id }, data: { isActive: true } })
})
await t('LEBIH BAYAR bercatatan → pokok+PPN sampai sisa, sisanya `kelebihan`; PENOLAKAN tak memosting apa pun', async () => {
  const acct = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  const a = await mk({ dest: acct })
  assert.equal((await processPayment(a.pay, { action: 'confirm', amount: 1_310_000, notes: 'lebih 200 rb', byUserId: staff.id })).kind, 'done')
  assert.deepEqual((await entriesOf(a.pay)).map(e => [e.component, Number(e.amountIdr)]), [['pokok', 1_000_000], ['ppn', 110_000], ['kelebihan', 200_000]])
  const r = await mk({ dest: acct })
  assert.equal((await processPayment(r.pay, { action: 'reject', notes: 'buram', byUserId: staff.id })).kind, 'done')
  assert.equal((await entriesOf(r.pay)).length, 0)
})

await t('APPEND-ONLY di DB: UPDATE / DELETE / TRUNCATE ditolak trigger; jumlah ≤ 0 dan entri pembalik tanpa rujukan ditolak CHECK; posting ulang sumber yang sama ditolak UNIQUE', async () => {
  const e = await prisma.cashEntry.findFirstOrThrow({ where: { refType: 'payment' } })
  await assert.rejects(prisma.cashEntry.update({ where: { id: e.id }, data: { amountIdr: 1 } }), /append-only/)
  await assert.rejects(prisma.cashEntry.delete({ where: { id: e.id } }), /append-only/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "cash_entries"'), /append-only/)
  await assert.rejects(prisma.cashEntry.updateMany({ where: { id: e.id }, data: { component: 'koreksi' } }), /append-only/)
  const base = { entryDate: new Date(), direction: 'in' as const, component: 'pokok' as const, cashAccountId: e.cashAccountId, refType: 'payment', bookingId: null }
  await assert.rejects(prisma.cashEntry.create({ data: { ...base, amountIdr: 0, refId: `${tag}-zero` } }), /cash_entries_amount_check/)
  await assert.rejects(prisma.cashEntry.create({ data: { ...base, amountIdr: -5, refId: `${tag}-neg` } }), /cash_entries_amount_check/)
  await assert.rejects(prisma.cashEntry.create({ data: { ...base, amountIdr: 5, refType: 'reversal', refId: `${tag}-rev` } }), /cash_entries_reversal_check/)
  await assert.rejects(prisma.$transaction(tx => postEntries(tx, { refType: 'payment', refId: e.refId, direction: 'in', cashAccountId: e.cashAccountId, entryDate: new Date(), bookingId: null, createdById: null }, [{ component: e.component, amountIdr: 1 }])),
    (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
  await assert.rejects(prisma.cashAccount.create({ data: { kind: 'bank', name: 'x', systemKey: `${tag}-bad` } }), /cash_accounts_shape_check/)
})
await t('ENTRI PEMBALIK: satu koreksi berlawanan arah per entri asal, idempoten (dibalik dua kali tak menggandakan), saldo kembali nol', async () => {
  const acct = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  const refId = `${tag}-cost`
  await prisma.$transaction(tx => postEntries(tx, { refType: 'cost_actual', refId, direction: 'out', cashAccountId: acct, entryDate: new Date(), bookingId: null, createdById: staff.id }, [{ component: 'biaya_vendor', amountIdr: 75_000 }]))
  assert.equal(await prisma.$transaction(tx => reverseEntries(tx, { refType: 'cost_actual', refId }, { createdById: staff.id, entryDate: new Date() })), 1)
  assert.equal(await prisma.$transaction(tx => reverseEntries(tx, { refType: 'cost_actual', refId }, { createdById: staff.id, entryDate: new Date() })), 0)
  const orig = await prisma.cashEntry.findFirstOrThrow({ where: { refId } })
  const rev = await prisma.cashEntry.findFirstOrThrow({ where: { reversesEntryId: orig.id } })
  assert.deepEqual([rev.direction, Number(rev.amountIdr), rev.component, rev.refType, rev.refId], ['in', 75_000, 'koreksi', 'reversal', orig.id])
})
await t('RINGKASAN: masuk/keluar per akun dalam periode (batas hari WIB), saldo sepanjang waktu; daftar berpaginasi terbaru dulu dengan kode booking', async () => {
  const acct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
  const { booking, pay } = await mk({ dest: acct, claimed: 111_000 })
  await prisma.$transaction(async tx => { // tanggal transfer diatur ke 31 Okt 2090 00.30 WIB (= 30 Okt 17.30 UTC) supaya batas hari WIB teruji
    await tx.payment.update({ where: { id: pay }, data: { transferredAt: new Date('2090-10-30T17:30:00Z') } })
  })
  await processPayment(pay, { action: 'confirm', byUserId: staff.id })
  const oct30 = await cashBookSummary({ from: '2090-10-30', to: '2090-10-30', account: acct })
  assert.equal(oct30.inIdr, 0, '30 Okt WIB tidak memuat transfer 31 Okt 00.30 WIB')
  const oct31 = await cashBookSummary({ from: '2090-10-31', to: '2090-10-31', account: acct })
  assert.deepEqual([oct31.inIdr, oct31.outIdr], [111_000, 0])
  const all = await prisma.cashEntry.groupBy({ by: ['direction'], where: { cashAccountId: acct }, _sum: { amountIdr: true } })
  const bal = all.reduce((s, r) => s + (r.direction === 'in' ? 1 : -1) * Number(r._sum.amountIdr), 0)
  assert.equal(oct31.accounts[0]!.closingIdr, bal, 'saldo akhir 31 Okt = Σ semua entri sampai akhir hari itu')
  assert.equal(Math.round((oct31.accounts[0]!.closingIdr - oct31.accounts[0]!.openingIdr) * 100), Math.round((oct31.inIdr - oct31.outIdr) * 100), 'saldo akhir − saldo awal = masuk − keluar 31 Okt WIB')
  assert.equal((await cashBookSummary({ from: '2090-10-30', to: '2090-10-30', account: acct })).accounts[0]!.closingIdr, oct31.accounts[0]!.openingIdr, 'saldo per 30 Okt WIB = saldo awal 31 Okt (transfer 00.30 WIB belum masuk)')
  const page = await cashBookEntries({ from: '2090-10-31', to: '2090-10-31', account: acct }, 1, 1)
  assert.deepEqual([page.total, page.rows.length, page.rows[0]!.bookingId, page.rows[0]!.bookingCode?.startsWith(tag)], [2, 1, booking, true])
  const ppnOnly = await cashBookEntries({ from: '2090-10-31', to: '2090-10-31', account: acct, component: 'ppn' }, 1, 10)
  assert.deepEqual(ppnOnly.rows.map(r => r.amountIdr), [11_000])
})
await t('ARUS KAS (Fase 12a): saldo awal + masuk − keluar = saldo akhir per akun dan total; komponen per arah = total periode; batas hari WIB; filter akun', async () => {
  const acct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
  const other = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  const at = (iso: string) => new Date(iso)
  const ref = `flow-${tag}`
  await prisma.$transaction(async tx => {
    await postEntries(tx, { refType: 'payment', refId: `${ref}-a`, direction: 'in', cashAccountId: acct, entryDate: at('2091-03-31T16:59:00Z'), bookingId: null, createdById: null }, [{ component: 'pokok', amountIdr: 1_000 }]) // 31 Mar 23.59 WIB
    await postEntries(tx, { refType: 'payment', refId: `${ref}-b`, direction: 'in', cashAccountId: acct, entryDate: at('2091-03-31T17:00:00Z'), bookingId: null, createdById: null }, [{ component: 'pokok', amountIdr: 2_000.5 }, { component: 'ppn', amountIdr: 220 }]) // 1 Apr 00.00 WIB
    await postEntries(tx, { refType: 'refund', refId: `${ref}-c`, direction: 'out', cashAccountId: acct, entryDate: at('2091-04-15T03:00:00Z'), bookingId: null, createdById: null }, [{ component: 'refund', amountIdr: 500.25 }])
    await postEntries(tx, { refType: 'cost_actual', refId: `${ref}-d`, direction: 'out', cashAccountId: other, entryDate: at('2091-04-20T03:00:00Z'), bookingId: null, createdById: null }, [{ component: 'biaya_vendor', amountIdr: 300 }])
    await postEntries(tx, { refType: 'payment', refId: `${ref}-e`, direction: 'in', cashAccountId: acct, entryDate: at('2091-04-30T17:00:00Z'), bookingId: null, createdById: null }, [{ component: 'pokok', amountIdr: 9_999 }]) // 1 Mei 00.00 WIB — di luar April
  })
  const f = await cashFlow({ from: '2091-04-01', to: '2091-04-30' })
  const c = (n: number) => Math.round(n * 100)
  for (const a of [...f.accounts, f]) assert.equal(c(a.openingIdr) + c(a.inIdr) - c(a.outIdr), c(a.closingIdr), `invarian saldo (${'name' in a ? a.name : 'total'})`)
  const mine = f.accounts.find(a => a.id === acct)!
  const before = await prisma.cashEntry.groupBy({ by: ['direction'], where: { cashAccountId: acct, entryDate: { lt: at('2091-03-31T17:00:00Z') } }, _sum: { amountIdr: true } })
  assert.equal(c(mine.openingIdr), before.reduce((s, r) => s + (r.direction === 'in' ? 1 : -1) * c(Number(r._sum.amountIdr)), 0), 'saldo awal = semua entri sebelum 1 Apr 00.00 WIB (memuat 31 Mar 23.59)')
  assert.deepEqual([mine.inIdr, mine.outIdr], [2_220.5, 500.25], 'periode April WIB: 1 Apr 00.00 masuk, 1 Mei 00.00 tidak')
  const sumDir = (d: 'in' | 'out') => f.components.filter(x => x.direction === d).reduce((s, x) => s + c(x.amountIdr), 0)
  assert.deepEqual([sumDir('in'), sumDir('out')], [c(f.inIdr), c(f.outIdr)], 'rincian komponen = total periode')
  const only = await cashFlow({ from: '2091-04-01', to: '2091-04-30', account: other })
  assert.deepEqual([only.accounts.length, only.accounts[0]!.id, only.components.map(x => x.component)], [1, other, ['biaya_vendor']])
})

await t('CSV: sel diawali = + - @ diberi awalan (CSV injection), koma/kutip di-escape, angka negatif tak diubah', () => {
  assert.deepEqual([csvCell('=SUM(A1)'), csvCell('-x'), csvCell('a,b'), csvCell('a"b'), csvCell(-500), csvCell(null)], ["'=SUM(A1)", "'-x", '"a,b"', '"a""b"', '-500', ''])
})

await t('TRANSFER ANTAR AKUN (Fase 12b): keluar pindah_akun + biaya di asal, masuk di tujuan; Σ semua akun berubah hanya sebesar biaya; batal = pembalik (saldo kembali), batal kedua → already_void, serentak satu yang menang', async () => {
  const bankAcct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
  const cash = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  const balances = async () => Object.fromEntries((await prisma.cashEntry.groupBy({ by: ['cashAccountId', 'direction'], _sum: { amountIdr: true } }))
    .reduce((m, r) => m.set(r.cashAccountId, (m.get(r.cashAccountId) ?? 0) + (r.direction === 'in' ? 1 : -1) * Math.round(Number(r._sum.amountIdr) * 100)), new Map<string, number>()))
  const total = (b: Record<string, number>) => Object.values(b).reduce((x, y) => x + y, 0)
  const b0 = await balances()
  const when = new Date(Date.now() - 60_000)
  const r = await createTransfer({ from: `account:${bankAcct}`, to: 'cash', amount: 250_000, fee: 6_500, transferredAt: when, note: 'ref 123' }, staff.id)
  assert.ok(r.ok)
  const b1 = await balances()
  assert.deepEqual([(b1[bankAcct] ?? 0) - (b0[bankAcct] ?? 0), (b1[cash] ?? 0) - (b0[cash] ?? 0), total(b1) - total(b0)], [-25_650_000, 25_000_000, -650_000], 'asal −(jumlah+biaya), tujuan +jumlah, Σ hanya −biaya (sen)')
  const ents = await prisma.cashEntry.findMany({ where: { refId: r.value.id }, orderBy: [{ refType: 'asc' }, { component: 'asc' }], select: { refType: true, direction: true, component: true, amountIdr: true, entryDate: true } })
  assert.deepEqual(ents.map(e => [e.refType, e.direction, e.component, Number(e.amountIdr)]), [['transfer_in', 'in', 'pindah_akun', 250_000], ['transfer_out', 'out', 'pindah_akun', 250_000], ['transfer_out', 'out', 'biaya_transfer', 6_500]])
  assert.ok(ents.every(e => e.entryDate.getTime() === when.getTime()), 'tanggal entri = waktu transfer')
  const [v1, v2] = await Promise.all([voidTransfer(r.value.id, 'salah akun', staff.id), voidTransfer(r.value.id, 'salah akun', staff.id)])
  assert.deepEqual([v1.ok, v2.ok].sort(), [false, true], 'pembatalan serentak: satu menang')
  assert.equal([v1, v2].find(v => !v.ok && v.kind === 'already_void') !== undefined, true)
  assert.deepEqual(await balances(), b0, 'sesudah batal saldo semua akun kembali seperti semula')
  assert.equal(await prisma.cashEntry.count({ where: { refType: 'reversal', reverses: { refId: r.value.id } } }), 3, 'tepat satu pembalik per entri')
  const v3 = await voidTransfer(r.value.id, 'lagi', staff.id)
  assert.deepEqual(!v3.ok && v3.kind, 'already_void')
})

await t('TRANSFER ditolak: akun sama, akun QRIS (asal/tujuan), akun tak ada, waktu masa depan; validator menolak kunci asing/desimal/akun sama; CHECK DB menolak bentuk salah; pilihan akun tanpa QRIS', async () => {
  const bankAcct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
  const q = await prisma.qrisAccount.create({ data: { name: `${tag} QRIS`.slice(0, 80), isActive: true } })
  const qAcct = await prisma.$transaction(tx => ensureQrisCashAccount(tx, q.id))
  const now = new Date()
  const base = { amount: 1_000, fee: 0, transferredAt: now, note: null }
  const kinds = [
    await createTransfer({ ...base, from: `account:${bankAcct}`, to: `account:${bankAcct}` }, staff.id),
    ...(qAcct ? [await createTransfer({ ...base, from: `account:${qAcct}`, to: 'cash' }, staff.id), await createTransfer({ ...base, from: 'cash', to: `account:${qAcct}` }, staff.id)] : []),
    await createTransfer({ ...base, from: `account:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`, to: 'cash' }, staff.id),
    await createTransfer({ ...base, from: `account:${bankAcct}`, to: 'cash', transferredAt: new Date(now.getTime() + 3_600_000) }, staff.id),
  ].map(r => !r.ok && r.kind)
  assert.deepEqual(kinds, ['same_account', ...(qAcct ? ['qris_account', 'qris_account'] : []), 'account_missing', 'future_date'])
  // SEC-268: penolakan tak meninggalkan akun kas baru (rekening yang belum pernah dipakai tetap bisa dihapus)
  const fresh = await prisma.bankAccount.create({ data: { bankName: `${tag} BRI`, accountNumber: '7009', accountHolder: 'PT Uji', isActive: true } })
  const before = await prisma.cashAccount.count()
  const rej = await createTransfer({ ...base, from: `bank:${fresh.id}`, to: qAcct ? `account:${qAcct}` : `bank:${fresh.id}` }, staff.id)
  assert.equal(rej.ok, false)
  assert.equal(await prisma.cashAccount.count(), before, 'transfer ditolak tak membuat akun kas')
  await prisma.bankAccount.delete({ where: { id: fresh.id } })
  // SEC-271: tujuan rekening nonaktif / gateway ditolak (asal boleh); waktu > 1 tahun lalu ditolak
  const gw = await prisma.$transaction(tx => ensureGatewayCashAccount(tx, 'ipaymu'))
  assert.deepEqual([await createTransfer({ ...base, from: 'cash', to: `account:${gw}` }, staff.id)].map(r => !r.ok && r.kind), ['bad_destination'])
  await prisma.bankAccount.update({ where: { id: bank.id }, data: { isActive: false } })
  const toInactive = await createTransfer({ ...base, from: 'cash', to: `account:${bankAcct}` }, staff.id)
  const fromInactive = await createTransfer({ ...base, from: `account:${bankAcct}`, to: 'cash' }, staff.id)
  await prisma.bankAccount.update({ where: { id: bank.id }, data: { isActive: true } })
  assert.deepEqual([!toInactive.ok && toInactive.kind, fromInactive.ok], ['bad_destination', true], 'rekening nonaktif hanya boleh jadi asal')
  const old = await createTransfer({ ...base, from: `account:${bankAcct}`, to: 'cash', transferredAt: new Date(now.getTime() - 400 * 24 * 3_600_000) }, staff.id)
  assert.deepEqual(!old.ok && old.kind, 'too_old')
  // SEC-269: baris transfer beku di DB — DELETE/ubah ditolak; pembatalan sekali diizinkan, membatalkan ulang/menghidupkan lagi ditolak
  const tr = fromInactive.ok ? fromInactive.value.id : ''
  await assert.rejects(prisma.$executeRaw`DELETE FROM cash_transfers WHERE id = ${tr}`, /frozen/)
  await assert.rejects(prisma.$executeRaw`UPDATE cash_transfers SET "amountIdr" = 2 WHERE id = ${tr}`, /frozen/)
  assert.ok((await voidTransfer(tr, 'uji beku', staff.id)).ok)
  await assert.rejects(prisma.$executeRaw`UPDATE cash_transfers SET "voidedAt" = NULL, "voidedById" = NULL, "voidReason" = NULL WHERE id = ${tr}`, /frozen/)
  await assert.rejects(prisma.$executeRaw`TRUNCATE cash_transfers`, /frozen/)
  const ok = { from: 'cash', to: `account:${bankAcct}`, amount: 1, fee: 0, transferredAt: now.toISOString() }
  assert.equal(cashTransferCreateSchema.safeParse(ok).success, true)
  for (const bad of [{ ...ok, extra: 1 }, { ...ok, amount: 1.5 }, { ...ok, amount: 0 }, { ...ok, fee: -1 }, { ...ok, to: 'cash' }, { ...ok, from: 'qris:x' }, { ...ok, transferredAt: 'kemarin' }]) assert.equal(cashTransferCreateSchema.safeParse(bad).success, false, JSON.stringify(bad))
  const cash = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  await assert.rejects(prisma.$executeRaw`INSERT INTO cash_transfers (id, "fromAccountId", "toAccountId", "amountIdr", "transferredAt") VALUES (gen_random_uuid()::text, ${cash}, ${cash}, 1, timezone('UTC', now()))`, /cash_transfers_shape/)
  await assert.rejects(prisma.$executeRaw`INSERT INTO cash_transfers (id, "fromAccountId", "toAccountId", "amountIdr", "feeIdr", "transferredAt") VALUES (gen_random_uuid()::text, ${cash}, ${bankAcct}, 1, -1, timezone('UTC', now()))`, /cash_transfers_shape/)
  await assert.rejects(prisma.$executeRaw`INSERT INTO cash_transfers (id, "fromAccountId", "toAccountId", "amountIdr", "transferredAt", "voidedAt") VALUES (gen_random_uuid()::text, ${cash}, ${bankAcct}, 1, timezone('UTC', now()), timezone('UTC', now()))`, /cash_transfers_shape/)
  const opts = await transferAccountOptions()
  assert.ok(!opts.some(o => qAcct && o.value === `account:${qAcct}`), 'akun QRIS tak ditawarkan')
  assert.ok(opts.some(o => o.value === `account:${bankAcct}` && typeof o.balanceIdr === 'number' && o.canReceive))
})

await t('LAPORAN PPN (Fase 12c): ditagihkan = invoice terbit dalam periode (batas hari WIB; batal/hangus dipisah), diterima = entri ppn + PPN termasuk proporsional − bagian PPN refund; per invoice s.d. akhir periode', async () => {
  const acct = await prisma.$transaction(tx => ensureMainCashAccount(tx))
  const inv = async (o: { issuedAt: string; added?: number; included?: number; status?: 'active' | 'cancelled' }) => {
    const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: o.status ?? 'active', departureDate: new Date('2094-01-01'), season: 'regular', totalAmount: 1_000_000 } })
    await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-PPN-${n}`, sequenceKey: `p${n}`.slice(0, 8), sequence: n, issuedAt: new Date(o.issuedAt), invoiceDate: new Date('2093-05-01'), dueDate: new Date('2093-05-05'), companySnapshot: {}, taxAddedIdr: o.added ?? 0, taxIncludedIdr: o.included ?? 0 } })
    return b.id
  }
  const post = (bookingId: string, refType: 'payment' | 'refund', direction: 'in' | 'out', at: string, lines: Array<{ component: 'pokok' | 'ppn' | 'refund'; amountIdr: number }>) =>
    prisma.$transaction(tx => postEntries(tx, { refType, refId: `${tag}-${++n}`, direction, cashAccountId: acct, entryDate: new Date(at), bookingId, createdById: staff.id }, lines))
  const A = await inv({ issuedAt: '2093-04-30T17:30:00Z', added: 110_000 })             // 1 Mei 00.30 WIB → masuk periode
  const B = await inv({ issuedAt: '2093-05-20T03:00:00Z', included: 100_000 })            // PPN di dalam harga
  const C = await inv({ issuedAt: '2093-05-21T03:00:00Z', added: 22_000, status: 'cancelled' })
  await inv({ issuedAt: '2093-04-30T16:30:00Z', added: 999_000 })                          // 30 Apr 23.30 WIB → di luar periode
  await post(A, 'payment', 'in', '2093-05-02T03:00:00Z', [{ component: 'pokok', amountIdr: 500_000 }, { component: 'ppn', amountIdr: 55_000 }])
  await post(A, 'refund', 'out', '2093-05-25T03:00:00Z', [{ component: 'refund', amountIdr: 111_000 }]) // bagian PPN = 111.000 × 110.000 ÷ 1.110.000 = 11.000
  await post(A, 'payment', 'in', '2093-06-02T03:00:00Z', [{ component: 'pokok', amountIdr: 500_000 }, { component: 'ppn', amountIdr: 55_000 }]) // sesudah periode
  await post(B, 'payment', 'in', '2093-05-22T03:00:00Z', [{ component: 'pokok', amountIdr: 1_000_000 }]) // PPN termasuk = 1.000.000 × 100.000 ÷ 1.000.000
  const s = await taxSummary('2093-05-01', '2093-05-31')
  assert.deepEqual(s.billed, { count: 2, addedIdr: 110_000, includedIdr: 100_000, totalIdr: 210_000 })
  assert.deepEqual(s.billedVoid, { count: 1, addedIdr: 22_000, includedIdr: 0, totalIdr: 22_000 })
  assert.deepEqual(s.received, { addedIdr: 55_000, includedIdr: 100_000, grossIdr: 155_000, refundIdr: 11_000, netIdr: 144_000 })
  const list = await taxInvoices('2093-05-01', '2093-05-31', { page: 1, limit: 10, skip: 0 })
  assert.equal(list.meta.total, 3)
  assert.deepEqual(list.items.map(r => [r.bookingId, r.status, r.receivedIdr]), [[C, 'cancelled', 0], [B, 'active', 100_000], [A, 'active', 44_000]], 'terbaru dulu; diterima s.d. 31 Mei (pembayaran Juni tak dihitung)')
  const june = await taxSummary('2093-06-01', '2093-06-30')
  assert.deepEqual([june.billed.count, june.received.addedIdr, june.received.netIdr], [0, 55_000, 55_000], 'uang masuk Juni dihitung di Juni walau invoice terbit Mei')
})

await t('REKENING yang sudah menerima uang tak bisa dihapus (FK Restrict → P2003, jalur "nonaktifkan saja"); rekening tanpa akun kas tetap bisa dihapus', async () => {
  await assert.rejects(prisma.bankAccount.delete({ where: { id: bank.id } }), (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003')
  const fresh = await prisma.bankAccount.create({ data: { bankName: `${tag} Mandiri`, accountNumber: '7003', accountHolder: 'PT Uji' } })
  await prisma.bankAccount.delete({ where: { id: fresh.id } })
})

// ── penjaga sumber ─────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = join(dir, f)
    if (statSync(join(root, p)).isDirectory()) { if (f !== 'node_modules') walk(p, out) } else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
await t('PENJAGA: hanya lib/cash/ledger.ts menulis cash_entries dan hanya lib/cash/accounts.ts menulis cash_accounts; process.ts memosting sesudah kunci di transaksi yang sama; halaman klien tak mengimpor modul berprisma', () => {
  const files = [...walk('app'), ...walk('lib')]
  const entryWriters = files.filter(f => /cashEntry\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|"cash_entries"/.test(read(f)))
  assert.deepEqual(entryWriters, ['lib/cash/ledger.ts'])
  const accountWriters = files.filter(f => /cashAccount\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(read(f)))
  assert.deepEqual(accountWriters, ['lib/cash/accounts.ts'])
  const transferWriters = files.filter(f => /cashTransfer\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|(INSERT INTO|UPDATE|DELETE FROM)\s+"?cash_transfers/.test(read(f)))
  assert.deepEqual(transferWriters, ['lib/cash/transfers.ts'], 'hanya lib/cash/transfers.ts menulis cash_transfers (Fase 12b)')
  const transferPosters = files.filter(f => /'pindah_akun'|'biaya_transfer'|refType: 'transfer_(in|out)'/.test(read(f)) && !f.startsWith('lib/cash/labels'))
  assert.deepEqual(transferPosters, ['lib/cash/transfers.ts'], 'entri pindah_akun/biaya_transfer hanya diposting lib/cash/transfers.ts')
  for (const r of ['app/api/v1/admin/finance/transfers/route.ts', 'app/api/v1/admin/finance/transfers/[id]/route.ts', 'app/api/v1/admin/finance/transfers/options/route.ts']) assert.match(read(r), /await requireCashTransfer\(\)/)
  assert.doesNotMatch(read('app/[locale]/admin/(protected)/finance/transfers/new/page.tsx'), /^import (?!type)[^\n]*@\/lib\/cash\/transfers'/m, 'formulir klien hanya mengimpor TIPE dari modul berprisma')
  const proc = read('lib/payments/process.ts')
  assert.match(proc, /FOR UPDATE[\s\S]*resolveVerifiedAmount[\s\S]*needs_account[\s\S]*tx\.payment\.update[\s\S]*postEntries\(tx, \{ refType: 'payment'/)
  const page = read('app/[locale]/admin/(protected)/finance/cash-book/page.tsx')
  assert.doesNotMatch(page, /@\/lib\/cash\/(query|ledger|accounts)'/)
  assert.match(read('app/api/v1/admin/finance/cash-book/route.ts'), /await requireCashView\(\)/)
  for (const r of ['app/api/v1/admin/finance/tax/route.ts', 'app/api/v1/admin/finance/tax/export/route.ts']) assert.match(read(r), /await requireCashView\(\)/, `${r}: peran laporan PPN`)
  assert.doesNotMatch(read('app/[locale]/admin/(protected)/finance/tax/page.tsx'), /@\/lib\/(reports\/tax|db)'/, 'halaman PPN (klien) hanya membaca API')
  assert.match(read('app/api/v1/bookings/[id]/payment/bukti/route.ts'), /FOR UPDATE[\s\S]*cashAccountForSnapshot\(tx, dest\)[\s\S]*destinationCashAccountId,/)
})

// ── pembersihan (entri kas sengaja tak terhapus: append-only — DB sekali pakai) ─────────────────
const ids = (await prisma.booking.findMany({ where: { userId: user.id }, select: { id: true } })).map(b => b.id)
await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.booking.deleteMany({ where: { id: { in: ids } } })
await prisma.user.deleteMany({ where: { email: { contains: tag } } }) // test-seed-guard sesudahnya butuh DB tanpa jamaah
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
