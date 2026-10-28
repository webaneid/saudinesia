// Pelanggan di dashboard admin (docs/arsitektur-pelanggan.md): pembaca `lib/customers/query.ts` terhadap DATABASE SUNGGUHAN + penjaga sumber halaman.
// Dibuktikan: hanya role pilgrim (staf tak pernah muncul), pencarian nama/email/HP (nomor lokal 08… cocok E.164 62…), filter aktif/email/pesanan, agregat pesanan & total dibayar
// (hanya pembayaran `confirmed`), halaman stabil, akun terhapus ditandai, detail non-pilgrim → null, kolom rahasia tak pernah keluar, alamat dirangkai, halaman dijaga requireAdminPage, menu untuk semua admin.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { getCustomer, listCustomers } from '@/lib/customers/query'
import { parseListParams } from '@/lib/admin/pagination'
import { getAdminNavigation } from '@/lib/admin/navigation'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const tag = `cu${Date.now().toString(36)}`
const ids: string[] = []
const mk = async (key: string, over: Record<string, unknown> = {}) => {
  const u = await prisma.user.create({ data: { email: `${tag}-${key}@example.test`, passwordHash: 'SECRET-HASH', fullName: `${tag} ${key}`, role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), ...over } as never })
  ids.push(u.id)
  return u
}
const list = (f: Parameters<typeof listCustomers>[0], q = tag, p = 'page=1&limit=100') => listCustomers({ q, ...f }, parseListParams(new URLSearchParams(p)))

const alice = await mk('alice', { phone: '6281234567890', whatsapp: '6281234567890', whatsappVerifiedAt: new Date(), googleSub: `${tag}-sub` })
const budi = await mk('budi', { isActive: false, emailVerifiedAt: null })
const citra = await mk('citra')
const staff = await mk('staff', { role: 'admin' })
const gone = await prisma.user.create({ data: { email: `deleted-${tag}@deleted.invalid`, passwordHash: 'x', fullName: 'Akun Dihapus', role: 'pilgrim', isActive: false } })
ids.push(gone.id)

const bk = async (userId: string, code: string, total: number, status: 'awaiting_payment' | 'confirmed' | 'cancelled' = 'confirmed') =>
  prisma.booking.create({ data: { bookingCode: `${tag}-${code}`, userId, status, departureDate: new Date('2091-01-01'), returnDate: new Date('2091-01-10'), season: 'regular', totalAmount: total } })
const pay = (bookingId: string, amount: number, status: 'pending' | 'confirmed' | 'rejected') => prisma.payment.create({ data: { bookingId, amount, method: 'bank_transfer', status } })
const b1 = await bk(alice.id, 'a1', 5_000_000)
const b2 = await bk(alice.id, 'a2', 3_000_000, 'awaiting_payment')
await pay(b1.id, 5_000_000, 'confirmed'); await pay(b2.id, 1_000_000, 'pending'); await pay(b2.id, 700_000, 'rejected'); await pay(b2.id, 300_000, 'confirmed')
await bk(budi.id, 'b1', 2_000_000, 'cancelled')

await t('hanya pelanggan (role pilgrim): staf dan admin tak pernah muncul; akun terhapus ditandai dan tanpa data', async () => {
  const r = await list({})
  const emails = r.items.map(i => i.email)
  assert.ok(!emails.includes(staff.email))
  assert.deepEqual(r.items.map(i => i.id).sort(), [alice.id, budi.id, citra.id, gone.id].sort(), 'pencarian memakai tag, akun terhapus ikut karena emailnya memuat tag')
  const all = await list({}, '')
  const g = all.items.find(i => i.id === gone.id)!
  assert.equal(g.deleted, true)
  assert.equal(all.items.some(i => i.id === staff.id), false)
})
await t('pencarian: nama, email, nomor lokal (0812… cocok 62812…), WhatsApp; nilai aneh/wildcard tak meledak', async () => {
  assert.deepEqual((await list({}, `${tag} alice`)).items.map(i => i.id), [alice.id])
  assert.deepEqual((await list({}, `${tag}-budi@EXAMPLE`)).items.map(i => i.id), [budi.id])
  assert.deepEqual((await list({}, '0812-3456-7890')).items.filter(i => i.id === alice.id).length, 1)
  assert.deepEqual((await list({}, '6281234567890')).items.filter(i => i.id === alice.id).length, 1)
  for (const q of ['%', '_', "'; drop table users;--", '\\', 'x'.repeat(500)]) assert.equal((await list({}, q)).items.length, 0, `wildcard/injeksi harus literal: ${q.slice(0, 12)}`)
})
await t('filter: aktif/nonaktif, email terverifikasi/belum, pernah/belum memesan (kombinasi menyaring bersama)', async () => {
  const ids2 = async (f: Parameters<typeof listCustomers>[0]) => (await list(f)).items.map(i => i.id).sort()
  assert.deepEqual(await ids2({ active: 'inactive' }), [budi.id, gone.id].sort())
  assert.deepEqual(await ids2({ active: 'active' }), [alice.id, citra.id].sort())
  assert.deepEqual(await ids2({ email: 'unverified' }), [budi.id, gone.id].sort())
  assert.deepEqual(await ids2({ email: 'verified' }), [alice.id, citra.id].sort())
  assert.deepEqual(await ids2({ bookings: 'with' }), [alice.id, budi.id].sort())
  assert.deepEqual(await ids2({ bookings: 'without' }), [citra.id, gone.id].sort())
  assert.deepEqual(await ids2({ active: 'active', bookings: 'with' }), [alice.id])
})
await t('agregat: jumlah pesanan semua status; total dibayar HANYA pembayaran terkonfirmasi (5.000.000 + 300.000), pending/ditolak tak ikut; tanpa pesanan = 0', async () => {
  const r = Object.fromEntries((await list({})).items.map(i => [i.id, [i.bookingCount, i.paidIdr]]))
  assert.deepEqual([r[alice.id], r[budi.id], r[citra.id]], [[2, 5_300_000], [1, 0], [0, 0]])
})
await t('halaman: ukuran/halaman stabil tanpa duplikat atau lompatan; halaman melewati batas dijepit ke terakhir', async () => {
  const seen: string[] = []
  for (let p = 1; p <= 4; p++) seen.push(...(await list({}, tag, `page=${p}&limit=1`)).items.map(i => i.id))
  assert.equal(new Set(seen).size, 4)
  const last = await list({}, tag, 'page=99&limit=1')
  assert.deepEqual([last.meta.page, last.meta.total, last.items.length], [4, 4, 1])
})
await t('detail: profil, penanda Google (boolean), pesanan terbaru dulu, ringkasan pembayaran per status; non-pilgrim dan id tak ada → null', async () => {
  const d = (await getCustomer(alice.id))!
  assert.deepEqual([d.googleLinked, d.emailVerified, d.whatsappVerified, d.bookingCount, d.paidIdr], [true, true, true, 2, 5_300_000])
  assert.deepEqual(d.payments, { confirmedIdr: 5_300_000, confirmedCount: 2, pendingCount: 1, rejectedCount: 1 })
  assert.deepEqual(d.bookings.map(b => b.bookingCode), [`${tag}-a2`, `${tag}-a1`])
  assert.equal(await getCustomer(staff.id), null)
  assert.equal(await getCustomer('00000000-0000-0000-0000-000000000000'), null)
  assert.equal((await getCustomer(gone.id))!.deleted, true)
})
await t('detail tak pernah membocorkan rahasia: hasil serialisasi tak memuat passwordHash/googleSub/token/sessionVersion', async () => {
  const json = JSON.stringify({ d: await getCustomer(alice.id), l: await list({}) })
  for (const bad of ['SECRET-HASH', `${tag}-sub`, 'passwordHash', 'googleSub', 'sessionVersion']) assert.ok(!json.includes(bad), `bocor: ${bad}`)
})
await t('alamat dirangkai: domestik dan internasional; belum diisi = null', async () => {
  const dom = await prisma.address.create({ data: { type: 'domestic', fullAddress: 'Jl. Melati 5 RT 02', postalCode: '12345' } })
  const intl = await prisma.address.create({ data: { type: 'international', fullAddress: '12 Orchard Rd', city: 'Singapore', countryCode: 'SG', postalCode: '238888' } })
  try {
    await prisma.user.update({ where: { id: citra.id }, data: { addressId: dom.id } })
    assert.equal((await getCustomer(citra.id))!.address, 'Jl. Melati 5 RT 02, 12345')
    await prisma.user.update({ where: { id: citra.id }, data: { addressId: intl.id } })
    assert.equal((await getCustomer(citra.id))!.address, '12 Orchard Rd, Singapore, 238888, Singapura')
    assert.equal((await getCustomer(budi.id))!.address, null)
  } finally {
    await prisma.user.update({ where: { id: citra.id }, data: { addressId: null } })
    await prisma.address.deleteMany({ where: { id: { in: [dom.id, intl.id] } } })
  }
})
await t('PENJAGA SUMBER: halaman Pelanggan memanggil requireAdminPage lebih dulu dan tak membaca Prisma sendiri; pembaca tak memilih passwordHash; menu Pelanggan terbuka untuk SEMUA peran admin', () => {
  for (const f of ['app/[locale]/admin/(protected)/customers/page.tsx', 'app/[locale]/admin/(protected)/customers/[id]/page.tsx']) {
    const src = readFileSync(join(root, f), 'utf8')
    assert.match(src, /await requireAdminPage\(locale\)/, f)
    assert.ok(src.indexOf('requireAdminPage(locale)') < src.search(/listCustomers\(|getCustomer\(/), `${f}: guard harus lebih dulu dari pembacaan`)
    assert.doesNotMatch(src, /prisma\b/, `${f}: halaman membaca lewat lib/customers/query.ts`)
    assert.doesNotMatch(src, /passwordHash|googleSub|sessionVersion/)
  }
  const q = readFileSync(join(root, 'lib/customers/query.ts'), 'utf8')
  assert.doesNotMatch(q.replace(/\/\/.*$/gm, ''), /passwordHash|sessionVersion|authToken/)
  assert.match(q, /role: 'pilgrim'/)
  const hasMenu = (isManager: boolean, isSuperAdmin: boolean) => getAdminNavigation({ isManager, isSuperAdmin }).flatMap(g => g.items).some(i => i.path === '/admin/customers')
  assert.deepEqual([hasMenu(false, false), hasMenu(true, false), hasMenu(true, true)], [true, true, true])
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.payment.deleteMany({ where: { booking: { userId: { in: ids } } } })
await prisma.booking.deleteMany({ where: { userId: { in: ids } } })
await prisma.user.deleteMany({ where: { id: { in: ids } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
