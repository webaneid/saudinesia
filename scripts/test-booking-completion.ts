// Fase 13d bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md §5d): Tandai selesai / Buka kembali terhadap DATABASE SUNGGUHAN.
// Dibuktikan: syarat (aktif, dikonfirmasi, lunas, tanpa pembayaran terbuka, sudah pulang) dinilai di server; status `completed` + penanda + event beku;
// dasar margin dikoreksi ke pengeluaran vendor AKTUAL dan dibekukan (pengeluaran sesudah selesai tak mengubah hak); markup tak dikoreksi; Buka kembali
// mengembalikan hak rencana; booking selesai tak bisa direvisi/diatur total; tabel event append-only + CHECK; penjaga sumber (penulis tunggal).
//
// PENGAMAN: menulis data sementara → hanya database sekali pakai.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import type { BookingDraft } from '@/lib/validators/booking'
import { processPayment } from '@/lib/payments/process'
import { setBookingTotal } from '@/lib/booking/adjustments'
import { ensurePricesFollowRevenueShare } from '@/lib/revenue-share/pricing'
import { saveRevenueShare, currentRevenueShare } from '@/lib/revenue-share/settings'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { bookingShareStatus, syncRevenueShare } from '@/lib/revenue-share/entitlement'
import { finalSharePotential } from '@/lib/revenue-share/potential'
import { completeBooking, completionBlockers, reopenBooking, type CompletionFacts } from '@/lib/booking/completion'
import { canCompleteBooking, canReopenBooking } from '@/lib/booking/policy'
import { createCostActual } from '@/lib/costs/actuals'
import { dbDateOf, todayInApp, addDays } from '@/lib/time'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) out.push(...files(rel))
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}
const tag = `bcp${Date.now()}`

// ── dunia uji ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 1000 } })
const savedState = await prisma.revenueSharePricingState.findMany()
const savedTax = await prisma.taxRule.findMany({ where: { isActive: true }, select: { id: true } })
await prisma.taxRule.updateMany({ data: { isActive: false } }) // tagihan = subtotal, angka mudah dibaca
assert.equal(await prisma.user.count({ where: { isPlatformProvider: true } }), 0, 'DB uji tanpa akun Platform Provider')

// Pembersihan berdasarkan tag, SELALU dijalankan (finally): akun Platform Provider uji + penanda harga yang tertinggal membuat skrip uji lain gagal
// (FK Restrict entri hak ke booking) dan harga semua produk tetap ber-poin. Entri/kas/refund append-only → DB sekali pakai saja, trigger dimatikan di transaksi pembersih.
async function cleanup() {
  const bookings = (await prisma.booking.findMany({ where: { user: { email: { startsWith: `${tag}-` } } }, select: { id: true } })).map(b => b.id)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.revenueShareEntry.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.bookingCompletionEvent.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.costActual.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.cashEntry.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.refund.deleteMany({ where: { bookingId: { in: bookings } } })
    await tx.bookingCancellation.deleteMany({ where: { bookingId: { in: bookings } } })
  })
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookings } } })
  await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
  const routes = (await prisma.flightRoute.findMany({ where: { origin: { startsWith: tag } }, select: { id: true } })).map(r => r.id)
  await prisma.flightSchedule.deleteMany({ where: { routeId: { in: routes } } })
  await prisma.flightRoute.deleteMany({ where: { id: { in: routes } } })
  const vendors = (await prisma.vendor.findMany({ where: { nameKey: { startsWith: tag } }, select: { id: true } })).map(v => v.id)
  await prisma.productCost.deleteMany({ where: { vendorId: { in: vendors } } })
  await prisma.preferredVendor.deleteMany({ where: { vendorId: { in: vendors } } })
  await sweepOrphanPricePoints()
  await prisma.vendor.deleteMany({ where: { id: { in: vendors } } })
  const testUsers = (await prisma.user.findMany({ where: { email: { startsWith: `${tag}-` } }, select: { id: true } })).map(u => u.id)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.revenueShareSetting.deleteMany({ where: { createdById: { in: testUsers } } })
  })
  await prisma.user.deleteMany({ where: { id: { in: testUsers } } })
  await prisma.revenueSharePricingState.deleteMany({})
  for (const st of savedState) await prisma.revenueSharePricingState.create({ data: st })
  for (const r of savedTax) await prisma.taxRule.update({ where: { id: r.id }, data: { isActive: true } })
  await prisma.pricingRule.deleteMany({})
  for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
  await refreshAllPricingCaches() // harga produk lain kembali tanpa poin uji
}

try {

const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const customer = await prisma.user.create({ data: { email: `${tag}-c@example.test`, passwordHash: 'x', fullName: 'Pelanggan', role: 'pilgrim', isActive: true } })
const staff = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'superadmin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 50 } })
await prisma.productCost.create({ data: { productType: 'flight', productId: flight.id, vendorId: vendor.id, costComponent: 'tiket', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost: 1_000_000 }] as never } })
await prisma.preferredVendor.create({ data: { productType: 'flight', productId: flight.id, costComponent: 'tiket', vendorId: vendor.id } })
await repriceOwner('flight', flight.id)

const DRAFT: BookingDraft = { items: [{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-10', numPassengers: 2 }], pilgrims: [{}, {}], dueDays: 3 }
async function publish(): Promise<string> {
  const r = await createDraft(customer.id); assert.ok(r.ok)
  assert.ok((await saveDraft(r.id, DRAFT)).ok)
  const p = await publishDraft(r.id, { byUserId: staff.id }); assert.ok(p.ok, JSON.stringify(p))
  return r.id
}
async function pay(bookingId: string, amount: number): Promise<string> {
  const p = await prisma.payment.create({ data: { bookingId, amount: 0, claimedAmountIdr: amount, method: 'bank_transfer', status: 'pending' } })
  const r = await processPayment(p.id, { action: 'confirm', amount, notes: 'uji', cashAccount: { kind: 'cash' }, byUserId: staff.id })
  assert.equal(r.kind, 'done', JSON.stringify(r))
  return p.id
}
const entries = (bookingId: string) => prisma.revenueShareEntry.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
const sum = async (bookingId: string) => (await entries(bookingId)).reduce((s, e) => s + Math.round(Number(e.amountIdr) * 100), 0) / 100


const today = todayInApp()
const F = (o: Partial<CompletionFacts>): CompletionFacts => ({ status: 'active', confirmedAt: new Date(), grandTotal: 100, paid: 100, openPayment: false, departureDate: dbDateOf(addDays(today, -10)), returnDate: dbDateOf(addDays(today, -1)), ...o })

await t('SYARAT (murni): aktif + dikonfirmasi + lunas + tanpa pembayaran terbuka + pulang ≤ hari ini; tanpa tanggal = boleh; status lain → not_active saja', () => {
  assert.deepEqual(completionBlockers(F({}), today), [])
  assert.deepEqual(completionBlockers(F({ returnDate: dbDateOf(today) }), today), [], 'pulang hari ini boleh')
  assert.deepEqual(completionBlockers(F({ returnDate: null, departureDate: null }), today), [])
  assert.deepEqual(completionBlockers(F({ returnDate: null, departureDate: dbDateOf(addDays(today, 1)) }), today), ['not_returned'], 'pulang kosong → tanggal berangkat')
  assert.deepEqual(completionBlockers(F({ confirmedAt: null, paid: 99.99, openPayment: true, returnDate: dbDateOf(addDays(today, 1)) }), today), ['not_confirmed', 'unpaid', 'pending_payment', 'not_returned'])
  assert.deepEqual(completionBlockers(F({ paid: 150 }), today), [], 'kelebihan bayar = lunas')
  for (const status of ['draft', 'completed', 'cancelled', 'expired'] as const) assert.deepEqual(completionBlockers(F({ status }), today), ['not_active'])
})

await t('POTENSI AKHIR (murni): margin memakai aktual per baris (tanpa aktual = rencana), aktual lepas mengurangi, ≥ 0; markup tak dikoreksi', () => {
  const rule = { percent: 5, basis: 'margin' as const }
  const L = (cost: number | null, sell: number, actual: number | null) => ({ itemType: 'flight', lineKey: 'x', totalCostIdr: cost, totalSellIdr: sell, actualIdr: actual })
  assert.equal(finalSharePotential([L(1_000_000, 1_200_000, null)], 0, rule), 10_000)
  assert.equal(finalSharePotential([L(1_000_000, 1_200_000, 1_100_000), L(500_000, 600_000, null)], 50_000, rule), 5_000 + 5_000 - 2_500)
  assert.equal(finalSharePotential([L(null, 600_000, 400_000)], 0, rule), 10_000, 'modal rencana tak diketahui tapi aktual ada → margin diketahui')
  assert.equal(finalSharePotential([L(1_000_000, 1_200_000, 2_000_000)], 0, rule), 0, 'rugi → 0, tak berutang')
  assert.equal(finalSharePotential([L(1_000_000, 1_250_000, 3_000_000)], 99, { percent: 5, basis: 'markup' }), 50_000)
  assert.equal(finalSharePotential([L(1_000_000, 1_200_000, null)], 0, null), 0)
})

await t('PERAN: Tandai selesai semua admin; Buka kembali hanya manager/superadmin', () => {
  assert.deepEqual((['admin', 'manager', 'superadmin', 'pilgrim'] as const).map(r => [canCompleteBooking(r), canReopenBooking(r)]), [[true, false], [true, true], [true, true], [false, false]])
})

/** Simulasikan waktu berlalu: tanggal acuan booking dipindah ke masa lalu (jadwal penerbangan uji di 2090). */
const travelled = (id: string) => prisma.booking.update({ where: { id }, data: { departureDate: dbDateOf(addDays(today, -12)), returnDate: dbDateOf(addDays(today, -2)) } })
const events = (bookingId: string) => prisma.bookingCompletionEvent.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })

await t('DITOLAK di server: belum dikonfirmasi/lunas, belum pulang, ada bukti menunggu — status tetap aktif, tanpa event', async () => {
  const b = await publish()
  let r = await completeBooking(b, staff.id)
  assert.deepEqual(r, { kind: 'blocked', blockers: ['not_confirmed', 'unpaid', 'not_returned'] })
  await pay(b, 2_400_000)
  r = await completeBooking(b, staff.id)
  assert.deepEqual(r, { kind: 'blocked', blockers: ['not_returned'] })
  await travelled(b)
  await prisma.payment.create({ data: { bookingId: b, amount: 0, claimedAmountIdr: 10, method: 'bank_transfer', status: 'pending' } })
  r = await completeBooking(b, staff.id)
  assert.deepEqual(r, { kind: 'blocked', blockers: ['pending_payment'] })
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b } })).status, 'active')
  assert.equal((await events(b)).length, 0)
  assert.equal((await completeBooking('00000000-0000-4000-8000-000000000000', staff.id)).kind, 'not_found')
  assert.equal((await reopenBooking(b, staff.id)).kind, 'not_completed')
})

await t('TANPA aturan beku: selesai tetap bisa (status, penanda, event potensi 0), tanpa entri hak', async () => {
  const b = await publish()
  await pay(b, 2_400_000); await travelled(b)
  const r = await completeBooking(b, staff.id)
  assert.equal(r.kind, 'done', JSON.stringify(r))
  const bk = await prisma.booking.findUniqueOrThrow({ where: { id: b } })
  assert.deepEqual([bk.status, !!bk.completedAt, bk.completedById], ['completed', true, staff.id])
  assert.deepEqual((await events(b)).map(e => [e.action, Number(e.potentialIdr), e.byUserId]), [['complete', 0, staff.id]])
  assert.equal(await prisma.revenueShareEntry.count({ where: { bookingId: b } }), 0)
})

const provider = await prisma.user.create({ data: { email: `${tag}-pp@example.test`, passwordHash: 'x', fullName: 'Provider', role: 'superadmin', isActive: true, isPlatformProvider: true } })
await ensurePricesFollowRevenueShare() // 5% markup → 1.250.000/orang

await t('MARKUP: selesai tidak mengoreksi (potensi beku = rencana 100.000, tanpa entri baru); booking selesai tak bisa diatur total', async () => {
  const b = await publish()
  await pay(b, 2_500_000); await travelled(b)
  const before = await prisma.revenueShareEntry.count({ where: { bookingId: b } })
  const r = await completeBooking(b, staff.id)
  assert.deepEqual([r.kind, r.kind === 'done' ? r.shareDeltaCents : null], ['done', 0])
  assert.deepEqual((await events(b)).map(e => Number(e.potentialIdr)), [100_000])
  assert.equal(await prisma.revenueShareEntry.count({ where: { bookingId: b } }), before)
  const s = await bookingShareStatus(prisma, b)
  assert.deepEqual([s.final, s.potentialIdr, s.entitledIdr], [true, 100_000, 100_000])
  await assert.rejects(setBookingTotal({ bookingId: b, totalIdr: 2_000_000, label: 'Diskon', reason: 'uji', byUserId: staff.id }), /aktif/)
})

await t('MARGIN + AKTUAL: koreksi saat selesai (entri completion), beku terhadap pengeluaran sesudahnya; Buka kembali → rencana; selesai lagi → koreksi lagi', async () => {
  const c = await currentRevenueShare()
  await saveRevenueShare({ percent: 5, basis: 'margin', note: null, expectedId: c.id }, provider.id)
  await ensurePricesFollowRevenueShare() // margin: harga kembali 1.200.000/orang
  const b = await publish()
  await pay(b, 2_400_000); await travelled(b)
  const plan = (await bookingShareStatus(prisma, b)).potentialIdr
  assert.equal(plan, 20_000)
  const lines = await prisma.priceSnapshot.findMany({ where: { bookingId: b, voidedAt: null, totalCostIdr: { not: null } }, orderBy: { id: 'asc' } })
  assert.ok(lines.length >= 1)
  const line = lines[0]!
  // aktual baris pertama = rencana + 100.000; pengeluaran lepas 50.000 → margin turun 150.000 → potensi akhir 20.000 − 7.500 = 12.500
  await createCostActual({ bookingId: b, snapshotId: line.id, vendorId: vendor.id, component: 'tiket', currency: 'IDR', amount: Number(line.totalCostIdr) + 100_000, paidAt: today, isSettled: true, varianceNote: 'naik', cashAccount: { kind: 'cash' }, byUserId: staff.id })
  await createCostActual({ bookingId: b, snapshotId: null, vendorId: vendor.id, component: 'lain', currency: 'IDR', amount: 50_000, paidAt: today, cashAccount: { kind: 'cash' }, byUserId: staff.id })
  const r = await completeBooking(b, staff.id)
  assert.deepEqual([r.kind, r.kind === 'done' ? r.shareDeltaCents : null], ['done', -750_000])
  const ev = (await events(b)).at(-1)!
  const last = (await prisma.revenueShareEntry.findMany({ where: { bookingId: b }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).at(-1)!
  assert.deepEqual([last.source, last.refId, Number(last.amountIdr), Number(last.potentialIdr), Number(last.entitledAfterIdr)], ['completion', ev.id, -7_500, 12_500, 12_500])
  // pengeluaran SESUDAH selesai tak mengubah hak (dibekukan di event): sinkron ulang = 0
  await createCostActual({ bookingId: b, snapshotId: null, vendorId: vendor.id, component: 'susulan', currency: 'IDR', amount: 100_000, paidAt: today, cashAccount: { kind: 'cash' }, byUserId: staff.id })
  assert.equal(await prisma.$transaction(tx => syncRevenueShare(tx, b, { source: 'completion', refId: ev.id })), 0)
  assert.deepEqual([(await bookingShareStatus(prisma, b)).potentialIdr, (await bookingShareStatus(prisma, b)).entitledIdr], [12_500, 12_500])
  // Buka kembali → aktif, penanda dikosongkan, hak kembali ke rencana
  const o = await reopenBooking(b, staff.id)
  assert.deepEqual([o.kind, o.kind === 'done' ? o.shareDeltaCents : null], ['done', 750_000])
  const bk = await prisma.booking.findUniqueOrThrow({ where: { id: b } })
  assert.deepEqual([bk.status, bk.completedAt, bk.completedById], ['active', null, null])
  assert.deepEqual([(await bookingShareStatus(prisma, b)).final, (await bookingShareStatus(prisma, b)).entitledIdr], [false, 20_000])
  // selesai lagi → kini termasuk pengeluaran susulan: 20.000 − 5% × (100.000 + 50.000 + 100.000) = 7.500
  const r2 = await completeBooking(b, staff.id)
  assert.equal(r2.kind, 'done')
  assert.deepEqual((await events(b)).map(e => [e.action, Number(e.potentialIdr)]), [['complete', 12_500], ['reopen', 20_000], ['complete', 7_500]])
  assert.equal((await bookingShareStatus(prisma, b)).entitledIdr, 7_500)
})

await t('BUKA KEMBALI ditolak bila akun pemilik dihapus (UU PDP) / nonaktif — booking tetap selesai (audit 13d)', async () => {
  const b = await publish()
  await pay(b, 2_400_000); await travelled(b)
  assert.equal((await completeBooking(b, staff.id)).kind, 'done')
  await prisma.user.update({ where: { id: customer.id }, data: { isActive: false } })
  try {
    assert.equal((await reopenBooking(b, staff.id)).kind, 'owner_unavailable')
  } finally { await prisma.user.update({ where: { id: customer.id }, data: { isActive: true } }) }
  const erased = await prisma.user.create({ data: { email: `deleted-${crypto.randomUUID()}@deleted.invalid`, passwordHash: 'x', fullName: 'x', role: 'pilgrim', isActive: true } })
  await prisma.booking.update({ where: { id: b }, data: { userId: erased.id } })
  assert.equal((await reopenBooking(b, staff.id)).kind, 'owner_unavailable')
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b } })).status, 'completed')
  await prisma.booking.update({ where: { id: b }, data: { userId: customer.id } })
  await prisma.user.delete({ where: { id: erased.id } })
})

await t('DB: event append-only (UPDATE/DELETE/TRUNCATE ditolak), potensi ≥ 0; penanda selesai hanya pada status completed', async () => {
  const e = (await prisma.bookingCompletionEvent.findFirst({ where: { booking: { user: { email: { startsWith: `${tag}-` } } } } }))!
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "booking_completion_events" SET "potentialIdr" = 1 WHERE "id" = $1`, e.id), /append-only/)
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "booking_completion_events" WHERE "id" = $1`, e.id), /append-only/)
  await assert.rejects(prisma.$transaction(async tx => { await tx.$executeRawUnsafe('TRUNCATE "booking_completion_events"'); throw new Error('TRUNCATE lolos') }), /append-only/)
  await assert.rejects(prisma.bookingCompletionEvent.create({ data: { bookingId: e.bookingId, action: 'complete', byUserId: staff.id, potentialIdr: -1 } }), /booking_completion_events_shape/)
  const b = await publish()
  await assert.rejects(prisma.booking.update({ where: { id: b }, data: { completedAt: new Date() } }), /bookings_completed_shape/)
  await assert.rejects(prisma.booking.update({ where: { id: b }, data: { completedById: staff.id } }), /bookings_completed_shape/)
  await assert.rejects(prisma.booking.update({ where: { id: b }, data: { completedPotentialIdr: 1 } }), /bookings_completed_shape/)
})

const SRC = [...files('app'), ...files('components'), ...files('lib')]
await t('PENJAGA: penulis tunggal status completed/penanda/event; route memeriksa sesi sebelum body; event tanpa teks bebas', () => {
  // Penulisan status `completed` ke booking (bentuk apa pun di dalam data booking.update*/upsert) atau penanda/potensi beku — hanya completion.ts.
  const writesCompleted = (src: string) => [...src.matchAll(/booking\.(update|updateMany|upsert)\(\{[\s\S]*?\}\s*\)/g)].some(m => /status:\s*'completed'|completedAt:|completedById:|completedPotentialIdr:/.test(m[0]))
  assert.deepEqual(SRC.filter(f => writesCompleted(read(f)) || /UPDATE\s+"?bookings"?[\s\S]{0,200}'completed'/.test(read(f))), ['lib/booking/completion.ts'])
  assert.deepEqual(SRC.filter(f => /bookingCompletionEvent\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|(INSERT INTO|UPDATE|DELETE FROM)\s+"?booking_completion_events/.test(read(f))), ['lib/booking/completion.ts'])
  const route = read('app/api/v1/admin/bookings/[id]/completion/route.ts')
  assert.ok(route.indexOf('requireBookingComplete()') < route.indexOf('req.json()'), 'sesi sebelum body')
  assert.match(route, /canReopenBooking\(session\.role\)/)
  const model = read('prisma/schema.prisma').split('model BookingCompletionEvent {')[1]?.split('\n}')[0] ?? ''
  assert.doesNotMatch(model, /\b(note|reason|label|description|name)\b/i)
})

} finally {
  await cleanup()
}
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
