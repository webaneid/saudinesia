// Uji penjaga perubahan akun oleh superadmin (SEC-13) terhadap DATABASE SUNGGUHAN: tak boleh mengubah diri sendiri, tak boleh
// menyisakan sistem tanpa superadmin aktif — termasuk saat dua superadmin saling menurunkan SECARA BERSAMAAN.
//
// PENGAMAN: menulis user sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { updateUserByAdmin } from '@/lib/auth/adminUsers'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`)
  }
}

const tag = `au${Date.now()}`
let n = 0
const mk = (extra: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: { email: `${tag}-${++n}@example.test`, passwordHash: '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012', fullName: 'Uji Admin', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), ...extra },
  })

// Isolasi: superadmin aktif yang sudah ada di DB uji dinonaktifkan sementara (langsung lewat Prisma) supaya hitungan "terakhir" terkendali; dipulihkan di akhir.
const preexisting = await prisma.user.findMany({ where: { role: 'superadmin', isActive: true, email: { not: { startsWith: tag } } }, select: { id: true } })
await prisma.user.updateMany({ where: { id: { in: preexisting.map(u => u.id) } }, data: { isActive: false } })

const state = async (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true, isActive: true, sessionVersion: true } })

console.log('== diri sendiri ==')

await t('superadmin tidak boleh menurunkan perannya / menonaktifkan dirinya sendiri → self, tak ada yang berubah', async () => {
  const a = await mk({ role: 'superadmin' }); await mk({ role: 'superadmin' }) // ada superadmin lain: murni aturan "diri sendiri"
  assert.deepEqual(await updateUserByAdmin(a.id, { role: 'admin' }, a.id), { ok: false, reason: 'self' })
  assert.deepEqual(await updateUserByAdmin(a.id, { isActive: false }, a.id), { ok: false, reason: 'self' })
  assert.deepEqual(await state(a.id), { role: 'superadmin', isActive: true, sessionVersion: 0 })
})

await t('permintaan atas diri sendiri yang tidak mengubah apa pun (no-op) tetap sah', async () => {
  const a = await mk({ role: 'superadmin' })
  const r = await updateUserByAdmin(a.id, { role: 'superadmin', isActive: true }, a.id)
  assert.equal(r.ok, true)
})

console.log('== superadmin terakhir ==')

await t('menurunkan / menonaktifkan superadmin aktif TERAKHIR (oleh aktor lain) → last_superadmin; kontrol positif: dengan 2 superadmin lolos', async () => {
  await prisma.user.updateMany({ where: { email: { startsWith: tag }, role: 'superadmin' }, data: { isActive: false } })
  const actor = await mk({ role: 'admin' }) // aktor bukan superadmin → kasus sintetis: yang dijaga adalah invarian, bukan identitas aktor
  const last = await mk({ role: 'superadmin' })
  assert.deepEqual(await updateUserByAdmin(last.id, { role: 'manager' }, actor.id), { ok: false, reason: 'last_superadmin' })
  assert.deepEqual(await updateUserByAdmin(last.id, { isActive: false }, actor.id), { ok: false, reason: 'last_superadmin' })
  assert.deepEqual(await state(last.id), { role: 'superadmin', isActive: true, sessionVersion: 0 })
  const second = await mk({ role: 'superadmin' })
  const r = await updateUserByAdmin(last.id, { role: 'manager' }, second.id)
  assert.equal(r.ok, true)
  assert.equal((await state(last.id)).role, 'manager')
  assert.deepEqual(await updateUserByAdmin(second.id, { isActive: false }, last.id), { ok: false, reason: 'last_superadmin' }) // kini second yang terakhir
})

await t('superadmin NONAKTIF tidak dihitung sebagai cadangan; mengubah akun non-superadmin tidak pernah ditolak', async () => {
  await prisma.user.updateMany({ where: { email: { startsWith: tag }, role: 'superadmin' }, data: { isActive: false } })
  const a = await mk({ role: 'superadmin' })
  await mk({ role: 'superadmin', isActive: false })
  assert.deepEqual(await updateUserByAdmin(a.id, { isActive: false }, null), { ok: false, reason: 'last_superadmin' })
  const p = await mk({ role: 'pilgrim' })
  assert.equal((await updateUserByAdmin(p.id, { role: 'admin' }, a.id)).ok, true)
  assert.equal((await updateUserByAdmin(p.id, { isActive: false }, a.id)).ok, true)
})

await t('dua superadmin saling menurunkan BERSAMAAN: tepat satu lolos, sistem tetap punya superadmin aktif (kunci berserial)', async () => {
  for (let round = 0; round < 15; round++) {
    await prisma.user.updateMany({ where: { email: { startsWith: tag }, role: 'superadmin' }, data: { isActive: false } })
    const a = await mk({ role: 'superadmin' }); const b = await mk({ role: 'superadmin' })
    const [ra, rb] = await Promise.all([updateUserByAdmin(b.id, { role: 'admin' }, a.id), updateUserByAdmin(a.id, { role: 'admin' }, b.id)])
    assert.equal([ra, rb].filter(r => r.ok).length, 1, `putaran ${round}: tepat satu harus lolos, dapat ${JSON.stringify([ra, rb])}`)
    const left = await prisma.user.count({ where: { id: { in: [a.id, b.id] }, role: 'superadmin', isActive: true } })
    assert.equal(left, 1, `putaran ${round}: harus tersisa tepat 1 superadmin aktif`)
  }
})

console.log('== perilaku lama tetap ==')

await t('perubahan nyata menaikkan sessionVersion; id tak ada → not_found', async () => {
  const a = await mk({ role: 'superadmin' }); const p = await mk()
  assert.equal((await updateUserByAdmin(p.id, { role: 'admin' }, a.id)).ok, true)
  assert.equal((await state(p.id)).sessionVersion, 1)
  assert.deepEqual(await updateUserByAdmin('00000000-0000-0000-0000-000000000000', { isActive: false }, a.id), { ok: false, reason: 'not_found' })
})

console.log('== penjaga sumber ==')

await t('route meneruskan session.userId sebagai aktor dan memetakan self/last_superadmin ke 422', async () => {
  const src = readFileSync(new URL('../app/api/v1/admin/system/users/[id]/route.ts', import.meta.url), 'utf8')
  assert.match(src, /updateUserByAdmin\(id, parsed\.data, session\.userId\)/)
  assert.match(src, /status: 422/)
})

await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.user.updateMany({ where: { id: { in: preexisting.map(u => u.id) } }, data: { isActive: true } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
