// Uji CRUD lengkap admin (docs/arsitektur-admin-create.md §6, F3): helper hapus-aman terhadap DB SUNGGUHAN (termasuk kasus bug lama: rute yang
// dirujuk jadwal NONAKTIF), skema ubah, dan penjaga sumber (otorisasi di awal, hapus lewat helper, halaman ubah berbasis EditPage).
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { deleteOrDeactivate } from '@/lib/admin/safeDelete'
import { cateringOptionUpdateSchema, seasonUpdateSchema, userAdminUpdateSchema } from '@/lib/validators/adminUpdates'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')
const tag = `crud${Date.now()}`

// ── helper (tanpa DB) ──
await t('deleteOrDeactivate: tanpa rujukan → hapus; ada rujukan → nonaktif + pesan (hapus TIDAK dipanggil)', async () => {
  const calls: string[] = []
  const mk = (refs: number) => ({ references: async () => refs, remove: async () => { calls.push('remove') }, deactivate: async () => { calls.push('deactivate') }, usedBy: (n: number) => `Dipakai ${n}` })
  assert.deepEqual(await deleteOrDeactivate(mk(0)), { deleted: true }); assert.deepEqual(calls, ['remove'])
  calls.length = 0
  const r = await deleteOrDeactivate(mk(3))
  assert.equal(r.deleted, false); assert.ok('message' in r && /Dipakai 3.*dinonaktifkan/.test(r.message)); assert.deepEqual(calls, ['deactivate'])
})

await t('deleteOrDeactivate: tabrakan FK (P2003) saat hapus → jatuh ke nonaktif; P2025 dilempar ulang (→ 404); galat lain dilempar ulang', async () => {
  let deactivated = 0
  const base = { references: async () => 0, deactivate: async () => { deactivated++ }, usedBy: (n: number) => `n=${n}` }
  const r = await deleteOrDeactivate({ ...base, remove: async () => { throw Object.assign(new Error('fk'), { code: 'P2003' }) } })
  assert.equal(r.deleted, false); assert.equal(deactivated, 1)
  await assert.rejects(deleteOrDeactivate({ ...base, remove: async () => { throw Object.assign(new Error('gone'), { code: 'P2025' }) } }), (e: { code?: string }) => e.code === 'P2025')
  await assert.rejects(deleteOrDeactivate({ ...base, remove: async () => { throw new Error('boom') } }), /boom/)
  assert.equal(deactivated, 1, 'galat lain tak boleh menonaktifkan')
})

// ── DB sungguhan: perilaku route lama yang rusak ──
await t('DB: rute dengan jadwal NONAKTIF (bug lama: galat FK 500) → dinonaktifkan; rute tanpa rujukan → terhapus', async () => {
  const route = await prisma.flightRoute.create({ data: { origin: `${tag}-A`, destination: `${tag}-B` } })
  const sched = await prisma.flightSchedule.create({ data: { routeId: route.id, departureFrom: new Date('2031-01-01'), departureTo: new Date('2031-02-01'), price: 0, isActive: false } })
  const del = (id: string) => deleteOrDeactivate({
    references: async () => { const r = await prisma.flightRoute.findUniqueOrThrow({ where: { id }, select: { _count: { select: { schedules: true, packages: true } } } }); return r._count.schedules + r._count.packages },
    remove: () => prisma.flightRoute.delete({ where: { id } }), deactivate: () => prisma.flightRoute.update({ where: { id }, data: { isActive: false } }), usedBy: n => `dipakai ${n}`,
  })
  const out = await del(route.id)
  assert.equal(out.deleted, false); assert.equal((await prisma.flightRoute.findUniqueOrThrow({ where: { id: route.id } })).isActive, false)
  await prisma.flightSchedule.delete({ where: { id: sched.id } })
  assert.deepEqual(await del(route.id), { deleted: true }); assert.equal(await prisma.flightRoute.findUnique({ where: { id: route.id } }), null)
})

await t('DB: kendaraan yang dipakai harga trip → dinonaktifkan; tanpa rujukan → terhapus', async () => {
  const vehicle = await prisma.transportVehicle.create({ data: { name: `${tag} bus`, vehicleType: 'bus', capacity: 40 } })
  const trip = await prisma.transportTrip.create({ data: { name: `${tag} trip`, origin: 'A', destination: 'B' } })
  const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: vehicle.id } })
  const del = (id: string) => deleteOrDeactivate({
    references: async () => (await prisma.transportVehicle.findUniqueOrThrow({ where: { id }, select: { _count: { select: { pricing: true } } } }))._count.pricing,
    remove: () => prisma.transportVehicle.delete({ where: { id } }), deactivate: () => prisma.transportVehicle.update({ where: { id }, data: { isActive: false } }), usedBy: n => `dipakai ${n}`,
  })
  assert.equal((await del(vehicle.id)).deleted, false); assert.equal((await prisma.transportVehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).isActive, false)
  await prisma.transportPricing.delete({ where: { id: pricing.id } }); await prisma.transportTrip.delete({ where: { id: trip.id } })
  assert.deepEqual(await del(vehicle.id), { deleted: true })
})

// ── skema ──
await t('skema ubah: katering sebagian ok + isActive; kosong/kolom liar/harga negatif ditolak; musim urutan tanggal; pengguna fullName', () => {
  assert.equal(cateringOptionUpdateSchema.safeParse({ pricePerPersonRegular: 100 }).success, true)
  assert.equal(cateringOptionUpdateSchema.safeParse({ isActive: false }).success, true)
  assert.equal(cateringOptionUpdateSchema.safeParse({}).success, false)
  assert.equal(cateringOptionUpdateSchema.safeParse({ id: 'x' }).success, false, 'kolom liar')
  assert.equal(cateringOptionUpdateSchema.safeParse({ pricePerPersonHajj: -1 }).success, false)
  assert.equal(seasonUpdateSchema.safeParse({ endDate: '2031-03-01' }).success, true)
  assert.equal(seasonUpdateSchema.safeParse({}).success, false)
  assert.equal(seasonUpdateSchema.safeParse({ startDate: '2031-03-02', endDate: '2031-03-01' }).success, false)
  assert.equal(seasonUpdateSchema.safeParse({ name: 'hajj', evil: 1 }).success, false)
  assert.equal(userAdminUpdateSchema.safeParse({ fullName: ' Budi ' }).success, true)
  assert.equal(userAdminUpdateSchema.safeParse({ fullName: 'B' }).success, false)
  assert.equal(userAdminUpdateSchema.safeParse({ email: 'x@y.z' }).success, false, 'email tak boleh lewat sini')
  assert.equal(userAdminUpdateSchema.safeParse({}).success, false)
})

// ── penjaga sumber ──
const ROUTES: Array<[string, 'manager' | 'superadmin', Array<'GET' | 'PUT' | 'DELETE'>]> = [
  ['app/api/v1/admin/products/catering/[id]/route.ts', 'manager', ['GET', 'PUT', 'DELETE']],
  ['app/api/v1/admin/products/seasons/[id]/route.ts', 'manager', ['GET', 'PUT', 'DELETE']],
  ['app/api/v1/admin/products/flight/routes/[id]/route.ts', 'manager', ['GET', 'PUT', 'DELETE']],
  ['app/api/v1/admin/products/transport/vehicles/[id]/route.ts', 'manager', ['GET', 'PUT', 'DELETE']],
  ['app/api/v1/admin/system/users/[id]/route.ts', 'superadmin', ['GET', 'PUT']],
]
await t('route ubah/hapus: setiap verb memanggil requireManager/requireSuperAdmin lebih dulu; tak ada body mentah ke Prisma', () => {
  for (const [file, role, verbs] of ROUTES) {
    const src = read(file)
    for (const verb of verbs) {
      const i = src.indexOf(`export async function ${verb}(`)
      assert.ok(i >= 0, `${file}: ${verb} tidak ada`)
      assert.match(src.slice(i, i + 220), new RegExp(`await require${role === 'manager' ? 'Manager' : 'SuperAdmin'}\\(\\)`), `${file}: ${verb} tanpa otorisasi di awal`)
    }
    assert.doesNotMatch(src, /data:\s*(body|b)\b/, `${file}: body mentah ke Prisma`)
  }
})

await t('hapus entitas yang bisa dirujuk lewat deleteOrDeactivate (katering, rute, kendaraan); tak ada .delete() telanjang di luar callback', () => {
  for (const f of ['catering/[id]', 'flight/routes/[id]', 'transport/vehicles/[id]']) {
    const src = read(`app/api/v1/admin/products/${f}/route.ts`)
    assert.match(src, /deleteOrDeactivate\(/, `${f}: tidak memakai helper hapus-aman`)
    const del = src.slice(src.indexOf('export async function DELETE'))
    assert.equal((del.match(/\.delete\(/g) ?? []).length, 1, `${f}: .delete() harus tepat satu (di dalam remove:)`)
    assert.ok(del.indexOf('remove:') < del.indexOf('.delete('), `${f}: .delete() di luar callback remove`)
  }
})

await t('halaman ubah memakai EditPage + useEditEntity; hook memeriksa respons; daftar menaut ke halaman ubah', () => {
  const pages = ['app/[locale]/admin/(protected)/products/catering/[id]/page.tsx', 'app/[locale]/admin/(protected)/products/seasons/[id]/page.tsx', 'app/[locale]/admin/(protected)/products/flight/routes/[id]/page.tsx', 'app/[locale]/admin/(protected)/system/users/[id]/page.tsx']
  for (const p of pages) { const s = read(p); assert.match(s, /<EditPage\b/, p); assert.match(s, /useEditEntity</, p); assert.doesNotMatch(s, /method:\s*['"](PUT|DELETE)['"]/, `${p}: fetch langsung`) }
  const hook = read('components/admin/shell/useEditEntity.ts')
  assert.equal((hook.match(/!res\.ok \|\| !json\?\.data/g) ?? []).length, 3, 'muat, simpan, dan hapus harus memeriksa respons')
  assert.match(read('app/[locale]/admin/(protected)/products/catering/page.tsx'), /products\/catering\/\$\{c\.id\}/)
  assert.match(read('app/[locale]/admin/(protected)/products/seasons/page.tsx'), /products\/seasons\/\$\{s\.id\}/)
  assert.match(read('app/[locale]/admin/(protected)/products/flight/page.tsx'), /flight\/routes\/\$\{r\.id\}/)
  assert.match(read('app/[locale]/admin/(protected)/system/users/page.tsx'), /system\/users\/\$\{u\.id\}/)
})

// ── pembersihan ──
await prisma.flightRoute.deleteMany({ where: { origin: { startsWith: tag } } })
await prisma.transportVehicle.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.$disconnect()
if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nsemua lulus')
