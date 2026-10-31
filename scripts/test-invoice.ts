// Uji invoice Fase 6a (docs/arsitektur-booking-engine-v2.md §10.4): pajak (fungsi murni, tabel nilai), pembaca tagihan, penerbitan saat terbit draf
// (nomor tanpa lompat, tanggal & jatuh tempo zona aplikasi, pajak/kop/rekening BEKU, batas bayar), satu invoice per booking, konfirmasi pembayaran memakai
// total tagihan (termasuk pajak), dan penjaga sumber (satu penulis invoice, tak ada pembaca total ad-hoc di app/components).
// PENGAMAN: menulis ke database — hanya DB sekali pakai (assertThrowawayDb). Setelan yang diubah dikembalikan.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createDraft, previewDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import type { BookingDraft } from '@/lib/validators/booking'
import { computeTax } from '@/lib/invoice/tax'
import { billOf } from '@/lib/invoice/bill'
import { InvoiceError, issueInvoice } from '@/lib/invoice/issue'
import { processPayment } from '@/lib/payments/process'
import { PaymentAmountError } from '@/lib/payments/confirmAmount'
import { addDays, calendarDateOf, dateInApp, todayInApp, endOfDayExclusiveInApp } from '@/lib/time'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `inv${Date.now()}`
const flat = (cost: number) => [{ minDays: 0, maxDays: 9999, cost }]

// ── murni ────────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('PAJAK (tabel nilai): ditambahkan, termasuk, DPP nilai lain, tarif 0 dilewati, dasar ≤ 0 tanpa baris, pembulatan setengah ke atas, beberapa aturan dari dasar yang sama', () => {
  const PPN = { name: 'PPN', ratePercent: 11, basisPercent: 100 }
  assert.deepEqual(computeTax(1_000_000, [{ ...PPN, mode: 'added' }]), { lines: [{ ...PPN, mode: 'added', amountIdr: 110_000 }], addedIdr: 110_000, includedIdr: 0 })
  assert.deepEqual(computeTax(1_110_000, [{ ...PPN, mode: 'included' }]).includedIdr, 110_000)
  assert.equal(computeTax(1_000_000, [{ name: 'PPN', ratePercent: 12, basisPercent: 91.667, mode: 'added' }]).addedIdr, 110_000)
  assert.deepEqual(computeTax(1_000_000, [{ ...PPN, ratePercent: 0, mode: 'added' }]).lines, [])
  assert.deepEqual(computeTax(0, [{ ...PPN, mode: 'added' }]).lines, [])
  assert.deepEqual(computeTax(-5, [{ ...PPN, mode: 'added' }]).lines, [])
  assert.equal(computeTax(50, [{ name: 'X', ratePercent: 1, basisPercent: 100, mode: 'added' }]).addedIdr, 1, '0,5 → 1')
  assert.equal(computeTax(1_234_567.89, [{ ...PPN, mode: 'added' }]).addedIdr, 135_802, '135.802,47 → 135.802')
  const two = computeTax(1_000_000, [{ ...PPN, mode: 'added' }, { name: 'PB1', ratePercent: 10, basisPercent: 100, mode: 'included' }])
  assert.deepEqual([two.addedIdr, two.includedIdr, two.lines.length], [110_000, 90_909, 2])
})
await t('TAGIHAN: total = subtotal + pajak DITAMBAHKAN (pajak termasuk tak menambah), terbayar hanya pembayaran terkonfirmasi, sisa negatif = kelebihan bayar, tanpa invoice = subtotal', () => {
  const b = billOf({ totalAmount: 1_000_000, invoice: { taxAddedIdr: 110_000, taxIncludedIdr: 5_000 }, payments: [{ status: 'confirmed', amount: 600_000 }, { status: 'pending', amount: 999 }, { status: 'rejected', amount: 1 }] })
  assert.deepEqual(b, { subtotal: 1_000_000, taxAdded: 110_000, taxIncluded: 5_000, grandTotal: 1_110_000, paid: 600_000, balance: 510_000 })
  assert.equal(billOf({ totalAmount: 100, invoice: null, payments: [{ status: 'confirmed', amount: 150 }] }).balance, -50)
  assert.equal(billOf({ totalAmount: 0.1, invoice: { taxAddedIdr: 0.2, taxIncludedIdr: 0 } }).grandTotal, 0.3, 'dihitung dalam sen, bukan float')
})

// ── dunia uji ────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
const savedSettings = await prisma.invoiceSettings.findUniqueOrThrow({ where: { id: 'global' } })
const savedTax = await prisma.taxRule.findMany()
const savedSeq = await prisma.invoiceSequence.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
await prisma.taxRule.updateMany({ data: { isActive: false } })
const ppn = await prisma.taxRule.create({ data: { name: `${tag} PPN`, ratePercent: 11, basisPercent: 100, mode: 'added', isActive: true } })
const bankOn = await prisma.bankAccount.create({ data: { bankName: `${tag} BSI`, accountNumber: '7001', accountHolder: 'PT Uji', isActive: true, sortOrder: -100 } })
const bankOff = await prisma.bankAccount.create({ data: { bankName: `${tag} BCA`, accountNumber: '7002', accountHolder: 'PT Uji', isActive: false, sortOrder: -99 } })
await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { numberPrefix: 'UJI', numberPattern: '{PREFIX}-{YYYY}-{SEQ}', numberPadding: 4, numberResetYearly: true, companyName: `${tag} PT`, companyTaxId: '01.234.567', termsDoc: null } })

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
async function addCost(productType: string, productId: string, component: string, cost: number) {
  await prisma.productCost.create({ data: { productType, productId, vendorId: vendor.id, costComponent: component, currency: 'IDR', costTiers: flat(cost) as never } })
  await prisma.preferredVendor.create({ data: { productType, productId, costComponent: component, vendorId: vendor.id } })
}
const customer = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pelanggan Invoice', role: 'pilgrim', isActive: true } })
const staff = await prisma.user.create({ data: { email: `${tag}-staf@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 50 } })
await addCost('flight', flight.id, 'tiket', 5_000_000); await repriceOwner('flight', flight.id) // jual 6.000.000

const DRAFT = (n: number, dueDays = 3): BookingDraft => ({ items: [{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-10', numPassengers: n }], pilgrims: Array.from({ length: n }, () => ({})), dueDays })
async function newDraft(d: BookingDraft) {
  const r = await createDraft(customer.id); assert.ok(r.ok)
  assert.ok((await saveDraft(r.id, d)).ok)
  return r.id
}
const year = String(todayInApp().slice(0, 4))
const seqNow = async () => (await prisma.invoiceSequence.findUnique({ where: { key: year } }))?.lastNumber ?? 0
const invoiceOf = (bookingId: string) => prisma.invoice.findUniqueOrThrow({ where: { bookingId } })

await t('TERBIT draf → TEPAT SATU invoice: nomor berikutnya (pola setelan), tanggal = hari ini zona aplikasi, jatuh tempo = +dueDays, pajak BEKU = pratinjau, kop + rekening AKTIF saja, batas bayar = akhir hari jatuh tempo, penerbit tercatat', async () => {
  const did = await newDraft(DRAFT(2))
  const p = await previewDraft(did)
  assert.ok(p.ok, JSON.stringify(p))
  if (!p.ok) return
  assert.deepEqual([p.preview.total, p.preview.taxAdded, p.preview.grandTotal], [12_000_000, 1_320_000, 13_320_000])
  const before = await seqNow()
  const r = await publishDraft(did, { byUserId: staff.id })
  assert.ok(r.ok, JSON.stringify(r))
  const inv = await invoiceOf(did)
  assert.equal(inv.number, `UJI-${year}-${String(before + 1).padStart(4, '0')}`)
  assert.equal(r.ok && r.invoiceNumber, inv.number)
  assert.deepEqual([inv.sequenceKey, inv.sequence, await seqNow()], [year, before + 1, before + 1])
  assert.deepEqual([calendarDateOf(inv.invoiceDate), calendarDateOf(inv.dueDate)], [todayInApp(), addDays(todayInApp(), 3)])
  assert.deepEqual(inv.taxLines, [{ name: `${tag} PPN`, ratePercent: 11, basisPercent: 100, mode: 'added', amountIdr: 1_320_000 }])
  assert.deepEqual([Number(inv.taxAddedIdr), Number(inv.taxIncludedIdr), inv.revision, inv.issuedById], [1_320_000, 0, 1, staff.id])
  assert.equal((inv.companySnapshot as { name: string }).name, `${tag} PT`)
  const banks = inv.bankSnapshot as Array<{ bankName: string }>
  assert.ok(banks.some(b => b.bankName === bankOn.bankName) && !banks.some(b => b.bankName === bankOff.bankName), JSON.stringify(banks))
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: did }, include: { invoice: true, payments: true } })
  assert.equal(b.paymentDeadline!.getTime(), endOfDayExclusiveInApp(addDays(todayInApp(), 3)).getTime() - 1)
  assert.equal(dateInApp(b.paymentDeadline!), addDays(todayInApp(), 3))
  assert.equal(billOf(b).grandTotal, p.preview.grandTotal, 'tagihan terbit = pratinjau')
})
await t('BEKU: mengubah tarif pajak, nama perusahaan, dan rekening SESUDAH terbit tidak mengubah invoice maupun tagihannya; booking BARU memakai nilai baru', async () => {
  const did = await newDraft(DRAFT(1))
  assert.ok((await publishDraft(did, { byUserId: staff.id })).ok)
  await prisma.taxRule.update({ where: { id: ppn.id }, data: { ratePercent: 12 } })
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { companyName: `${tag} PT Baru` } })
  await prisma.bankAccount.update({ where: { id: bankOn.id }, data: { accountNumber: '9999' } })
  const inv = await invoiceOf(did)
  assert.deepEqual([Number(inv.taxAddedIdr), (inv.companySnapshot as { name: string }).name], [660_000, `${tag} PT`])
  assert.ok((inv.bankSnapshot as Array<{ accountNumber: string }>).some(x => x.accountNumber === '7001'))
  const next = await newDraft(DRAFT(1))
  assert.ok((await publishDraft(next, { byUserId: staff.id })).ok)
  const inv2 = await invoiceOf(next)
  assert.deepEqual([Number(inv2.taxAddedIdr), (inv2.companySnapshot as { name: string }).name], [720_000, `${tag} PT Baru`])
  await prisma.taxRule.update({ where: { id: ppn.id }, data: { ratePercent: 11 } })
})
await t('TANPA LOMPAT: terbit yang GAGAL (kursi kurang) tak memakai nomor; dua terbit SERENTAK → dua nomor berbeda berurutan', async () => {
  const s0 = await seqNow()
  const tooMany = await newDraft(DRAFT(60))
  const bad = await publishDraft(tooMany, { byUserId: staff.id })
  assert.ok(!bad.ok && bad.status === 409, JSON.stringify(bad))
  assert.equal(await seqNow(), s0, 'rollback membatalkan kenaikan penghitung')
  assert.equal(await prisma.invoice.count({ where: { bookingId: tooMany } }), 0)
  const [a, b] = [await newDraft(DRAFT(1)), await newDraft(DRAFT(1))]
  const rs = await Promise.all([publishDraft(a, { byUserId: staff.id }), publishDraft(b, { byUserId: staff.id })])
  const ok = rs.filter(r => r.ok)
  // Bentrok serialisasi diulang otomatis (retrySerializable) — keduanya terbit; nomor berurutan tanpa celah.
  assert.equal(ok.length, 2, JSON.stringify(rs))
  const seqs = (await prisma.invoice.findMany({ where: { bookingId: { in: [a, b] } }, select: { sequence: true } })).map(x => x.sequence).sort((x, y) => x - y)
  assert.equal(seqs.length, ok.length)
  assert.deepEqual(seqs, Array.from({ length: ok.length }, (_, i) => s0 + 1 + i))
  assert.equal(await seqNow(), s0 + ok.length)
})
await t('SATU INVOICE PER BOOKING: menerbitkan lagi untuk booking yang sudah punya invoice → InvoiceError; draf → InvoiceError; jatuh tempo di luar 0–365 → InvoiceError', async () => {
  const did = await newDraft(DRAFT(1))
  assert.ok((await publishDraft(did, { byUserId: staff.id })).ok)
  await assert.rejects(() => prisma.$transaction(tx => issueInvoice(tx, did, { dueDays: 1, byUserId: staff.id })), InvoiceError)
  const draft = await newDraft(DRAFT(1))
  await assert.rejects(() => prisma.$transaction(tx => issueInvoice(tx, draft, { dueDays: 1, byUserId: staff.id })), InvoiceError)
  const s0 = await seqNow()
  await assert.rejects(() => prisma.$transaction(tx => issueInvoice(tx, did, { dueDays: 400, byUserId: null })), InvoiceError)
  assert.equal(await seqNow(), s0)
})
await t('KONFIRMASI PEMBAYARAN memakai TAGIHAN (termasuk pajak): bawaan = total tagihan; jumlah = subtotal tanpa pajak (kurang) DITOLAK', async () => {
  const did = await newDraft(DRAFT(1)) // 6.000.000 + PPN 11% = 6.660.000
  assert.ok((await publishDraft(did, { byUserId: staff.id })).ok)
  const p1 = await prisma.payment.create({ data: { bookingId: did, amount: 0, method: 'transfer', status: 'pending' } })
  await assert.rejects(() => processPayment(p1.id, { action: 'confirm', amount: 6_000_000, byUserId: staff.id }), PaymentAmountError)
  const done = await processPayment(p1.id, { action: 'confirm', byUserId: staff.id })
  assert.equal(done.kind, 'done')
  assert.equal(Number((await prisma.payment.findUniqueOrThrow({ where: { id: p1.id } })).amount), 6_660_000)
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(f => {
    const rel = join(dir, f)
    return statSync(join(root, rel)).isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(f) ? [rel] : []
  })
}
const SRC = [...files('app'), ...files('components'), ...files('lib')]
await t('PENJAGA: hanya lib/invoice/issue.ts yang menulis invoice; hanya lib/invoice/issue.ts yang menulis Booking.paymentDeadline; terbit draf & POST /bookings memanggil issueInvoice di transaksinya', () => {
  const writers = SRC.filter(f => /\b(tx|prisma)\.invoice\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|INSERT INTO "?invoices"?|UPDATE "?invoices"?/.test(read(f)))
  assert.deepEqual(writers, ['lib/invoice/issue.ts'])
  const deadline = SRC.filter(f => f !== 'lib/invoice/issue.ts' && /paymentDeadline\s*:(?!\s*(?:true\b|\{))/.test(read(f)) && /\b(create|update|upsert)\(/.test(read(f)))
  assert.deepEqual(deadline, [], 'paymentDeadline ditulis di luar lib/invoice/issue.ts')
  assert.match(read('lib/booking/drafts.ts'), /issueInvoice\(tx, id, \{ dueDays, byUserId: input\.byUserId \}\)/)
  assert.match(read('app/api/v1/bookings/route.ts'), /await issueInvoice\(tx, bk\.id, \{ dueDays: defaultDueDays, byUserId: null \}\)/)
})
await t('PENJAGA: app/ dan components/ tak menampilkan `totalAmount` mentah sebagai tagihan (Number(x.totalAmount)) — tagihan lewat billOf', () => {
  const bad = [...files('app'), ...files('components')].filter(f => /Number\(\s*[\w.?]*totalAmount\s*\)/.test(read(f)))
  assert.deepEqual(bad, [])
  assert.match(read('lib/payments/process.ts'), /resolveConfirmedAmount\(billOf\(booking\)\.grandTotal/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.payment.deleteMany({ where: { booking: { userId: customer.id } } })
await prisma.booking.deleteMany({ where: { userId: customer.id } })
await prisma.flightSchedule.deleteMany({ where: { routeId: route.id } })
await prisma.flightRoute.delete({ where: { id: route.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { id: { in: [customer.id, staff.id] } } })
await prisma.bankAccount.deleteMany({ where: { id: { in: [bankOn.id, bankOff.id] } } })
await prisma.taxRule.delete({ where: { id: ppn.id } })
for (const r of savedTax) await prisma.taxRule.update({ where: { id: r.id }, data: { isActive: r.isActive } })
const { id: _id, updatedAt: _u, ...settingsBack } = savedSettings
await prisma.invoiceSettings.update({ where: { id: 'global' }, data: settingsBack })
await prisma.invoiceSequence.deleteMany({})
for (const s of savedSeq) await prisma.invoiceSequence.create({ data: { key: s.key, lastNumber: s.lastNumber } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
