// Uji invoice publik Fase 6c (docs/arsitektur-booking-engine-v2.md §10.4): token tautan (benar / diubah / id lain / dicabut / format rusak / draf → null seragam),
// pemuat publik (batas laju per IP dan per token SEBELUM query, data tanpa HPP/catatan staf), notifikasi `invoice_issued` (log tanpa token), dan penjaga sumber
// (noindex/no-store, satu pembuat token, pemanggil notifikasi). PENGAMAN: menulis ke database — hanya DB sekali pakai (assertThrowawayDb).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { repriceOwner, sweepOrphanPricePoints } from '@/lib/pricing/engine'
import { GLOBAL_RULE_KEY } from '@/lib/pricing/pricingHelpers'
import { createDraft, publishDraft, saveDraft } from '@/lib/booking/drafts'
import { invoiceLinkToken, redactInvoiceLinks, resolveInvoiceToken } from '@/lib/invoice/link'
import { revokeInvoiceLink } from '@/lib/invoice/issue'
import { loadPublicInvoice } from '@/lib/invoice/publicView'
import { sendInvoiceNotification } from '@/lib/invoice/notifyInvoice'
import { waMessage } from '@/lib/notifications/events'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `lnk${Date.now()}`

const savedRules = await prisma.pricingRule.findMany()
await prisma.pricingRule.deleteMany({})
await prisma.pricingRule.create({ data: { productType: GLOBAL_RULE_KEY, defaultMarginPercent: 20, roundingIncrement: 50000 } })
const vendor = await prisma.vendor.create({ data: { name: `${tag} vendor`, nameKey: `${tag} vendor`, countryCode: 'SA' } })
const customer = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Pelanggan Tautan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const staff = await prisma.user.create({ data: { email: `${tag}-staf@example.test`, passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
const route = await prisma.flightRoute.create({ data: { origin: `${tag} CGK`, destination: 'JED' } })
const flight = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2090-06-01'), departureTo: new Date('2090-06-30'), totalSeats: 50 } })
await prisma.productCost.create({ data: { productType: 'flight', productId: flight.id, vendorId: vendor.id, costComponent: 'tiket', currency: 'IDR', costTiers: [{ minDays: 0, maxDays: 9999, cost: 5_000_000 }] as never } })
await prisma.preferredVendor.create({ data: { productType: 'flight', productId: flight.id, costComponent: 'tiket', vendorId: vendor.id } })
await repriceOwner('flight', flight.id)

async function published() {
  const c = await createDraft(customer.id); assert.ok(c.ok)
  assert.ok((await saveDraft(c.id, { items: [{ itemType: 'flight', flightScheduleId: flight.id, departureDate: '2090-06-10', numPassengers: 1 }], pilgrims: [{}] })).ok)
  assert.ok((await publishDraft(c.id, { byUserId: staff.id })).ok)
  return c.id
}
const invOf = (bookingId: string) => prisma.invoice.findUniqueOrThrow({ where: { bookingId }, select: { id: true, linkVersion: true } })

await t('TOKEN: tautan benar → booking; satu karakter diubah / id invoice lain / format rusak / kosong → null (tanpa pembeda)', async () => {
  const a = await published(); const b = await published()
  const ta = invoiceLinkToken(await invOf(a))
  assert.deepEqual((await resolveInvoiceToken(ta))?.bookingId, a)
  const last = ta.at(-1) === 'A' ? 'B' : 'A'
  assert.equal(await resolveInvoiceToken(ta.slice(0, -1) + last), null)
  const [, sig] = ta.split('.')
  assert.equal(await resolveInvoiceToken(`${(await invOf(b)).id.replace(/-/g, '')}.${sig}`), null, 'tanda tangan invoice A tak berlaku untuk invoice B')
  for (const bad of ['', 'x', `${ta}x`, ta.replace('.', ''), `${'0'.repeat(32)}.${sig}`, '../../etc/passwd']) assert.equal(await resolveInvoiceToken(bad), null, bad)
  assert.match(ta, /^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/)
})

await t('CABUT: versi tautan naik → tautan LAMA null, tautan BARU berlaku; booking draf tak pernah punya tautan', async () => {
  const id = await published()
  const old = invoiceLinkToken(await invOf(id))
  assert.deepEqual(await revokeInvoiceLink(id), { linkVersion: 2 })
  assert.equal(await resolveInvoiceToken(old), null)
  assert.equal((await resolveInvoiceToken(invoiceLinkToken(await invOf(id))))?.bookingId, id)
  assert.equal(await revokeInvoiceLink('00000000-0000-4000-8000-000000000000'), null)
  const inv = await invOf(id)
  await prisma.booking.update({ where: { id }, data: { status: 'cancelled' } })
  assert.ok(await resolveInvoiceToken(invoiceLinkToken(inv)), 'booking batal tetap bisa dilihat (status terkini, P3)')
})

await t('PEMUAT PUBLIK: data invoice tanpa HPP/modal/catatan staf; batas laju per IP menolak SEBELUM membaca token; token tak dikenal → not_found', async () => {
  const id = await published()
  const token = invoiceLinkToken(await invOf(id))
  const r = await loadPublicInvoice(token, `198.51.100.${Date.now() % 250}`)
  assert.equal(r.kind, 'ok')
  if (r.kind !== 'ok') return
  const json = JSON.stringify(r.data)
  for (const bad of ['unitCostIdr', 'totalCostIdr', 'costKnown', 'recommended', 'reason', 'voidReason', 'passport', 'Paspor', 'fieldValues', 'HPP']) assert.ok(!json.includes(bad), `bocor: ${bad}`)
  assert.equal((await loadPublicInvoice(`${'0'.repeat(32)}.${'A'.repeat(43)}`, '198.51.100.251')).kind, 'not_found')
  const ip = `203.0.113.${Date.now() % 250}`
  let limited = false
  for (let i = 0; i < 65 && !limited; i++) limited = (await loadPublicInvoice('rusak', ip)).kind === 'limited'
  assert.ok(limited, 'batas per IP (60/10 menit) harus menolak')
})

await t('NOTIFIKASI: `invoice_issued` WhatsApp memuat tautan https saja; log notifikasi menyamarkan tautan; kirim ulang tanpa dedupe tercatat lagi', async () => {
  const msg = waMessage({ type: 'invoice_issued', code: 'SND-1', number: 'INV-1', total: 'Rp 1', dueDate: '1 Jan', path: '/id/invoice/x' })
  assert.ok(msg && msg.includes('INV-1'))
  const bad = waMessage({ type: 'invoice_issued', code: 'SND-1', number: 'INV-1', total: 'Rp 1', dueDate: null, path: null })
  assert.ok(bad && !/invoice\//.test(bad))
  const tok = `${'a'.repeat(32)}.${'B'.repeat(43)}`
  assert.equal(redactInvoiceLinks(`lihat https://x.test/id/invoice/${tok} ya`), 'lihat https://x.test/id/invoice/[tautan] ya')
  const id = await published()
  assert.equal(await sendInvoiceNotification(id, { dedupe: false }), true)
  assert.equal(await sendInvoiceNotification('00000000-0000-4000-8000-000000000000', { dedupe: false }), false)
  const logs = await prisma.notificationLog.findMany({ where: { bookingId: id, type: 'invoice_issued' } })
  assert.ok(logs.length >= 1, 'notifikasi tercatat')
  for (const l of logs) assert.ok(!/[0-9a-f]{32}\.[A-Za-z0-9_-]{43}/.test(`${l.messagePreview ?? ''}${l.recipient}`), 'token tak boleh masuk log')
})

await t('PENJAGA: halaman & PDF publik noindex/no-store/no-referrer; satu pembuat token; terbit draf & checkout jamaah memanggil notifikasi invoice; halaman publik tak mengimpor admin', () => {
  const cfg = read('next.config.ts')
  for (const h of ["'private, no-store'", "'noindex, nofollow'", "'no-referrer'", "'/:locale/invoice/:token*'", "'/api/v1/invoice/:token*'"]) assert.ok(cfg.includes(h), h)
  const page = read('app/[locale]/invoice/[token]/page.tsx')
  assert.match(page, /robots: \{ index: false, follow: false \}/)
  assert.doesNotMatch(page, /admin/)
  assert.match(read('lib/invoice/publicView.ts'), /consume\(policy\('invoicePublicIp'[\s\S]*consume\(policy\('invoicePublicToken'[\s\S]*resolveInvoiceToken/)
  assert.match(read('app/api/v1/admin/bookings/drafts/[id]/publish/route.ts'), /sendInvoiceNotification\(r\.id, \{ dedupe: true \}\)/)
  assert.match(read('app/api/v1/bookings/route.ts'), /sendInvoiceNotification\(booking\.id, \{ dedupe: true \}\)/)
  assert.match(read('lib/notifications/notify.ts'), /redactInvoiceLinks\(wa\)/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.notificationLog.deleteMany({ where: { userId: customer.id } })
await prisma.booking.deleteMany({ where: { userId: customer.id } })
await prisma.flightSchedule.deleteMany({ where: { routeId: route.id } })
await prisma.flightRoute.delete({ where: { id: route.id } })
await prisma.productCost.deleteMany({ where: { vendorId: vendor.id } })
await prisma.preferredVendor.deleteMany({ where: { vendorId: vendor.id } })
await sweepOrphanPricePoints()
await prisma.vendor.delete({ where: { id: vendor.id } })
await prisma.user.deleteMany({ where: { id: { in: [customer.id, staff.id] } } })
await prisma.pricingRule.deleteMany({})
for (const r of savedRules) await prisma.pricingRule.create({ data: { productType: r.productType, defaultMarginPercent: r.defaultMarginPercent, roundingIncrement: r.roundingIncrement, warnBelowPercent: r.warnBelowPercent } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
