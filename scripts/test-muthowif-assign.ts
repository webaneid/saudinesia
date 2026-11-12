// Penugasan muthowif per ITEM (docs/arsitektur-booking-engine-v2.md §10.8, 11d-2b — temuan G4): booking berrombongan bisa memuat beberapa layanan
// muthowif; rute assign WAJIB menyebut itemnya. Dulu rute memakai item pertama yang belum ditugaskan, jadi panel rombongan B bisa menugaskan item A.
// Handler dipanggil langsung (sesi admin di-stub) atas database sekali pakai.
import assert from 'node:assert/strict'
import { assertThrowawayDb } from './lib/testDb'

// `bun:test` tak punya deklarasi tipe di proyek ini (bun-types tak dipasang) — diimpor dinamis dengan bentuk minimal yang dipakai.
const { mock } = (await import(String('bun:test'))) as { mock: { module: (path: string, factory: () => unknown) => void } }
mock.module('@/lib/auth/session', () => ({ requireAdmin: async () => ({ userId: 'x', role: 'admin' }) }))
const { prisma } = await import('@/lib/db')
const { POST } = await import('../app/api/v1/admin/bookings/[id]/muthowif/assign/route')
await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `mta${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji Muthowif', role: 'pilgrim', isActive: true } })
const guide = await prisma.muthowif.create({ data: { name: `${tag} Ustadz`, dailyCapacity: 50 } })
const mk = async (code: string) => prisma.booking.create({ data: { bookingCode: `${tag}${code}`, userId: user.id, status: 'active', season: 'regular', totalAmount: 0 } })
const b = await mk('A'); const other = await mk('B')
const item = (bookingId: string) => prisma.bookingMuthowif.create({ data: { bookingId, startDate: new Date('2090-06-10'), endDate: new Date('2090-06-11'), numDays: 2, numPeople: 2, totalPrice: 0 } })
const first = await item(b.id); const second = await item(b.id); const foreign = await item(other.id)
const call = (bookingId: string, body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: bookingId }) })

await t('item KEDUA ditugaskan tepat (bukan item pertama yang belum ditugaskan)', async () => {
  const res = await call(b.id, { bookingMuthowifId: second.id, muthowifId: guide.id })
  assert.equal(res.status, 200)
  const rows = await prisma.bookingMuthowif.findMany({ where: { bookingId: b.id }, select: { id: true, muthowifId: true } })
  assert.equal(rows.find(r => r.id === second.id)?.muthowifId, guide.id)
  assert.equal(rows.find(r => r.id === first.id)?.muthowifId, null)
})
await t('DITOLAK: tanpa item (400), kunci liar (400), item booking lain (404), item sudah ditugaskan (404), muthowif tak ada (404 tanpa nama model)', async () => {
  assert.equal((await call(b.id, { muthowifId: guide.id })).status, 400)
  assert.equal((await call(b.id, { bookingMuthowifId: first.id, muthowifId: guide.id, extra: 1 })).status, 400)
  assert.equal((await call(b.id, { bookingMuthowifId: foreign.id, muthowifId: guide.id })).status, 404)
  assert.equal((await call(b.id, { bookingMuthowifId: second.id, muthowifId: guide.id })).status, 404)
  const missing = await call(b.id, { bookingMuthowifId: first.id, muthowifId: '00000000-0000-4000-8000-000000000000' })
  assert.equal(missing.status, 404)
  assert.doesNotMatch(JSON.stringify(await missing.json()), /Muthowif\b.*found|prisma|findUnique/i)
  assert.equal((await prisma.bookingMuthowif.findUniqueOrThrow({ where: { id: foreign.id } })).muthowifId, null)
})

await t('DITOLAK 409 (bukan 500): kapasitas muthowif habis dan muthowif nonaktif — galat domain dikenali dari kelasnya (SEC-229)', async () => {
  const small = await prisma.muthowif.create({ data: { name: `${tag} Kecil`, dailyCapacity: 1 } })
  const full = await call(b.id, { bookingMuthowifId: first.id, muthowifId: small.id })
  assert.equal(full.status, 409)
  assert.match(((await full.json()) as { error: string }).error, /tidak cukup|tersisa/i)
  const off = await prisma.muthowif.create({ data: { name: `${tag} Nonaktif`, dailyCapacity: 50, isActive: false } })
  const inactive = await call(b.id, { bookingMuthowifId: first.id, muthowifId: off.id })
  assert.equal(inactive.status, 409)
  assert.equal(((await inactive.json()) as { error: string }).error, 'Muthowif tidak aktif')
  assert.equal((await prisma.bookingMuthowif.findUniqueOrThrow({ where: { id: first.id } })).muthowifId, null)
  await prisma.muthowifAvailability.deleteMany({ where: { muthowifId: { in: [small.id, off.id] } } })
  await prisma.muthowif.deleteMany({ where: { id: { in: [small.id, off.id] } } })
})

await prisma.booking.deleteMany({ where: { userId: user.id } })
await prisma.muthowifAvailability.deleteMany({ where: { muthowifId: guide.id } })
await prisma.muthowif.delete({ where: { id: guide.id } })
await prisma.user.delete({ where: { id: user.id } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
