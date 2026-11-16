// Kode unik per invoice (docs/arsitektur-booking-engine-v2.md §10.10 Fase 7b-3) terhadap DATABASE SUNGGUHAN (sekali pakai):
// alokasi (acak dalam rentang, tak sama dengan invoice hidup yang bersisa, ruang habis → paling jarang), penerbitan (aktif/nonaktif, beku saat revisi),
// verifikasi (kredit = diterima − kode, kode → entri `kode_unik`, transfer tanpa kode → 0), CHECK DB, tampilan invoice, dan penjaga penulis.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { allocateUniqueCode, issueInvoice, reviseInvoice } from '@/lib/invoice/issue'
import { processPayment } from '@/lib/payments/process'
import { ensureBankCashAccount } from '@/lib/cash/accounts'
import { billOf } from '@/lib/invoice/bill'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = process.cwd()

const tag = `uc${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Kode', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf Kode', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const bank = await prisma.bankAccount.create({ data: { bankName: `${tag} BSI`, accountNumber: '8001', accountHolder: 'PT Uji', isActive: true } })
const acct = (await prisma.$transaction(tx => ensureBankCashAccount(tx, bank.id)))!
let n = 0
/** Booking aktif + invoice manual (kode tertentu): subtotal 1.000.000 tanpa pajak. */
async function mk(o: { code: number | null; status?: 'active' | 'cancelled'; paid?: number }) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: o.status ?? 'active', departureDate: new Date('2091-01-01'), season: 'regular', totalAmount: 1_000_000 } })
  await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-INV-${n}`, sequenceKey: `u${n}`.slice(0, 8), sequence: n, issuedAt: new Date(), invoiceDate: new Date('2090-03-10'), dueDate: new Date('2090-03-14'), companySnapshot: {}, uniqueCode: o.code } })
  if (o.paid) await prisma.payment.create({ data: { bookingId: b.id, amount: o.paid, method: 'bank_transfer', status: 'confirmed', confirmedAt: new Date() } })
  return b.id
}
const R = { min: 9990, max: 9993 } // rentang sempit di luar bawaan (100–999) supaya invoice uji lain tak ikut

await t('alokasi: kode invoice hidup BERSISA tak dipakai lagi; yang lunas/batal boleh dipakai ulang; acak di antara yang bebas', async () => {
  await mk({ code: 9990 })                              // hidup, bersisa → terpakai
  await mk({ code: 9991, paid: 1_000_000 })             // lunas → bebas
  await mk({ code: 9992, status: 'cancelled' })         // batal → bebas
  const seen = new Set<number>()
  for (const r of [0, 0.3, 0.6, 0.99]) seen.add(await prisma.$transaction(tx => allocateUniqueCode(tx, R, () => r)))
  assert.deepEqual([...seen].sort(), [9991, 9992, 9993])
})

await t('alokasi: ruang habis → kode yang paling jarang dipakai (terkecil bila seri), bukan galat', async () => {
  await mk({ code: 9991 }); await mk({ code: 9992 }); await mk({ code: 9993 }); await mk({ code: 9990 }); await mk({ code: 9993 })
  // pemakaian: 9990×2, 9991×1, 9992×1, 9993×2 → 9991
  assert.equal(await prisma.$transaction(tx => allocateUniqueCode(tx, R, () => 0.5)), 9991)
})

const settings = await prisma.invoiceSettings.findUniqueOrThrow({ where: { id: 'global' }, select: { uniqueCodeEnabled: true, uniqueCodeMin: true, uniqueCodeMax: true } })
async function issued() {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: 'active', season: 'regular', totalAmount: 1_000_000 } })
  await prisma.$transaction(tx => issueInvoice(tx, b.id, { dueDays: 3, byUserId: null }))
  return { id: b.id, code: (await prisma.invoice.findUniqueOrThrow({ where: { bookingId: b.id }, select: { uniqueCode: true } })).uniqueCode }
}

await t('penerbitan: setelan aktif → kode dalam rentang setelan; nonaktif → NULL; revisi invoice TIDAK mengubah kode', async () => {
  try {
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { uniqueCodeEnabled: true, uniqueCodeMin: 100, uniqueCodeMax: 999 } })
    const a = await issued()
    assert.ok(a.code !== null && a.code >= 100 && a.code <= 999, `kode ${a.code}`)
    await prisma.booking.update({ where: { id: a.id }, data: { totalAmount: 1_500_000 } })
    await prisma.$transaction(tx => reviseInvoice(tx, a.id))
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { bookingId: a.id }, select: { uniqueCode: true } })).uniqueCode, a.code)
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { uniqueCodeEnabled: false } })
    assert.equal((await issued()).code, null)
  } finally {
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: settings })
  }
})

await t('penerbitan SERENTAK (Serializable, seperti jalur sungguhan): dua invoice bersamaan dengan dua kode bebas → kode berbeda', async () => {
  try {
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { uniqueCodeEnabled: true, uniqueCodeMin: 9998, uniqueCodeMax: 9999 } })
    const { retrySerializable } = await import('@/lib/booking/serializable')
    const mkB = () => prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: 'active', season: 'regular', totalAmount: 1_000_000 } })
    const [b1, b2] = [await mkB(), await mkB()]
    await Promise.all([b1, b2].map(b => retrySerializable(() => prisma.$transaction(tx => issueInvoice(tx, b.id, { dueDays: 3, byUserId: null }), { isolationLevel: 'Serializable' }))))
    const codes = (await prisma.invoice.findMany({ where: { bookingId: { in: [b1.id, b2.id] } }, select: { uniqueCode: true } })).map(i => i.uniqueCode).sort()
    assert.deepEqual(codes, [9998, 9999])
  } finally {
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: settings })
  }
})

async function pending(bookingId: string, claimed: number) {
  return (await prisma.payment.create({ data: { bookingId, amount: 0, claimedAmountIdr: claimed, method: 'bank_transfer', status: 'pending', transferredAt: new Date('2090-03-11T03:00:00Z'), destinationCashAccountId: acct } })).id
}
const entries = (refId: string) => prisma.cashEntry.findMany({ where: { refId }, orderBy: { component: 'asc' } }).then(es => es.map(e => [e.component, Number(e.amountIdr)]))
const billOfBooking = async (id: string) => billOf(await prisma.booking.findUniqueOrThrow({ where: { id }, select: { totalAmount: true, invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } }, payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } } } }))

await t('verifikasi DENGAN kode: kredit tagihan = jumlah (tanpa kode), kode dibaca dari invoice → Payment.uniqueCodeIdr + entri MASUK kode_unik; terbayar tak termasuk kode', async () => {
  const b = await mk({ code: 9990 })
  const p = await pending(b, 400_000)
  assert.equal((await processPayment(p, { action: 'confirm', amount: 400_000, uniqueCode: true, byUserId: staff.id })).kind, 'done')
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p } })).uniqueCodeIdr, 9990)
  assert.deepEqual((await entries(p)).sort(), [['kode_unik', 9990], ['pokok', 400_000]])
  const bill = await billOfBooking(b)
  assert.equal(bill.paid, 400_000); assert.equal(bill.balance, 600_000)
})

await t('verifikasi TANPA kode (centang dilepas / tak dikirim) → 0, tanpa entri kode_unik; invoice tanpa kode + uniqueCode:true → 0', async () => {
  const b = await mk({ code: 9991 })
  for (const uniqueCode of [false, undefined]) {
    const p = await pending(b, 100_000)
    await processPayment(p, { action: 'confirm', amount: 100_000, uniqueCode, byUserId: staff.id })
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p } })).uniqueCodeIdr, 0)
    assert.deepEqual(await entries(p), [['pokok', 100_000]])
  }
  const nb = await mk({ code: null })
  const p = await pending(nb, 100_000)
  await processPayment(p, { action: 'confirm', amount: 100_000, uniqueCode: true, byUserId: staff.id })
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p } })).uniqueCodeIdr, 0)
  assert.deepEqual(await entries(p), [['pokok', 100_000]])
})

await t('D11: kode dicentang tetapi kredit < nominal pelanggan (kode tak sampai) → ditolak 400, tak ada yang diposting; tanpa centang → seluruhnya kredit', async () => {
  const b = await mk({ code: 9990 })
  const p = await pending(b, 400_000)
  await assert.rejects(processPayment(p, { action: 'confirm', amount: 390_010, uniqueCode: true, byUserId: staff.id }), /kode unik/)
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p } })).status, 'pending')
  assert.deepEqual(await entries(p), [])
  await processPayment(p, { action: 'confirm', amount: 400_000 - 10, byUserId: staff.id })
  assert.deepEqual(await entries(p), [['pokok', 399_990]])
})

await t('penolakan tak mencatat kode; CHECK DB: kode di pembayaran belum terverifikasi / di luar rentang ditolak, kode invoice 0 ditolak', async () => {
  const b = await mk({ code: 9992 })
  const p = await pending(b, 100_000)
  await processPayment(p, { action: 'reject', uniqueCode: true, byUserId: staff.id })
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p } })).uniqueCodeIdr, 0)
  await assert.rejects(prisma.payment.update({ where: { id: p }, data: { uniqueCodeIdr: 5 } }), /payments_unique_code_check/)
  await assert.rejects(prisma.payment.create({ data: { bookingId: b, amount: 1, method: 'bank_transfer', status: 'confirmed', uniqueCodeIdr: 10_000 } }), /payments_unique_code_check/)
  await assert.rejects(prisma.invoice.update({ where: { bookingId: b }, data: { uniqueCode: 0 } }), /invoices_unique_code_range/)
})

await t('PENJAGA: kode unik invoice hanya ditulis lib/invoice/issue.ts; Payment.uniqueCodeIdr hanya ditulis lib/payments/process.ts; nilai kode tak pernah dari klien', () => {
  const files: string[] = []
  const walk = (d: string) => { for (const f of readdirSync(join(root, d))) { const p = join(d, f); if (statSync(join(root, p)).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p) } }
  walk('app'); walk('lib')
  const src = (f: string) => readFileSync(join(root, f), 'utf8')
  const invoiceWriters = files.filter(f => /invoice\.(create|update|upsert)/.test(src(f)) && /uniqueCode(?![A-Za-z])/.test(src(f)))
  assert.deepEqual(invoiceWriters, ['lib/invoice/issue.ts'])
  const payWriters = files.filter(f => /uniqueCodeIdr\s*[,:}]/.test(src(f)) && /payment\.(create|update|updateMany)/.test(src(f)))
  assert.deepEqual(payWriters, ['lib/payments/process.ts'])
  const route = src('app/api/v1/admin/payments/[id]/confirm/route.ts')
  assert.match(route, /uniqueCode: z\.boolean\(\)\.optional\(\)/, 'klien hanya mengirim ya/tidak')
  assert.match(src('lib/payments/process.ts'), /booking\.invoice\.uniqueCode/, 'nilai kode dari invoice beku')
  // Invoice publik/PDF: kode hanya selama tagihan masih bisa dibayar (booking hidup bersisa) — sama dengan cadangan rekening.
  assert.match(src('lib/pdf/invoiceData.ts'), /uniqueCode:\s+inv\?\.uniqueCode && booking\.status === 'active' && bill\.balance > 0/)
})

// ── pembersihan (entri kas sengaja tak terhapus: append-only — DB sekali pakai) ─────────────────
const ids = (await prisma.booking.findMany({ where: { userId: user.id }, select: { id: true } })).map(b => b.id)
await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.booking.deleteMany({ where: { id: { in: ids } } })
await prisma.user.deleteMany({ where: { email: { contains: tag } } }) // test-seed-guard sesudahnya butuh DB tanpa jamaah
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
