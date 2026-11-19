// Uji linimasa status visa per jamaah (docs/arsitektur-visa.md §9) terhadap DATABASE SUNGGUHAN: fungsi murni `visaTimeline`, skema ubah status
// (alasan wajib saat menolak), penulis tunggal `changeVisaStatus` (transisi dinilai di dalam kunci, Syarikah hanya untuk jamaah terverifikasi, riwayat +
// petugas tercatat, alasan dikosongkan saat diproses ulang), riwayat append-only di DB (UPDATE/DELETE ditolak, ikut terhapus bersama pengajuan,
// petugas di-NULL-kan saat akunnya dihapus), isi ulang migrasi dari submittedAt/issuedAt, dan penjaga sumber.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { visaTimeline } from '@/lib/visa/timeline'
import { visaEventsOf } from '@/lib/visa/events'
import { changeVisaStatus } from '@/lib/visa/status'
import { visaStatusChangeSchema } from '@/lib/validators/visaStatus'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const at = (iso: string) => new Date(iso)

// ── murni ──────────────────────────────────────────────────────────────────────────────────────────
await t('visaTimeline: langkah selesai/terkini/belum + tanggal dari riwayat; Ditolak = langkah akhir merah; putaran sesudah ditolak memakai riwayat terakhir', () => {
  const ev = [
    { fromStatus: 'pending_documents', toStatus: 'documents_complete', createdAt: at('2026-11-01T02:00:00Z') },
    { fromStatus: 'documents_complete', toStatus: 'submitted_to_syarikah', createdAt: at('2026-11-02T02:00:00Z') },
  ] as const
  const s = visaTimeline('submitted_to_syarikah', ev)
  assert.deepEqual(s.map(x => [x.status, x.state]), [['pending_documents', 'done'], ['documents_complete', 'done'], ['submitted_to_syarikah', 'current'], ['in_review', 'todo'], ['issued', 'todo']])
  assert.equal(s[0]!.at, null, 'langkah awal tak punya waktu tercatat')
  assert.equal(s[2]!.at?.toISOString(), '2026-11-02T02:00:00.000Z')
  assert.equal(s[3]!.at, null, 'langkah belum dicapai tanpa tanggal')

  const issued = visaTimeline('issued', [...ev, { fromStatus: 'submitted_to_syarikah', toStatus: 'in_review', createdAt: at('2026-11-03T02:00:00Z') }, { fromStatus: 'in_review', toStatus: 'issued', createdAt: at('2026-11-04T02:00:00Z') }])
  assert.ok(issued.every(x => x.state === 'done'), 'terbit = semua selesai')

  const rejected = visaTimeline('rejected', [...ev, { fromStatus: 'submitted_to_syarikah', toStatus: 'in_review', createdAt: at('2026-11-03T02:00:00Z') }, { fromStatus: 'in_review', toStatus: 'rejected', createdAt: at('2026-11-04T02:00:00Z') }])
  assert.deepEqual(rejected.at(-1), { status: 'rejected', state: 'rejected', at: at('2026-11-04T02:00:00Z') })

  const again = visaTimeline('documents_complete', [
    ...ev, { fromStatus: 'in_review', toStatus: 'rejected', createdAt: at('2026-11-04T02:00:00Z') },
    { fromStatus: 'rejected', toStatus: 'pending_documents', createdAt: at('2026-11-05T02:00:00Z') },
    { fromStatus: 'pending_documents', toStatus: 'documents_complete', createdAt: at('2026-11-06T02:00:00Z') },
  ])
  assert.deepEqual(again.map(x => x.state), ['done', 'current', 'todo', 'todo', 'todo'])
  assert.equal(again[0]!.at?.toISOString(), '2026-11-05T02:00:00.000Z', 'putaran baru dimulai saat kembali ke Menunggu dokumen')
  assert.equal(again[1]!.at?.toISOString(), '2026-11-06T02:00:00.000Z', 'tanggal putaran lama tak dipakai')
  assert.equal(again[2]!.at, null)
})

await t('skema: menolak wajib beralasan (≥ 3); alasan hanya untuk Ditolak; field asing ditolak', () => {
  assert.equal(visaStatusChangeSchema.safeParse({ status: 'rejected' }).success, false)
  assert.equal(visaStatusChangeSchema.safeParse({ status: 'rejected', rejectionReason: '  a ' }).success, false)
  assert.equal(visaStatusChangeSchema.safeParse({ status: 'rejected', rejectionReason: 'Foto paspor buram' }).success, true)
  assert.equal(visaStatusChangeSchema.safeParse({ status: 'issued', rejectionReason: 'x y z' }).success, false)
  assert.equal(visaStatusChangeSchema.safeParse({ status: 'issued', extra: 1 }).success, false)
  assert.equal(visaStatusChangeSchema.safeParse({ status: 'rejected', rejectionReason: 'x'.repeat(1001) }).success, false)
})

// ── DB ─────────────────────────────────────────────────────────────────────────────────────────────
const tag = `vs${Date.now()}`
let n = 0
const mkUser = (role: 'pilgrim' | 'admin') => prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Petugas ${n}`, role, emailVerifiedAt: new Date() }, select: { id: true, fullName: true } })
const owner = await mkUser('pilgrim')
const staff = await mkUser('admin')
async function mkPilgrim(verified = false) {
  const b = await prisma.booking.create({ data: { bookingCode: `VS-${tag}-${++n}`, userId: owner.id, status: 'active', season: 'regular', totalAmount: 1, pilgrims: { create: [{ isLeader: true, fieldValues: {} }] } }, select: { pilgrims: { select: { id: true } } } })
  const pid = b.pilgrims[0]!.id
  const app = await prisma.visaApplication.create({ data: { bookingPilgrimId: pid, visaType: 'umroh', status: 'pending_documents' }, select: { id: true } })
  if (verified) await prisma.bookingPilgrim.update({ where: { id: pid }, data: { reviewStatus: 'verified', submittedAt: new Date(), verifiedAt: new Date() } })
  return { pid, app: app.id }
}
const go = (pid: string, status: Parameters<typeof changeVisaStatus>[1]['status'], extra: { rejectionReason?: string } = {}) => changeVisaStatus(pid, { status, ...extra }, staff.id)

await t('changeVisaStatus: transisi sah tercatat (dari→ke, petugas, waktu); tak sah ditolak tanpa menulis; Syarikah hanya bila terverifikasi; pengajuan tak ada = not_found', async () => {
  const { pid, app } = await mkPilgrim()
  assert.equal((await go(pid, 'in_review')).kind, 'invalid_transition')
  assert.equal(await prisma.visaStatusEvent.count({ where: { visaApplicationId: app } }), 0, 'transisi tak sah tak menulis riwayat')
  assert.equal((await go(pid, 'documents_complete')).kind, 'ok')
  assert.deepEqual(await go(pid, 'submitted_to_syarikah'), { kind: 'not_verified' })
  const row = await prisma.visaApplication.findUniqueOrThrow({ where: { id: app }, select: { status: true, submittedAt: true } })
  assert.deepEqual(row, { status: 'documents_complete', submittedAt: null })
  const ev = (await visaEventsOf([app], { withActor: true })).get(app) ?? []
  assert.deepEqual(ev.map(e => [e.fromStatus, e.toStatus, e.actor]), [['pending_documents', 'documents_complete', staff.fullName]])
  assert.equal((await visaEventsOf([app])).get(app)![0]!.actor, undefined, 'tanpa withActor: nama petugas tak dimuat')
  const ghost = await prisma.booking.create({ data: { bookingCode: `VS-${tag}-${++n}`, userId: owner.id, status: 'active', season: 'regular', totalAmount: 1, pilgrims: { create: [{ isLeader: true, fieldValues: {} }] } }, select: { pilgrims: { select: { id: true } } } })
  assert.equal((await go(ghost.pilgrims[0]!.id, 'documents_complete')).kind, 'not_found', 'jamaah tanpa visa')
  assert.equal((await go('00000000-0000-0000-0000-000000000000', 'documents_complete')).kind, 'not_found')
})

await t('alur penuh terverifikasi: Syarikah mengisi submittedAt, Terbit mengisi issuedAt; Ditolak menyimpan alasan, diproses ulang mengosongkannya; dua permintaan serentak yang sama → satu lolos', async () => {
  const { pid, app } = await mkPilgrim(true)
  for (const s of ['documents_complete', 'submitted_to_syarikah', 'in_review'] as const) assert.equal((await go(pid, s)).kind, 'ok', s)
  assert.ok((await prisma.visaApplication.findUniqueOrThrow({ where: { id: app } })).submittedAt)
  assert.equal((await go(pid, 'rejected', { rejectionReason: 'Foto paspor buram' })).kind, 'ok')
  assert.equal((await prisma.visaApplication.findUniqueOrThrow({ where: { id: app } })).rejectionReason, 'Foto paspor buram')
  // Serentak: rejected → pending_documents dua kali; transisi dinilai di dalam kunci → tepat satu yang lolos.
  const both = await Promise.all([go(pid, 'pending_documents'), go(pid, 'pending_documents')])
  assert.deepEqual(both.map(r => r.kind).sort(), ['invalid_transition', 'ok'])
  assert.equal((await prisma.visaApplication.findUniqueOrThrow({ where: { id: app } })).rejectionReason, null, 'alasan tak tampil basi')
  for (const s of ['documents_complete', 'submitted_to_syarikah', 'in_review', 'issued'] as const) assert.equal((await go(pid, s)).kind, 'ok', s)
  const row = await prisma.visaApplication.findUniqueOrThrow({ where: { id: app } })
  assert.equal(row.status, 'issued'); assert.ok(row.issuedAt)
  const ev = (await visaEventsOf([app])).get(app) ?? []
  assert.equal(ev.length, 9)
  assert.deepEqual(visaTimeline(row.status, ev).map(x => x.state), ['done', 'done', 'done', 'done', 'done'])
})

await t('riwayat APPEND-ONLY di DB: UPDATE/DELETE ditolak; petugas boleh di-NULL-kan; ikut terhapus bersama pengajuan visa (revisi/hapus jamaah)', async () => {
  const { pid, app } = await mkPilgrim()
  await go(pid, 'documents_complete')
  const e = await prisma.visaStatusEvent.findFirstOrThrow({ where: { visaApplicationId: app } })
  await assert.rejects(prisma.$executeRaw(Prisma.sql`UPDATE "visa_status_events" SET "toStatus" = 'issued' WHERE "id" = ${e.id}`), /append-only/)
  await assert.rejects(prisma.$executeRaw(Prisma.sql`UPDATE "visa_status_events" SET "createdAt" = "createdAt" - interval '1 day' WHERE "id" = ${e.id}`), /append-only/)
  await assert.rejects(prisma.$executeRaw(Prisma.sql`DELETE FROM "visa_status_events" WHERE "id" = ${e.id}`), /append-only/)
  await prisma.$executeRaw(Prisma.sql`UPDATE "visa_status_events" SET "actorId" = NULL WHERE "id" = ${e.id}`)
  await prisma.visaApplication.delete({ where: { id: app } })
  assert.equal(await prisma.visaStatusEvent.count({ where: { id: e.id } }), 0, 'cascade bersama pengajuan')
  await assert.rejects(prisma.$executeRaw(Prisma.sql`INSERT INTO "visa_status_events" ("id","visaApplicationId","fromStatus","toStatus") VALUES (gen_random_uuid()::text, ${(await mkPilgrim()).app}, 'issued', 'issued')`), /visa_status_events_changes/)
  void pid
})

await t('migrasi: isi ulang dari submittedAt/issuedAt (UTC tanpa zona → instan sama), status lain tak ditebak', async () => {
  const { app } = await mkPilgrim()
  await prisma.visaApplication.update({ where: { id: app }, data: { status: 'issued', submittedAt: at('2026-10-01T03:00:00Z'), issuedAt: at('2026-10-05T17:30:00Z') } })
  const mig = read('prisma/migrations/20261208090000_visa_status_events/migration.sql')
  const inserts = mig.split(';').map(x => x.trim()).filter(x => x.includes('INSERT INTO "visa_status_events"')).map(x => x.slice(x.indexOf('INSERT')))
  assert.equal(inserts.length, 2)
  for (const sql of inserts) await prisma.$executeRawUnsafe(`${sql} AND "id" = '${app}'`)
  const ev = await prisma.visaStatusEvent.findMany({ where: { visaApplicationId: app }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(ev.map(e => [e.fromStatus, e.toStatus, e.actorId, e.createdAt.toISOString()]), [
    [null, 'submitted_to_syarikah', null, '2026-10-01T03:00:00.000Z'],
    [null, 'issued', null, '2026-10-05T17:30:00.000Z'],
  ])
})

await t('PENJAGA: status visa dan riwayatnya hanya ditulis lib/visa/status.ts; route admin memakainya; tampilan jamaah tanpa nama petugas', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(join(root, dir))) {
      const p = `${dir}/${f}`
      if (statSync(join(root, p)).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx)$/.test(f) || p === 'lib/visa/status.ts') continue
      const src = read(p)
      if (/visaStatusEvent\.(create|update|delete|upsert)/.test(src) || /(INSERT INTO|UPDATE|DELETE FROM)\s+"visa_status_events"/.test(src)) offenders.push(`${p}: riwayat`)
      if (/visaApplication\.update(Many)?\(\{[\s\S]{0,300}?\bstatus\s*:/.test(src)) offenders.push(`${p}: status`)
    }
  }
  for (const d of ['app', 'lib', 'components']) walk(d)
  assert.deepEqual(offenders, [])
  assert.match(read('app/api/v1/admin/visa/[pilgrimId]/status/route.ts'), /changeVisaStatus\(/)
  const pilgrimPage = read('app/[locale]/(pilgrim)/bookings/[id]/jamaah/[pilgrimId]/page.tsx')
  assert.match(pilgrimPage, /visaEventsOf\(\[p\.visaApplication\.id\]\)/)
  assert.ok(!/withActor/.test(pilgrimPage), 'jamaah tak melihat nama petugas')
})

// Bersihkan: uji lain (seed-guard) butuh DB tanpa data jamaah. Pengajuan visa dulu (riwayat ikut terhapus lewat cascade), lalu booking, lalu akun.
const users = [owner.id, staff.id]
await prisma.visaApplication.deleteMany({ where: { pilgrim: { booking: { userId: { in: users } } } } })
await prisma.booking.deleteMany({ where: { userId: { in: users } } })
await prisma.notificationLog.deleteMany({ where: { userId: { in: users } } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()
if (failed) { console.log(`\n${failed} uji gagal`); process.exit(1) }
console.log('\nsemua lulus')
