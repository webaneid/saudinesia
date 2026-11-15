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
import { cashAccountForSnapshot, ensureBankCashAccount, ensureMainCashAccount, parseCashTarget } from '@/lib/cash/accounts'
import { cashBookEntries, cashBookSummary } from '@/lib/cash/query'
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
await t('parseCashTarget: hanya bank:<uuid> atau cash', () => {
  assert.deepEqual(parseCashTarget('cash'), { kind: 'cash' })
  assert.deepEqual(parseCashTarget('bank:3f1e2d4c-1111-4222-8333-944455556666'), { kind: 'bank', bankAccountId: '3f1e2d4c-1111-4222-8333-944455556666' })
  for (const bad of ['', 'bank:', 'bank:x', 'qris:3f1e2d4c-1111-4222-8333-944455556666', "bank:3f1e2d4c-1111-4222-8333-944455556666' OR 1=1"]) assert.equal(parseCashTarget(bad), null, bad)
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
  assert.equal(oct31.accounts[0]!.balanceIdr, bal, 'saldo = Σ semua waktu, bukan periode')
  const page = await cashBookEntries({ from: '2090-10-31', to: '2090-10-31', account: acct }, 1, 1)
  assert.deepEqual([page.total, page.rows.length, page.rows[0]!.bookingId, page.rows[0]!.bookingCode?.startsWith(tag)], [2, 1, booking, true])
  const ppnOnly = await cashBookEntries({ from: '2090-10-31', to: '2090-10-31', account: acct, component: 'ppn' }, 1, 10)
  assert.deepEqual(ppnOnly.rows.map(r => r.amountIdr), [11_000])
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
  const proc = read('lib/payments/process.ts')
  assert.match(proc, /FOR UPDATE[\s\S]*resolveVerifiedAmount[\s\S]*needs_account[\s\S]*tx\.payment\.update[\s\S]*postEntries\(tx, \{ refType: 'payment'/)
  const page = read('app/[locale]/admin/(protected)/finance/cash-book/page.tsx')
  assert.doesNotMatch(page, /@\/lib\/cash\/(query|ledger|accounts)'/)
  assert.match(read('app/api/v1/admin/finance/cash-book/route.ts'), /await requireCashView\(\)/)
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
