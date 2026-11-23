// Uji Data Jamaah universal D1 (docs/arsitektur-data-jamaah.md): katalog global `pilgrim_fields` + saklar per produk `product_pilgrim_data`.
// Dibuktikan: daftar CHECK migrasi = daftar kode (jenis kolom, peran, pemilik saklar); bentuk katalog bawaan; CHECK DB menolak katalog rusak;
// kolom yang DIMINTA per jamaah (`pilgrimFieldSets`): visa bawaan nyala, katering bawaan mati (tanpa kewajiban — K2), saklar menimpa bawaan,
// produk tingkat booking hanya berlaku untuk rombongannya; penulis tabel hanya lib/pilgrim-data (kecuali pembersih saat produk dihapus).
// DB sekali pakai (assertThrowawayDb).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { prisma } from '@/lib/db'
import { MANIFEST_FIELD_TYPES } from '@/lib/manifest/fieldDefs'
import { MANIFEST_ROLES } from '@/lib/manifest/roles'
import { PILGRIM_DATA_OWNERS, PILGRIM_DATA_OWNER_TYPES } from '@/lib/pilgrim-data/owners'
import { activeFields, displayFields, pilgrimCatalog, valueByRole } from '@/lib/pilgrim-data/catalog'
import { pilgrimFieldSets } from '@/lib/pilgrim-data/forPilgrims'
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
const sql = readFileSync(join(root, 'prisma/migrations/20261212090000_pilgrim_data_catalog/migration.sql'), 'utf8')
const listIn = (name: string) => {
  const from = sql.slice(sql.indexOf(name))
  return [...from.slice(0, from.indexOf('))')).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}

// ── statis ───────────────────────────────────────────────────────────────────────────────────────────────────────────
await t('CHECK migrasi = daftar kode: jenis kolom, peran, pemilik saklar', () => {
  assert.deepEqual(listIn('pilgrim_fields_type_chk'), [...MANIFEST_FIELD_TYPES])
  assert.deepEqual(listIn('pilgrim_fields_role_chk'), [...MANIFEST_ROLES])
  assert.deepEqual(listIn('product_pilgrim_data_type_chk'), [...PILGRIM_DATA_OWNER_TYPES])
})

await t('bawaan saklar: visa/paket umroh/haji nyala, produk tingkat booking mati (keputusan pemilik K2)', () => {
  const on = PILGRIM_DATA_OWNER_TYPES.filter(k => PILGRIM_DATA_OWNERS[k].defaultEnabled).sort()
  assert.deepEqual(on, ['haji', 'package', 'visa'])
})

await t('penulis tunggal: pilgrim_fields/product_pilgrim_data ditulis hanya lib/pilgrim-data; hapus saklar hanya di pembersih produk', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components']) walk(join(root, d))
  const CLEANERS = new Set(['lib/admin/productDelete.ts', 'lib/haji/delete.ts', 'app/api/v1/admin/products/flight/schedules/[id]/route.ts', 'app/api/v1/admin/products/catering/[id]/route.ts'])
  const bad: string[] = []
  for (const f of files) {
    const rel = relative(root, f)
    if (rel.startsWith('lib/pilgrim-data/')) continue
    const src = readFileSync(f, 'utf8')
    if (/pilgrimField\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(src)) bad.push(`${rel}: menulis katalog data jamaah`)
    if (/productPilgrimData\.(create|createMany|update|updateMany|upsert)\b/.test(src)) bad.push(`${rel}: menulis saklar data jamaah`)
    if (/productPilgrimData\.(delete|deleteMany)\b/.test(src) && !CLEANERS.has(rel)) bad.push(`${rel}: menghapus saklar di luar pembersih produk`)
    if (/['"]use client['"]/.test(src) && /from ['"]@\/lib\/pilgrim-data\/(catalog|products|forPilgrims)['"]/.test(src.replace(/import type [^;]+;?/g, ''))) bad.push(`${rel}: komponen klien mengimpor pembaca server`)
  }
  assert.deepEqual(bad, [])
  for (const c of CLEANERS) assert.match(readFileSync(join(root, c), 'utf8'), /productPilgrimData\.deleteMany/, `${c}: pembersih saklar hilang`)
})

await t('kode lama dihapus: getRequirements tak ada lagi; pembaca kolom jamaah tidak memakai set core/visa', () => {
  assert.throws(() => statSync(join(root, 'lib/manifest/getRequirements.ts')))
  for (const f of ['lib/pilgrims/review.ts', 'lib/pilgrims/slots.ts', 'lib/pilgrims/extraFields.ts', 'lib/pilgrims/bookingLink.ts']) {
    const src = readFileSync(join(root, f), 'utf8')
    assert.ok(!/CORE_MANIFEST|manifestFieldRequirement|getRequirements/.test(src), `${f} masih memakai kolom per-produk lama`)
  }
})

// ── DB: katalog bawaan + CHECK ───────────────────────────────────────────────────────────────────────────────────────
const catalog = await pilgrimCatalog()
await t('katalog bawaan: 13 kolom sistem, satu per peran; nama aktif+wajib; NIK/tempat lahir/terbit paspor/alamat nonaktif', () => {
  const sys = catalog.filter(f => f.isSystem)
  assert.equal(sys.length, 13)
  assert.deepEqual(sys.map(f => f.role).sort(), [...MANIFEST_ROLES].sort())
  const name = sys.find(f => f.role === 'display_name')!
  assert.ok(name.isActive && name.required && name.fieldKey === 'fullName')
  for (const k of ['nik', 'birthPlace', 'passportIssuedAt', 'address']) assert.equal(sys.find(f => f.fieldKey === k)!.isActive, false, k)
  assert.deepEqual((sys.find(f => f.fieldKey === 'gender')!.options as { value: string }[]).map(o => o.value), ['male', 'female'])
})

const rejects = async (label: string, fn: () => Promise<unknown>) => { await assert.rejects(fn, label) }
await t('CHECK DB: nama tak bisa dimatikan; kunci/label/opsi/peran salah ditolak; peran ganda ditolak; pemilik saklar asing ditolak', async () => {
  const nameId = catalog.find(f => f.role === 'display_name')!.id
  await rejects('nama nonaktif', () => prisma.pilgrimField.update({ where: { id: nameId }, data: { isActive: false } }))
  await rejects('nama opsional', () => prisma.pilgrimField.update({ where: { id: nameId }, data: { required: false } }))
  await rejects('kunci berawalan angka', () => prisma.pilgrimField.create({ data: { key: '1abc', label: 'X', fieldType: 'text' } }))
  await rejects('kunci dengan garis bawah', () => prisma.pilgrimField.create({ data: { key: 'a_b', label: 'X', fieldType: 'text' } }))
  await rejects('label kosong', () => prisma.pilgrimField.create({ data: { key: 'kosong', label: '  ', fieldType: 'text' } }))
  await rejects('jenis asing', () => prisma.pilgrimField.create({ data: { key: 'asing', label: 'X', fieldType: 'file' } }))
  await rejects('select tanpa opsi', () => prisma.pilgrimField.create({ data: { key: 'pilih', label: 'X', fieldType: 'select' } }))
  await rejects('opsi pada teks', () => prisma.pilgrimField.create({ data: { key: 'teks', label: 'X', fieldType: 'text', options: [{ label: 'A', value: 'a' }] } }))
  await rejects('kolom admin berperan', () => prisma.pilgrimField.create({ data: { key: 'nikDua', label: 'X', fieldType: 'text', role: 'nik', isSystem: true } }))
  await rejects('kolom sistem tanpa peran', () => prisma.pilgrimField.create({ data: { key: 'sistem', label: 'X', fieldType: 'text', isSystem: true } }))
  await rejects('kunci kembar', () => prisma.pilgrimField.create({ data: { key: 'fullName', label: 'X', fieldType: 'text' } }))
  await rejects('pemilik saklar asing', () => prisma.productPilgrimData.create({ data: { productType: 'vendor', productId: 'x', enabled: true } }))
  assert.equal(await prisma.pilgrimField.count({ where: { key: { in: ['1abc', 'a_b', 'kosong', 'asing', 'pilih', 'teks', 'nikDua', 'sistem'] } } }), 0)
})

await t('displayFields: kolom tak diminta tetap tampil bila bernilai (tidak wajib); valueByRole membaca nama tanpa menghafal kunci', () => {
  const demanded = activeFields(catalog).filter(f => f.fieldKey === 'fullName')
  const shown = displayFields(catalog, demanded, { fullName: 'Budi', nik: '••••', passportNumber: '' })
  assert.deepEqual(shown.map(f => f.fieldKey), ['fullName', 'nik'])
  assert.equal(shown.find(f => f.fieldKey === 'nik')!.required, false)
  assert.equal(valueByRole(catalog, { fullName: 'Budi' }, 'display_name'), 'Budi')
  assert.equal(valueByRole([], { fullName: 'Budi' }, 'display_name'), null)
})

// ── DB: kolom yang diminta per jamaah ────────────────────────────────────────────────────────────────────────────────
const tag = `pd${Date.now()}`
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: tag, role: 'pilgrim' } })
const visa = await prisma.visaProduct.create({ data: { name: `${tag} visa`, visaType: 'Umroh' } })
const catering = await prisma.cateringOption.create({ data: { name: `${tag} katering`, boardType: 'full', menuStyle: 'indonesia' } })
const booking = await prisma.booking.create({ data: { bookingCode: `BK-${tag}`, userId: user.id, status: 'active', season: 'regular', totalAmount: 1 } })
const [g1, g2] = await Promise.all([1, 2].map(position => prisma.bookingGroup.create({ data: { bookingId: booking.id, position } })))
const pilgrim = (groupId: string | null) => prisma.bookingPilgrim.create({ data: { bookingId: booking.id, groupId, fieldValues: {} }, select: { id: true } })
const withVisa = await pilgrim(g1!.id)
await prisma.visaApplication.create({ data: { bookingPilgrimId: withVisa.id, visaType: 'umrah', visaProductId: visa.id } })
const inG1 = await pilgrim(g1!.id)
const inG2 = await pilgrim(g2!.id)
const active = activeFields(catalog).map(f => f.fieldKey)
const demandedOf = async () => {
  const m = await pilgrimFieldSets(prisma, [withVisa.id, inG1.id, inG2.id])
  return { visa: m.get(withVisa.id)!.demanded.map(f => f.fieldKey), g1: m.get(inG1.id)!.demanded.map(f => f.fieldKey), g2: m.get(inG2.id)!.demanded.map(f => f.fieldKey) }
}

await t('visa (bawaan nyala) → jamaah ber-visa diminta SEMUA kolom aktif; jamaah lain tanpa produk → tak diminta apa pun', async () => {
  assert.deepEqual(await demandedOf(), { visa: active, g1: [], g2: [] })
})

await t('saklar visa dimatikan → tak ada kewajiban data sama sekali (K2)', async () => {
  await prisma.productPilgrimData.create({ data: { productType: 'visa', productId: visa.id, enabled: false } })
  assert.deepEqual(await demandedOf(), { visa: [], g1: [], g2: [] })
  await prisma.productPilgrimData.delete({ where: { productType_productId: { productType: 'visa', productId: visa.id } } })
})

await t('katering rombongan 2: bawaan mati → tanpa kewajiban; saklar nyala → hanya jamaah rombongan 2; tanpa rombongan → semua jamaah', async () => {
  const item = await prisma.bookingCatering.create({ data: { bookingId: booking.id, groupId: g2!.id, cateringOptionId: catering.id, startDate: new Date('2027-01-01'), endDate: new Date('2027-01-02'), numDays: 2, numPeople: 1, totalPrice: 1 } })
  assert.deepEqual(await demandedOf(), { visa: active, g1: [], g2: [] })
  await prisma.productPilgrimData.create({ data: { productType: 'catering', productId: catering.id, enabled: true } })
  assert.deepEqual(await demandedOf(), { visa: active, g1: [], g2: active })
  await prisma.bookingCatering.update({ where: { id: item.id }, data: { groupId: null } })
  assert.deepEqual(await demandedOf(), { visa: active, g1: active, g2: active })
})

await t('kolom aktif baru di katalog langsung diminta; nonaktif = tak diminta', async () => {
  const f = await prisma.pilgrimField.create({ data: { key: `uji${Date.now()}`, label: 'Kolom uji', fieldType: 'text', order: 999 } })
  try {
    assert.ok((await demandedOf()).visa.includes(f.key))
    await prisma.pilgrimField.update({ where: { id: f.id }, data: { isActive: false } })
    assert.ok(!(await demandedOf()).visa.includes(f.key))
  } finally { await prisma.pilgrimField.delete({ where: { id: f.id } }) }
})

// ── pembersihan (DB uji) ────────────────────────────────────────────────────────────────────────────────────────────
await prisma.productPilgrimData.deleteMany({ where: { productId: { in: [visa.id, catering.id] } } })
await prisma.booking.delete({ where: { id: booking.id } })
await prisma.cateringOption.delete({ where: { id: catering.id } })
await prisma.visaProduct.delete({ where: { id: visa.id } })
await prisma.user.delete({ where: { id: user.id } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
