// Uji isian TAMBAHAN jamaah booking oleh pemesan (audit front-end 2026-11-11, docs/arsitektur-frontend-publik.md §8):
// lib/pilgrims/extraFields.ts `saveExtraFields` + route PUT /api/v1/bookings/[id]/pilgrims/[pilgrimId].
// Yang dibuktikan: hanya pemilik booking AKTIF; kolom berperan kartu (nama, NIK, …) dan kolom asing DITOLAK; isian lama dipertahankan (merge);
// data yang sedang/sudah diperiksa terkunci; kelengkapan yang dikembalikan menghitung semua kolom; route memanggil gerbang pemesan.
// DB sekali pakai (assertThrowawayDb).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { saveExtraFields } from '@/lib/pilgrims/extraFields'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const tag = `xf${Date.now()}`
let n = 0
const users: string[] = []
async function makeUser(): Promise<string> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role: 'pilgrim', emailVerifiedAt: new Date() }, select: { id: true } })
  users.push(u.id)
  return u.id
}
const owner = await makeUser()
const stranger = await makeUser()

const visa = await prisma.visaProduct.create({ data: { name: `${tag} visa`, visaType: 'Umroh' } })
const F = (fieldKey: string, fieldType: string, role: string | null, order: number, required = true) => ({ productType: 'visa', productId: visa.id, fieldKey, label: fieldKey, fieldType, role, order, required })
await prisma.manifestFieldRequirement.createMany({ data: [
  F('fullName', 'text', 'display_name', 0), F('nik', 'text', 'nik', 1),
  F('hostPhone', 'phone', null, 2), F('shortAddress', 'text', null, 3), F('note', 'text', null, 4, false),
] })

async function makeBooking(status: 'active' | 'completed' = 'active', fieldValues: Record<string, unknown> = {}) {
  const b = await prisma.booking.create({
    data: { bookingCode: `BK-${tag}-${++n}`, userId: owner, status, season: 'regular', totalAmount: 1, pilgrims: { create: [{ isLeader: true, fieldValues: fieldValues as never }] } },
    include: { pilgrims: { select: { id: true } } },
  })
  const pid = b.pilgrims[0]!.id
  await prisma.visaApplication.create({ data: { bookingPilgrimId: pid, visaType: 'umrah', visaProductId: visa.id } })
  return { id: b.id, pilgrim: pid }
}
const valuesOf = async (id: string) => (await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id }, select: { fieldValues: true } })).fieldValues as Record<string, unknown>

await t('pemilik mengisi kolom tambahan; isian lama (nama dari kartu) dipertahankan; kelengkapan menghitung semua kolom wajib', async () => {
  const b = await makeBooking('active', { fullName: 'Budi' })
  const r = await saveExtraFields(owner, b.id, b.pilgrim, { hostPhone: { countryCode: 'SA', number: '501234567' }, shortAddress: 'RRRD2929' })
  assert.ok(r.ok, JSON.stringify(r))
  assert.deepEqual(r.completeness.missing, ['nik'], 'nik (kartu) masih kosong — dihitung')
  const v = await valuesOf(b.pilgrim)
  assert.equal(v.fullName, 'Budi')
  assert.equal(v.shortAddress, 'RRRD2929')
  assert.deepEqual(v.hostPhone, { countryCode: 'SA', number: '501234567' })
})

await t('kolom berperan kartu (nama, NIK) DITOLAK 400 — tak ada jalur pemesan untuk menulis NIK tanpa kartu; nilai tak berubah', async () => {
  const b = await makeBooking('active', { fullName: 'Budi' })
  for (const [key, value] of [['fullName', 'Orang Lain'], ['nik', '3201011507850001']] as const) {
    const r = await saveExtraFields(owner, b.id, b.pilgrim, { [key]: value })
    assert.ok(!r.ok && r.status === 400 && r.field === key, `${key}: ${JSON.stringify(r)}`)
  }
  assert.deepEqual(await valuesOf(b.pilgrim), { fullName: 'Budi' })
  const row = await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: b.pilgrim }, select: { nikHash: true, nikCipher: true } })
  assert.deepEqual(row, { nikHash: null, nikCipher: null })
})

await t('kolom asing 400; bentuk salah 400', async () => {
  const b = await makeBooking()
  const a = await saveExtraFields(owner, b.id, b.pilgrim, { tidakAda: 'x' })
  assert.ok(!a.ok && a.status === 400 && a.field === 'tidakAda')
  const c = await saveExtraFields(owner, b.id, b.pilgrim, { hostPhone: 'bukan objek' })
  assert.ok(!c.ok && c.status === 400 && c.field === 'hostPhone')
})

await t('booking akun lain → 404 (sama dengan tidak ada); jamaah booking lain → 404', async () => {
  const b = await makeBooking()
  const other = await makeBooking()
  const s = await saveExtraFields(stranger, b.id, b.pilgrim, { shortAddress: 'X' })
  assert.ok(!s.ok && s.status === 404)
  const mixed = await saveExtraFields(owner, b.id, other.pilgrim, { shortAddress: 'X' })
  assert.ok(!mixed.ok && mixed.status === 404)
  assert.deepEqual(await valuesOf(b.pilgrim), {})
})

await t('booking tidak aktif → 409; data diajukan/terverifikasi terkunci → 409', async () => {
  const done = await makeBooking('completed')
  const r = await saveExtraFields(owner, done.id, done.pilgrim, { shortAddress: 'X' })
  assert.ok(!r.ok && r.status === 409)
  for (const status of ['submitted', 'verified'] as const) {
    const b = await makeBooking()
    await prisma.bookingPilgrim.update({ where: { id: b.pilgrim }, data: { reviewStatus: status, submittedAt: new Date(), ...(status === 'verified' && { verifiedAt: new Date(), verifiedById: owner }) } })
    const x = await saveExtraFields(owner, b.id, b.pilgrim, { shortAddress: 'X' })
    assert.ok(!x.ok && x.status === 409, `${status}: ${JSON.stringify(x)}`)
  }
  const back = await makeBooking()
  await prisma.bookingPilgrim.update({ where: { id: back.pilgrim }, data: { reviewStatus: 'needs_revision', submittedAt: new Date() } })
  assert.ok((await saveExtraFields(owner, back.id, back.pilgrim, { shortAddress: 'Y' })).ok, 'perlu perbaikan = boleh diubah')
})

await t('PENJAGA route: sesi pemesan, gerbang onboarding, batas IP, skema strict, penulis tunggal saveExtraFields', () => {
  const src = readFileSync('app/api/v1/bookings/[id]/pilgrims/[pilgrimId]/route.ts', 'utf8')
  const put = src.slice(src.indexOf('export async function PUT'), src.indexOf('export async function DELETE'))
  for (const needle of ['requirePilgrimActor()', 'onboardingRefusal(', 'ipLimited(', 'saveExtraFields(', 'routeFailure(']) assert.ok(put.includes(needle), needle)
  assert.match(src, /extraSchema = z\.object\([\s\S]*?\}\)\.strict\(\)/)
  const lib = readFileSync('lib/pilgrims/extraFields.ts', 'utf8')
  assert.ok(lib.includes('cardBoundKeys(') && lib.includes('FOR SHARE') && lib.includes('FOR UPDATE') && lib.includes('isReviewLocked('))
  assert.ok(!/sealManualPii|nikHash|passportCipher/.test(lib.replace(/\/\/.*$/gm, '')), 'jalur pemesan tak menyentuh kolom tersegel')
})

// ── pembersihan (DB uji) ────────────────────────────────────────────────────────────────────────────────────────────
await prisma.visaApplication.deleteMany({ where: { pilgrim: { booking: { userId: { in: users } } } } })
await prisma.booking.deleteMany({ where: { userId: { in: users } } })
await prisma.manifestFieldRequirement.deleteMany({ where: { productId: visa.id } })
await prisma.visaProduct.delete({ where: { id: visa.id } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()

if (failed > 0) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
