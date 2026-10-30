// Fase 7 harga terpadu (docs/arsitektur-harga-terpadu.md §20, 7C): pengeluaran aktual ke vendor terhadap DATABASE SUNGGUHAN.
// Dibuktikan: selisih terhadap HPP awal dievaluasi PER BARIS rencana (lunas / melebihi rencana → catatan wajib; cicilan sah tanpa catatan), dievaluasi ulang setelah ubah dan batal
// (membatalkan satu-satunya catatan penjelas ditolak), rencana tak diketahui tak mewajibkan catatan, mata uang asing membekukan rupiah yang benar-benar keluar, vendor harus aktif,
// baris penyesuaian/baris pesanan lain ditolak, CHECK DB, vendor yang dirujuk tak bisa dihapus keras, perubahan paralel pada baris yang sama terkunci, serta penjaga sumber.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { CostActualError, createCostActual, lineState, listCostActuals, updateCostActual, voidCostActual } from '@/lib/costs/actuals'
import { getVendorUsage } from '@/lib/vendors/integrity'
import { assertThrowawayDb } from './lib/testDb'
import { legacyBookingState, type LegacyBookingStatus } from './lib/legacyStatus'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `ca${Date.now()}`
const staff = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Admin Biaya', role: 'admin', isActive: true, emailVerifiedAt: new Date() } })
const owner = await prisma.user.create({ data: { email: `${tag}-p@example.test`, passwordHash: 'x', fullName: 'Pemesan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const mkVendor = (name: string, isActive = true) => prisma.vendor.create({ data: { name: `${tag} ${name}`, nameKey: `${tag} ${name}`.toLowerCase(), countryCode: 'SA', isActive } })
const v1 = await mkVendor('satu'), v2 = await mkVendor('dua'), vOff = await mkVendor('mati', false)
const bookings: string[] = []
let n = 0

/** Booking dengan tiga baris: hotel (rencana 6.000.000), visa (1.500.000), katering (modal tak diketahui). */
async function mkBooking() {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: owner.id, ...legacyBookingState('confirmed'), departureDate: new Date('2091-01-01'), returnDate: new Date('2091-01-10'), season: 'regular', totalAmount: 11_000_000 } })
  bookings.push(b.id)
  const mk = async (type: string, sell: number, cost: number | null, key = 'main') => (await prisma.priceSnapshot.create({ data: {
    bookingId: b.id, itemType: type, itemId: `${b.id}-${type}-${key}`, lineKey: key, itemLabel: type, itemQty: 1, description: `Baris ${type}`, qty: 1, unit: 'item',
    unitSellIdr: sell, totalSellIdr: sell, unitCostIdr: cost, totalCostIdr: cost, mode: 'auto', vendorIds: [v1.id],
  } })).id
  return { id: b.id, hotel: await mk('hotel', 8_000_000, 6_000_000), visa: await mk('visa', 2_000_000, 1_500_000), catering: await mk('catering', 1_000_000, null), adj: await mk('booking', -50_000, null, 'penyesuaian') }
}
const rec = (bookingId: string, snapshotId: string | null, extra: Partial<Parameters<typeof createCostActual>[0]> = {}) =>
  createCostActual({ bookingId, snapshotId, vendorId: v1.id, component: 'kamar', currency: 'IDR', amount: 6_000_000, paidAt: '2026-03-10', byUserId: staff.id, ...extra })
const rejects = (fn: () => Promise<unknown>, status: number, re: RegExp) => assert.rejects(fn, (e: unknown) => e instanceof CostActualError && e.status === status && re.test((e as Error).message))
const active = (snapshotId: string) => prisma.costActual.findMany({ where: { snapshotId, voidedAt: null } })

await t('lineState (murni): lunas persis → tanpa catatan; lunas kurang/lebih → wajib; belum lunas melebihi rencana → wajib; belum lunas di bawah → tidak; rencana tak diketahui → tidak; catatan memenuhi', () => {
  const e = (amountIdr: number, isSettled = false, varianceNote: string | null = null) => ({ amountIdr, isSettled, varianceNote })
  assert.deepEqual([lineState(100, [e(100, true)]).needsNote, lineState(100, [e(90, true)]).needsNote, lineState(100, [e(110, true)]).needsNote], [false, true, true])
  assert.deepEqual([lineState(100, [e(60)]).needsNote, lineState(100, [e(60), e(50)]).needsNote, lineState(null, [e(999, true)]).needsNote, lineState(100, []).varianceIdr], [false, true, false, null])
  assert.deepEqual([lineState(100, [e(110, true, 'harga naik')]).violation, lineState(100, [e(110, true, 'ab')]).violation, lineState(100, [e(110, true)]).violation], [false, true, true])
  assert.equal(lineState(100, [e(40), e(60, true)]).varianceIdr, 0)
})
await t('lunas persis rencana (6.000.000) → tanpa catatan; cicilan 2 × 3.000.000 (yang terakhir lunas) → sah; baris muncul di daftar dengan selisih 0', async () => {
  const b = await mkBooking()
  await rec(b.id, b.hotel, { amount: 3_000_000 })
  await rec(b.id, b.hotel, { amount: 3_000_000, isSettled: true, paidAt: '2026-03-12' })
  const list = await listCostActuals(b.id)
  const line = list.lines.find(l => l.snapshotId === b.hotel)!
  assert.deepEqual([line.planIdr, line.actualIdr, line.varianceIdr, line.settled, line.needsNote, line.entries.length], [6_000_000, 6_000_000, 0, true, false, 2])
})
await t('lunas MELEBIHI rencana tanpa catatan → 400 (tak tersimpan); dengan catatan sah; lunas KURANG dari rencana juga wajib catatan', async () => {
  const b = await mkBooking()
  await rejects(() => rec(b.id, b.hotel, { amount: 6_500_000, isSettled: true }), 400, /catatan penyebab wajib/)
  await rejects(() => rec(b.id, b.hotel, { amount: 5_500_000, isSettled: true, varianceNote: 'ab' }), 400, /catatan penyebab wajib/)
  assert.equal((await active(b.hotel)).length, 0, 'penolakan tak meninggalkan baris')
  await rec(b.id, b.hotel, { amount: 6_500_000, isSettled: true, varianceNote: 'kurs SAR naik saat pelunasan' })
  const v = await rec(b.id, b.visa, { amount: 1_400_000, isSettled: true, varianceNote: 'diskon vendor' })
  assert.ok(v.id)
  assert.equal((await listCostActuals(b.id)).lines.find(l => l.snapshotId === b.hotel)!.varianceIdr, 500_000)
})
await t('belum lunas: di bawah rencana tanpa catatan sah; begitu kumulatif MELEBIHI rencana → wajib (walau belum lunas)', async () => {
  const b = await mkBooking()
  await rec(b.id, b.hotel, { amount: 4_000_000 })
  await rejects(() => rec(b.id, b.hotel, { amount: 2_500_000 }), 400, /catatan penyebab wajib/)
  assert.equal((await active(b.hotel)).length, 1)
})
await t('rencana TAK DIKETAHUI (katering modal null) atau tanpa rujukan baris: berapa pun tanpa catatan; baris tampil dengan rencana kosong dan selisih null', async () => {
  const b = await mkBooking()
  await rec(b.id, b.catering, { component: 'katering', amount: 999_999, isSettled: true })
  await rec(b.id, null, { component: 'biaya lain', amount: 123_000 })
  const list = await listCostActuals(b.id)
  const line = list.lines.find(l => l.snapshotId === b.catering)!
  assert.deepEqual([line.planIdr, line.varianceIdr, line.needsNote, line.entries.length], [null, null, false, 1])
  assert.deepEqual(list.loose.map(x => [x.component, x.amountIdr]), [['biaya lain', 123_000]])
  assert.ok(!list.lines.some(l => l.snapshotId === b.adj), 'baris penyesuaian tak punya modal → tak jadi baris rencana')
})
await t('mata uang asing: rupiah yang benar-benar keluar WAJIB (dibekukan); IDR memaksa jumlah = rupiah; mata uang/tanggal/jumlah liar ditolak', async () => {
  const b = await mkBooking()
  await rejects(() => rec(b.id, b.hotel, { currency: 'SAR', amount: 1_000 }), 400, /rupiah yang benar-benar keluar/)
  const id = (await rec(b.id, b.hotel, { currency: 'sar', amount: 1_000, amountIdr: 4_050_000 })).id
  const row = await prisma.costActual.findUniqueOrThrow({ where: { id } })
  assert.deepEqual([row.currency, Number(row.amount), Number(row.amountIdr)], ['SAR', 1_000, 4_050_000])
  const idr = await prisma.costActual.findUniqueOrThrow({ where: { id: (await rec(b.id, null, { amount: 500_000, amountIdr: 1 })).id } })
  assert.equal(Number(idr.amountIdr), 500_000, 'IDR: amountIdr kiriman diabaikan')
  await rejects(() => rec(b.id, null, { currency: 'RIYAL' }), 400, /3 huruf/)
  await rejects(() => rec(b.id, null, { paidAt: '10-03-2090' }), 400, /YYYY-MM-DD/)
  await rejects(() => rec(b.id, null, { paidAt: '2026-02-30' }), 400, /YYYY-MM-DD/)
  await rejects(() => rec(b.id, null, { paidAt: '2999-01-01' }), 400, /tidak wajar/)
  for (const amount of [0, -5, Number.NaN, 5e11]) await rejects(() => rec(b.id, null, { amount }), 400, /Jumlah/)
  await rejects(() => rec(b.id, null, { component: '  ' }), 400, /Komponen/)
})
await t('rujukan: vendor tak ada → 404, nonaktif → 409; baris penyesuaian → 400; baris milik pesanan lain / pesanan tak ada → 404', async () => {
  const b = await mkBooking(), other = await mkBooking()
  await rejects(() => rec(b.id, b.hotel, { vendorId: '00000000-0000-4000-8000-000000000000' }), 404, /Vendor tidak ditemukan/)
  await rejects(() => rec(b.id, b.hotel, { vendorId: vOff.id }), 409, /nonaktif/)
  await rejects(() => rec(b.id, b.adj), 400, /penyesuaian/)
  await rejects(() => rec(b.id, other.hotel), 404, /tidak ditemukan pada pesanan ini/)
  await rejects(() => rec('00000000-0000-4000-8000-000000000000', null), 404, /Pesanan tidak ditemukan/)
})
await t('UBAH dievaluasi ulang: menaikkan jumlah hingga melewati rencana tanpa catatan → 400 dan baris tak berubah; dengan catatan sah; pesanan lain / sudah batal → 404/409', async () => {
  const b = await mkBooking(), other = await mkBooking()
  const { id } = await rec(b.id, b.hotel)
  await rejects(() => updateCostActual(b.id, id, { amount: 7_000_000, byUserId: staff.id }), 400, /catatan penyebab wajib/)
  assert.equal(Number((await prisma.costActual.findUniqueOrThrow({ where: { id } })).amount), 6_000_000)
  await updateCostActual(b.id, id, { amount: 7_000_000, varianceNote: 'biaya tambahan visa pelayanan', isSettled: true, byUserId: staff.id })
  assert.equal(Number((await prisma.costActual.findUniqueOrThrow({ where: { id } })).amountIdr), 7_000_000)
  await rejects(() => updateCostActual(other.id, id, { amount: 1, byUserId: staff.id }), 404, /tidak ditemukan/)
  await rejects(() => updateCostActual(b.id, id, { vendorId: vOff.id, byUserId: staff.id }), 409, /nonaktif/)
  await updateCostActual(b.id, id, { vendorId: v2.id, byUserId: staff.id })
  assert.equal((await prisma.costActual.findUniqueOrThrow({ where: { id } })).vendorId, v2.id)
})
await t('BATAL (bukan hapus keras): alasan wajib; riwayat tetap; sekali saja; yang dibatalkan tak dapat diubah dan tak dihitung', async () => {
  const b = await mkBooking()
  const a = await rec(b.id, b.hotel, { amount: 3_000_000 })
  await rec(b.id, b.hotel, { amount: 3_500_000, isSettled: true, varianceNote: 'tambahan layanan' }) // kumulatif 6.500.000 (melebihi) — bercatatan
  await rejects(() => voidCostActual(b.id, a.id, { reason: 'x', byUserId: staff.id }), 400, /Alasan/)
  await voidCostActual(b.id, a.id, { reason: 'salah input — dobel catat', byUserId: staff.id })
  const row = await prisma.costActual.findUniqueOrThrow({ where: { id: a.id } })
  assert.deepEqual([row.voidedAt !== null, row.voidedBy, row.voidReason], [true, staff.id, 'salah input — dobel catat'])
  await rejects(() => voidCostActual(b.id, a.id, { reason: 'lagi', byUserId: staff.id }), 409, /sudah dibatalkan/)
  await rejects(() => updateCostActual(b.id, a.id, { amount: 1, byUserId: staff.id }), 409, /dibatalkan/)
  const line = (await listCostActuals(b.id)).lines.find(l => l.snapshotId === b.hotel)!
  assert.deepEqual([line.actualIdr, line.entries.length, line.entries.filter(e => e.voided).length], [3_500_000, 2, 1], 'yang batal tampil sebagai riwayat tetapi tak dihitung')
  await rejects(() => voidCostActual('00000000-0000-4000-8000-000000000000', a.id, { reason: 'bukan pesanannya', byUserId: staff.id }), 404, /tidak ditemukan/)
})
await t('MEMBATALKAN SATU-SATUNYA CATATAN penjelas selisih ditolak (rollback utuh): x 5.000.000 lunas bercatatan "hemat" + y 1.000.000 lunas tanpa catatan (kumulatif = rencana) → batalkan x ditolak; batalkan y sah', async () => {
  const b = await mkBooking()
  const x = await rec(b.id, b.hotel, { amount: 5_000_000, isSettled: true, varianceNote: 'hemat vendor' })
  const y = await rec(b.id, b.hotel, { amount: 1_000_000, isSettled: true }) // kumulatif 6.000.000 = rencana
  await rejects(() => voidCostActual(b.id, x.id, { reason: 'hapus catatan', byUserId: staff.id }), 400, /catatan penyebab wajib/)
  assert.equal((await prisma.costActual.findUniqueOrThrow({ where: { id: x.id } })).voidedAt, null, 'rollback: x tetap aktif')
  await voidCostActual(b.id, y.id, { reason: 'dobel catat', byUserId: staff.id })
  assert.equal((await active(b.hotel)).length, 1)
})
await t('UBAH menghapus catatan penjelas (varianceNote → null) padahal selisih masih ada → 400, baris tak berubah', async () => {
  const b = await mkBooking()
  const x = await rec(b.id, b.hotel, { amount: 6_500_000, isSettled: true, varianceNote: 'kurs naik' })
  await rejects(() => updateCostActual(b.id, x.id, { varianceNote: null, byUserId: staff.id }), 400, /catatan penyebab wajib/)
  assert.equal((await prisma.costActual.findUniqueOrThrow({ where: { id: x.id } })).varianceNote, 'kurs naik')
})
await t('CHECK DB: jumlah ≤ 0, mata uang huruf kecil, IDR dengan rupiah berbeda, komponen kosong, void setengah → ditolak', async () => {
  const b = await mkBooking()
  const ins = (cols: string) => prisma.$executeRawUnsafe(`INSERT INTO cost_actuals (id, "bookingId", "vendorId", component, currency, amount, "amountIdr", "paidAt", "recordedBy", "updatedAt") VALUES ('${tag}-c${++n}', '${b.id}', '${v1.id}', ${cols}, now())`)
  await assert.rejects(() => ins("'k', 'IDR', 0, 0, '2026-01-01', 'x'"), /amounts_positive|check/i)
  await assert.rejects(() => ins("'k', 'idr', 10, 10, '2026-01-01', 'x'"), /currency_upper|check/i)
  await assert.rejects(() => ins("'k', 'IDR', 10, 11, '2026-01-01', 'x'"), /idr_equal|check/i)
  await assert.rejects(() => ins("' ', 'IDR', 10, 10, '2026-01-01', 'x'"), /component_present|check/i)
  await assert.rejects(() => prisma.$executeRawUnsafe(`UPDATE cost_actuals SET "voidedAt" = now() WHERE "bookingId" = '${b.id}'`).then(() => { throw new Error('tak ada baris') }), /tak ada baris|void_consistent|check/i)
})
await t('vendor yang dirujuk pengeluaran: hapus keras DITOLAK FK; pemakaian vendor menghitungnya', async () => {
  const b = await mkBooking(); const v = await mkVendor('dirujuk')
  await rec(b.id, null, { vendorId: v.id })
  assert.equal((await getVendorUsage(v.id)).costActuals, 1)
  await assert.rejects(() => prisma.vendor.delete({ where: { id: v.id } }), (e: unknown) => (e as { code?: string }).code === 'P2003')
  await prisma.costActual.deleteMany({ where: { vendorId: v.id } }); await prisma.vendor.delete({ where: { id: v.id } })
})
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
/** Tahan kunci baris `FOR SHARE` di transaksi lain (bentrok dengan `FOR UPDATE` eksplisit di kode, TIDAK dengan kunci `FOR KEY SHARE` milik pemeriksaan FK) — `fn` harus MENUNGGU (belum selesai setelah 400 ms), lalu selesai setelah kunci dilepas. */
async function mustWaitForRowLock(table: string, id: string, fn: () => Promise<unknown>) {
  let pending: Promise<unknown> | undefined
  let state = ''
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR SHARE`, id)
    pending = fn().then(() => 'done', (e: unknown) => { throw e })
    state = await Promise.race([pending.then(() => 'done'), sleep(400).then(() => 'blocked')])
  })
  assert.equal(state, 'blocked', `${table}: operasi tidak menunggu kunci baris`)
  await pending
}
await t('KUNCI BARIS: tambah / ubah / batal pada baris rencana yang sama MENUNGGU kunci FOR UPDATE (tak ada yang menyelinap saat pemeriksaan selisih)', async () => {
  const b = await mkBooking()
  await mustWaitForRowLock('price_snapshots', b.visa, () => rec(b.id, b.visa, { amount: 100_000 }))
  const entry = (await active(b.visa))[0]!
  await mustWaitForRowLock('price_snapshots', b.visa, () => updateCostActual(b.id, entry.id, { amount: 200_000, byUserId: staff.id }))
  await mustWaitForRowLock('price_snapshots', b.visa, () => voidCostActual(b.id, entry.id, { reason: 'uji kunci', byUserId: staff.id }))
})
await t('PARALEL pada baris yang sama: 8 pengeluaran 400.000 serentak (rencana 1.500.000) → TEPAT 3 yang lolos tanpa catatan', async () => {
  const b = await mkBooking()
  const res = await Promise.allSettled(Array.from({ length: 8 }, () => rec(b.id, b.visa, { amount: 400_000 })))
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 3, res.map(r => r.status).join(','))
})
await t('cascade: hapus pesanan menghapus pengeluarannya; hapus baris snapshot (cascade pesanan) tak meninggalkan yatim', async () => {
  const b = await mkBooking(); await rec(b.id, b.hotel, { amount: 1_000 })
  await prisma.booking.delete({ where: { id: b.id } }); bookings.splice(bookings.indexOf(b.id), 1)
  assert.equal(await prisma.costActual.count({ where: { bookingId: b.id } }), 0)
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const walk = (dir: string, out: string[] = []): string[] => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue; const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p) } return out }
await t('PENJAGA: hanya lib/costs/actuals.ts (+ pembersihan UU PDP) menulis cost_actuals; route dijaga policy di awal dan tak menyentuh tabel; batas booking ditegakkan di fungsi ubah/batal', () => {
  const writers = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))].filter(f => /costActual\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers.map(f => f.slice(root.length)).sort(), ['lib/account/deletion.ts', 'lib/costs/actuals.ts'], 'penulis: modul ini + pembersihan catatan staf saat hapus akun (UU PDP)')
  for (const f of ['app/api/v1/admin/bookings/[id]/cost-actuals/route.ts', 'app/api/v1/admin/bookings/[id]/cost-actuals/[actualId]/route.ts']) {
    const src = read(f)
    assert.match(src, /requireCostRecord\(\)|requirePricingView\(\)/, f); assert.doesNotMatch(src, /requireManager|requireSuperAdmin|requireAdmin\(|costActual\./, f)
    assert.ok(src.indexOf('requireCostRecord()') !== -1 || src.indexOf('requirePricingView()') !== -1)
  }
  const lib = read('lib/costs/actuals.ts')
  assert.match(lib, /current\.bookingId !== bookingId/); assert.match(lib, /FOR UPDATE/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
await prisma.user.deleteMany({ where: { id: { in: [staff.id, owner.id] } } })
await prisma.vendor.deleteMany({ where: { id: { in: [v1.id, v2.id, vOff.id] } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
