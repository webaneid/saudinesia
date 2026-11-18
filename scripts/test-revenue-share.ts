// Fase 13a bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md) terhadap DATABASE SUNGGUHAN.
// Dibuktikan: bawaan tanpa versi (5%, markup), contoh hitung dua opsi (angka pemilik), hanya akun Platform Provider (superadmin + penanda, dibaca ulang di
// transaksi) yang menyimpan, versi basi → 409, tanpa perubahan → 400, append-only + CHECK di DB, validator ketat, dan penjaga sumber
// (penulis tunggal tabel, penanda hanya lewat skrip, route dijaga sebelum menyentuh data).
//
// PENGAMAN: menulis data sementara → hanya database sekali pakai.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { currentRevenueShare, DEFAULT_REVENUE_SHARE, revenueShareHistory, RevenueShareError, saveRevenueShare } from '@/lib/revenue-share/settings'
import { revenueShareExample } from '@/lib/revenue-share/example'
import { revenueShareSettingSchema } from '@/lib/validators/revenueShare'
import { getAdminNavigation } from '@/lib/admin/navigation'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const tag = `rs${Date.now()}`
const mkUser = (k: string, role: 'superadmin' | 'manager', isPlatformProvider: boolean) =>
  prisma.user.create({ data: { email: `${tag}-${k}@example.test`, passwordHash: 'x', fullName: `Uji ${k}`, role, isActive: true, emailVerifiedAt: new Date(), isPlatformProvider } })
const provider = await mkUser('pp', 'superadmin', true)
const client = await mkUser('sa', 'superadmin', false)
const managerFlagged = await mkUser('mg', 'manager', true) // penanda tanpa peran superadmin tak berarti apa-apa
const status = async (p: Promise<unknown>) => { try { await p; return 0 } catch (e) { if (e instanceof RevenueShareError) return e.status; throw e } }

await t('CONTOH (angka pemilik): markup 5 poin → jual 1.250.000, Platform Provider 50.000, klien 200.000; margin 5% → jual 1.200.000, Platform Provider 10.000, klien 190.000', () => {
  assert.deepEqual(revenueShareExample(5, 'markup'), { costIdr: 1_000_000, marginPercent: 20, sellIdr: 1_250_000, providerIdr: 50_000, clientIdr: 200_000 })
  assert.deepEqual(revenueShareExample(5, 'margin'), { costIdr: 1_000_000, marginPercent: 20, sellIdr: 1_200_000, providerIdr: 10_000, clientIdr: 190_000 })
  assert.deepEqual(revenueShareExample(0, 'markup').sellIdr, 1_200_000)
})

await t('BAWAAN tanpa versi tersimpan = 5%, tambah poin marjin (keputusan pemilik Q2)', async () => {
  assert.deepEqual(DEFAULT_REVENUE_SHARE, { percent: 5, basis: 'markup' })
  const c = await currentRevenueShare()
  if (c.isDefault) assert.deepEqual(c, { id: null, percent: 5, basis: 'markup', isDefault: true })
})

const before = await currentRevenueShare()
await t('HANYA Platform Provider: superadmin klien → 403; manager berpenanda → 403; akun dicabut penandanya di tengah jalan → 403', async () => {
  assert.equal(await status(saveRevenueShare({ percent: 7, basis: 'margin', note: null, expectedId: before.id }, client.id)), 403)
  assert.equal(await status(saveRevenueShare({ percent: 7, basis: 'margin', note: null, expectedId: before.id }, managerFlagged.id)), 403)
  const temp = await mkUser('tmp', 'superadmin', true)
  await prisma.user.update({ where: { id: temp.id }, data: { isPlatformProvider: false } })
  assert.equal(await status(saveRevenueShare({ percent: 7, basis: 'margin', note: null, expectedId: before.id }, temp.id)), 403)
  assert.equal((await currentRevenueShare()).id, before.id, 'tak ada versi tertulis')
})

await t('SIMPAN versi baru oleh Platform Provider; versi terbaru = berlaku; riwayat tak ditimpa', async () => {
  const a = await saveRevenueShare({ percent: 7.5, basis: 'margin', note: ' Kesepakatan uji ', expectedId: before.id }, provider.id)
  assert.deepEqual([a.percent, a.basis, a.isDefault], [7.5, 'margin', false])
  const b = await saveRevenueShare({ percent: 5, basis: 'markup', note: null, expectedId: a.id }, provider.id)
  assert.deepEqual([b.percent, b.basis], [5, 'markup'])
  const h = await revenueShareHistory()
  assert.deepEqual(h.slice(0, 2).map(v => [v.percent, v.basis, v.note]), [[5, 'markup', null], [7.5, 'margin', 'Kesepakatan uji']])
  assert.ok(h.every(v => !('createdByName' in v) && !('createdById' in v)), 'akun bayangan: riwayat tanpa identitas penyimpan')
})

await t('BASI → 409 (expectedId lama); TANPA perubahan → 400; dua penyimpan serentak dengan versi sama → satu menang, satu 409', async () => {
  const cur = await currentRevenueShare()
  assert.equal(await status(saveRevenueShare({ percent: 6, basis: 'markup', note: null, expectedId: before.id }, provider.id)), 409)
  assert.equal(await status(saveRevenueShare({ percent: cur.percent, basis: cur.basis, note: null, expectedId: cur.id }, provider.id)), 400)
  const r = await Promise.all([6, 8].map(p => status(saveRevenueShare({ percent: p, basis: 'markup', note: null, expectedId: cur.id }, provider.id))))
  assert.deepEqual(r.sort(), [0, 409])
})

await t('DB: append-only (UPDATE/DELETE/TRUNCATE ditolak trigger); CHECK persen 0..50', async () => {
  const id = (await currentRevenueShare()).id!
  await assert.rejects(prisma.revenueShareSetting.update({ where: { id }, data: { percent: 1 } }), /append-only/)
  await assert.rejects(prisma.revenueShareSetting.delete({ where: { id } }), /append-only/)
  await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "revenue_share_settings"'), /append-only/)
  await assert.rejects(prisma.revenueShareSetting.create({ data: { percent: 51, basis: 'markup', createdById: provider.id } }), /revenue_share_settings_percent/)
  await assert.rejects(prisma.revenueShareSetting.create({ data: { percent: -1, basis: 'markup', createdById: provider.id } }), /revenue_share_settings_percent/)
})

await t('VALIDATOR: kunci asing, persen > 50 / < 0 / tiga desimal, dasar asing, versi bukan uuid → ditolak; bentuk sah diterima', () => {
  const ok = { percent: 5, basis: 'markup', note: null, expectedId: null }
  assert.equal(revenueShareSettingSchema.safeParse(ok).success, true)
  for (const p of [1.1, 7.15, 0.07, 2.35, 33.33, 0, 50]) assert.equal(revenueShareSettingSchema.safeParse({ ...ok, percent: p }).success, true, `${p} sah (presisi float, SEC-275)`)
  for (const bad of [{ ...ok, extra: 1 }, { ...ok, percent: 50.01 }, { ...ok, percent: -0.5 }, { ...ok, percent: 5.125 }, { ...ok, basis: 'omzet' }, { ...ok, expectedId: 'x' }, { ...ok, percent: '5' }, { ...ok, note: 'x'.repeat(201) }]) {
    assert.equal(revenueShareSettingSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80))
  }
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────────────────────────
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(n => { const p = `${dir}/${n}`; return statSync(join(root, p)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [] })
}
await t('PENJAGA: hanya lib/revenue-share/settings.ts menulis revenue_share_settings; tak ada kode app/lib yang MENULIS isPlatformProvider (hanya skrip); route dijaga di awal; menu Sistem', () => {
  const files = [...walk('app'), ...walk('lib')]
  assert.deepEqual(files.filter(f => /revenueShareSetting\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+"?revenue_share_settings/.test(read(f))), ['lib/revenue-share/settings.ts'])
  // Setiap kemunculan penanda di kode aplikasi harus berkas BACA yang dikenal (SEC-276: regex tulis sempit melewatkan variabel/objek terpisah/SQL mentah).
  // Penulis satu-satunya = scripts/set-platform-provider.ts; prisma/seed.ts dan migrasi baru tak boleh menyebutnya.
  const READERS = ['app/api/v1/admin/system/platform-provider/route.ts', 'lib/auth/adminUsers.ts', 'lib/auth/session.ts', 'lib/revenue-share/settings.ts'] // adminUsers: penyaring akun bayangan
  const mentions = [...files, ...walk('components'), 'prisma/seed.ts'].filter(f => read(f).includes('isPlatformProvider'))
  assert.deepEqual(mentions.sort(), READERS, 'berkas baru yang menyebut isPlatformProvider: tinjau (baca saja) lalu daftarkan, atau pindahkan tulisannya ke skrip')
  const migrations = readdirSync(join(root, 'prisma/migrations')).filter(d => !d.endsWith('.toml') && read(`prisma/migrations/${d}/migration.sql`).includes('isPlatformProvider'))
  assert.deepEqual(migrations, ['20261203090000_platform_provider'], 'migrasi tak boleh menetapkan penanda')
  for (const f of READERS) assert.doesNotMatch(read(f), /isPlatformProvider"?\s*=(?!=)|SET[^;]*isPlatformProvider|data:\s*\{[^}]*isPlatformProvider|\.(update|updateMany|create|upsert)\([^)]*isPlatformProvider/, `${f}: hanya baca`)
  assert.match(read('lib/auth/session.ts'), /isPlatformProvider: user\.isPlatformProvider/)
  const script = read('scripts/set-platform-provider.ts')
  assert.match(script, /updateMany\([\s\S]*role: 'superadmin', isActive: true[\s\S]*sessionVersion: \{ increment: 1 \}/, 'skrip: tulis bersyarat + cabut sesi dalam satu pernyataan')
  assert.doesNotMatch(script, /from '@\//, 'skrip ikut ke image produksi: tanpa alias @/ (hanya @prisma/client)')
  assert.match(read('.dockerignore'), /^!scripts\/set-platform-provider\.ts$/m); assert.match(read('Dockerfile'), /COPY [^\n]*scripts\/set-platform-provider\.ts/)
  for (const v of ['lib/validators/users.ts', 'lib/validators/customers.ts']) { try { assert.doesNotMatch(read(v), /isPlatformProvider/, v) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e } }
  const route = read('app/api/v1/admin/system/platform-provider/route.ts')
  const post = route.slice(route.indexOf('export async function POST'))
  assert.ok(post.indexOf('await requirePlatformProvider()') > 0 && post.indexOf('await requirePlatformProvider()') < post.indexOf('saveRevenueShare('), 'POST: penjaga Platform Provider sebelum menyimpan')
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
  assert.ok(get.indexOf('await requireSuperAdmin()') > 0 && get.indexOf('await requireSuperAdmin()') < get.indexOf('currentRevenueShare('), 'GET: superadmin sebelum membaca')
  assert.match(read('lib/auth/session.ts'), /export async function requirePlatformProvider[\s\S]*requireSuperAdmin\(\)[\s\S]*isPlatformProvider/)
  assert.doesNotMatch(read('app/[locale]/admin/(protected)/system/platform-provider/PlatformProviderEditor.tsx'), /@\/lib\/(revenue-share\/settings|db)'/, 'editor klien hanya membaca API')
  const sistem = (s: boolean) => getAdminNavigation({ isManager: true, isSuperAdmin: s }).find(g => g.label === 'Sistem')?.items.some(i => i.path === '/admin/system/platform-provider') ?? false
  assert.deepEqual([sistem(true), sistem(false)], [true, false])
})

// ── pembersihan: versi setelan append-only (trigger) merujuk akun uji dengan FK Restrict. Di DB SEKALI PAKAI saja, trigger dimatikan untuk transaksi
// pembersih (SET LOCAL session_replication_role — pola test-booking-pilgrim-cards-migration) supaya akun uji tak tersisa (penjaga seed menghitung akun
// non-demo) dan setelan kembali ke bawaan untuk uji berikutnya.
const testUsers = (await prisma.user.findMany({ where: { email: { startsWith: `${tag}-` } }, select: { id: true } })).map(u => u.id)
await prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
  await tx.revenueShareSetting.deleteMany({ where: { createdById: { in: testUsers } } })
})
await prisma.user.deleteMany({ where: { id: { in: testUsers } } })
assert.equal(await prisma.revenueShareSetting.count({ where: { createdById: { in: testUsers } } }), 0)

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
