// Penjaga jejak keamanan staf (docs/rencana-audit-golive.md §6, SEC-304) terhadap DATABASE SUNGGUHAN (sekali pakai).
// - Setiap jalur menulis tepat satu baris; tanpa perubahan = tanpa baris; ringkasan tanpa nama/email.
// - Login: hanya staf (berhasil + gagal); jamaah tak tercatat; email tak dikenal tak tercatat.
// - Tabel append-only (UPDATE/DELETE ditolak trigger), aksi di luar daftar ditolak CHECK.
// - Penampil superadmin klien tak melihat kejadian akun bayangan Platform Provider.
// - Pemindai sumber: hanya lib/audit/staff.ts yang menulis `staffAuditEvent`; route yang wajib berjejak memanggil `recordStaffEvent`.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { updateUserByAdmin } from '@/lib/auth/adminUsers'
import { STAFF_AUDIT_ACTIONS, auditIp, countStaffEvents, listStaffEvents, recordStaffEvent } from '@/lib/audit/staff'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

const tag = `sa${Date.now()}`
let n = 0
const PW = 'Sandi-Uji-Benar1!'
const pwHash = await hash(PW, 4)
const mk = (extra: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: pwHash, fullName: `Nama Rahasia ${tag} ${n}`, role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), ...extra } })
const eventsFor = (userId: string) => prisma.staffAuditEvent.findMany({ where: { OR: [{ actorId: userId }, { targetUserId: userId }] }, orderBy: [{ at: 'asc' }, { id: 'asc' }] })
const as = (userId: string) => ({ userId, isPlatformProvider: false })

console.log('== ubah akun staf ==')
await t('ubah peran/status → satu baris staff_update (lama → baru, IP); tanpa perubahan → tak ada baris; nama hanya "berubah"', async () => {
  const actor = await mk({ role: 'superadmin' }); await mk({ role: 'superadmin' })
  const target = await mk({ role: 'admin' })
  assert.equal((await updateUserByAdmin(target.id, { role: 'manager' }, as(actor.id), { ip: '203.0.113.9' })).ok, true)
  assert.equal((await updateUserByAdmin(target.id, { role: 'manager', isActive: true }, as(actor.id))).ok, true) // no-op
  assert.equal((await updateUserByAdmin(target.id, { fullName: 'Nama Baru Sekali' }, as(actor.id))).ok, true)
  const rows = await eventsFor(target.id)
  assert.equal(rows.length, 2, JSON.stringify(rows))
  assert.deepEqual(rows.map((r) => [r.action, r.actorId, r.summary]), [
    ['staff_update', actor.id, { role: ['admin', 'manager'] }],
    ['staff_update', actor.id, { fullName: 'berubah' }],
  ])
  assert.equal(rows[0]?.ip, '203.0.113.9')
  assert.ok(!JSON.stringify(rows).includes('Nama Baru') && !JSON.stringify(rows).includes(tag), 'ringkasan memuat nama/email')
})

await t('perubahan yang ditolak (diri sendiri / superadmin terakhir) tidak meninggalkan jejak', async () => {
  const a = await mk({ role: 'superadmin' })
  assert.deepEqual(await updateUserByAdmin(a.id, { role: 'admin' }, as(a.id)), { ok: false, reason: 'self' })
  assert.equal((await eventsFor(a.id)).length, 0)
})

await t('auditIp: IP utuh (IPv6 tidak diringkas /64 seperti kunci rate limit); nilai bukan IP → null', () => {
  const r = (v: string) => new Request('http://x', { headers: { 'X-Forwarded-For': v } })
  assert.equal(auditIp(r('2001:db8:1:2:3:4:5:6, 10.0.0.1')), '2001:db8:1:2:3:4:5:6')
  assert.equal(auditIp(r('203.0.113.7')), '203.0.113.7')
  assert.equal(auditIp(r('<script>')), null)
  assert.equal(auditIp(new Request('http://x')), null)
})

console.log('== login ==')
const { POST: loginPost } = await import('@/app/api/v1/auth/login/route')
let ipSeq = 10
const login = async (email: string, password: string) => {
  const ip = `198.51.100.${++ipSeq}`
  try {
    await loginPost(new Request('http://localhost/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email, password }) }))
  } catch { /* jalur sukses melempar di createSession (cookies() di luar permintaan) — jejak sudah ditulis sebelum itu */ }
  return ip
}

await t('staf: sandi salah → login_failed(password); nonaktif → login_failed(inactive); benar → login_success + IP', async () => {
  const s = await mk({ role: 'admin' })
  const ip1 = await login(s.email, 'salah-sekali')
  const ip2 = await login(s.email, PW)
  const off = await mk({ role: 'manager', isActive: false })
  await login(off.email, PW)
  const rs = await eventsFor(s.id)
  assert.deepEqual(rs.map((r) => [r.action, r.summary, r.ip]), [['login_failed', { reason: 'password' }, ip1], ['login_success', { role: 'admin' }, ip2]])
  assert.deepEqual((await eventsFor(off.id)).map((r) => [r.action, r.summary]), [['login_failed', { reason: 'inactive' }]])
})

await t('jamaah dan email tak dikenal tidak dicatat', async () => {
  const before = await prisma.staffAuditEvent.count()
  const p = await mk({ role: 'pilgrim' })
  await login(p.email, PW); await login(p.email, 'salah')
  await login(`${tag}-tidak-ada@example.test`, PW)
  assert.equal(await prisma.staffAuditEvent.count(), before)
})

console.log('== append-only ==')
await t('UPDATE / DELETE ditolak trigger; aksi di luar daftar dan ringkasan bukan objek ditolak CHECK', async () => {
  const a = await mk({ role: 'admin' })
  await recordStaffEvent(prisma, { action: 'staff_reset_limits', actorId: a.id, targetUserId: a.id, summary: { cleared: 1 } })
  const row = (await eventsFor(a.id))[0]!
  await assert.rejects(prisma.staffAuditEvent.update({ where: { id: row.id }, data: { ip: '1.1.1.1' } }), /append-only/)
  await assert.rejects(prisma.staffAuditEvent.delete({ where: { id: row.id } }), /append-only/)
  await assert.rejects(prisma.staffAuditEvent.deleteMany({ where: { actorId: a.id } }), /append-only/)
  await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "staff_audit_events" ("id", "action") VALUES (gen_random_uuid()::text, 'apa_saja')`), /check/i)
  await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "staff_audit_events" ("id", "action", "summary") VALUES (gen_random_uuid()::text, 'login_success', '[1]')`), /check/i)
  const sql = readFileSync('prisma/migrations/20261209090000_staff_audit_events/migration.sql', 'utf8')
  for (const a of STAFF_AUDIT_ACTIONS) assert.ok(sql.includes(`'${a}'`), `aksi ${a} tak ada di CHECK migrasi`)
})

console.log('== penampil ==')
await t('superadmin klien tak melihat kejadian akun bayangan Platform Provider (pelaku atau sasaran); provider melihat semua', async () => {
  const provider = await mk({ role: 'superadmin', isPlatformProvider: true })
  const client = await mk({ role: 'superadmin' })
  const staff = await mk({ role: 'admin' })
  await recordStaffEvent(prisma, { action: 'login_success', actorId: provider.id, targetUserId: provider.id })
  await recordStaffEvent(prisma, { action: 'staff_update', actorId: provider.id, targetUserId: staff.id, summary: { isActive: [true, false] } })
  await recordStaffEvent(prisma, { action: 'staff_update', actorId: client.id, targetUserId: provider.id, summary: { fullName: 'berubah' } })
  await recordStaffEvent(prisma, { action: 'staff_update', actorId: client.id, targetUserId: staff.id, summary: { role: ['admin', 'manager'] } })
  await recordStaffEvent(prisma, { action: 'staff_reset_limits', actorId: null, targetUserId: staff.id, summary: { cleared: 0 } }) // skrip
  const forClient = await listStaffEvents(as(client.id), { staffId: staff.id }, { skip: 0, take: 50 })
  assert.deepEqual(forClient.map((r) => [r.action, r.actor?.id ?? null]).sort(), [['staff_reset_limits', null], ['staff_update', client.id]].sort())
  assert.equal(await countStaffEvents(as(client.id), { staffId: staff.id }), 2)
  assert.equal(await countStaffEvents(as(client.id), { staffId: provider.id }), 0)
  assert.equal(await countStaffEvents({ userId: provider.id, isPlatformProvider: true }, { staffId: staff.id }), 3)
  assert.equal(await countStaffEvents(as(client.id), { action: 'login_success', staffId: provider.id }), 0)
})

console.log('== pemindai sumber ==')
function walk(p: string, out: string[]) {
  let st; try { st = statSync(p) } catch { return }
  if (st.isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f), out); return }
  if (/\.(ts|tsx)$/.test(p)) out.push(p)
}
await t('hanya lib/audit/staff.ts yang menulis staffAuditEvent; jalur wajib berjejak memanggil recordStaffEvent', () => {
  const files: string[] = []; walk('app', files); walk('lib', files)
  const writers = files.filter((f) => /staffAuditEvent\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|staff_audit_events/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers, ['lib/audit/staff.ts'])
  for (const f of [
    'app/api/v1/admin/system/users/route.ts',
    'app/api/v1/admin/system/users/[id]/reset-limits/route.ts',
    'app/api/v1/admin/system/users/[id]/whatsapp/route.ts',
    'app/api/v1/auth/login/route.ts',
    'app/api/v1/admin/bookings/[id]/documents/zip/route.ts',
    'lib/auth/adminUsers.ts',
  ]) assert.match(readFileSync(f, 'utf8'), /recordStaffEvent\(/, `${f} tanpa jejak staf`)
  // ZIP: jejak ditulis SEBELUM respons berkas (fail-closed).
  const zip = readFileSync('app/api/v1/admin/bookings/[id]/documents/zip/route.ts', 'utf8')
  assert.ok(zip.indexOf('recordStaffEvent(') < zip.indexOf("'application/zip'"), 'jejak ZIP harus sebelum respons')
  // Login: login_success ditulis SEBELUM sesi terbit.
  const lg = readFileSync('app/api/v1/auth/login/route.ts', 'utf8')
  assert.ok(lg.indexOf("action: 'login_success'") < lg.indexOf('await createSession('), 'jejak login harus sebelum createSession')
})

// Akun uji dihapus: akun Platform Provider aktif menyalakan bagi hasil (+poin margin) untuk uji harga sesudahnya, dan jamaah tertinggal
// membuat test-seed-guard menolak DB. Jejaknya tetap (append-only, tanpa FK).
await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
