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
import { pilgrimDataState, setPilgrimDataEnabled } from '@/lib/pilgrim-data/products'
import { createPilgrimField, deletePilgrimField, fieldUsage, updatePilgrimField } from '@/lib/pilgrim-data/fields'
import { pilgrimFieldCreateSchema, pilgrimFieldUpdateSchema } from '@/lib/validators/pilgrimFields'
import { cardBoundKeys, snapshotFromCard, type CardForSnapshot } from '@/lib/manifest/roles'
import { sealNewPilgrim } from '@/lib/pilgrims/bookingLink'
import { bookingPilgrimSlots } from '@/lib/pilgrims/slots'
import { cardExtraFields } from '@/lib/pilgrim-data/catalog'
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
  for (const f of ['lib/pilgrims/review.ts', 'lib/pilgrims/slots.ts', 'lib/pilgrims/bookingLink.ts']) {
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

// ── D2: penulis katalog (lib/pilgrim-data/fields.ts) + route admin ───────────────────────────────────────────────
const sysId = (key: string) => catalog.find(f => f.fieldKey === key)!.id
const parseCreate = (x: unknown) => pilgrimFieldCreateSchema.safeParse(x)

await t('D2 validator: kode camelCase saja; label NIK/paspor ditolak; Pilihan wajib ≥ 2 dan unik; opsi pada teks ditolak; alamat bukan tipe kolom admin; kunci asing ditolak', () => {
  assert.ok(parseCreate({ key: 'golonganDarah', label: 'Golongan Darah', fieldType: 'text' }).success)
  for (const bad of [
    { key: 'golongan_darah', label: 'Golongan Darah', fieldType: 'text' }, { key: 'Gol', label: 'Golongan', fieldType: 'text' },
    { key: 'constructor', label: 'Konstruktor', fieldType: 'text' }, { key: 'nomorKtp', label: 'Nomor KTP Ayah', fieldType: 'text' },
    { key: 'pilih', label: 'Pilih', fieldType: 'select', options: [{ label: 'A', value: 'a' }] },
    { key: 'pilih', label: 'Pilih', fieldType: 'select', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'a' }] },
    { key: 'teks', label: 'Teks', fieldType: 'text', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
    { key: 'alamatKos', label: 'Alamat Kos', fieldType: 'address' }, { key: 'x1', label: 'X Satu', fieldType: 'text', role: 'nik' },
  ]) assert.equal(parseCreate(bad).success, false, JSON.stringify(bad))
  assert.equal(pilgrimFieldUpdateSchema.safeParse({ key: 'baru' }).success, false, 'kunci tak pernah diubah')
})

await t('D2 buat: kolom admin tanpa peran/bawaan; kode kembar → 409', async () => {
  const r = await createPilgrimField(pilgrimFieldCreateSchema.parse({ key: 'golonganDarah', label: 'Golongan Darah', fieldType: 'select', options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }] }))
  assert.ok(r.ok)
  const row = await prisma.pilgrimField.findUniqueOrThrow({ where: { key: 'golonganDarah' } })
  assert.deepEqual([row.role, row.isSystem, row.isActive, row.required], [null, false, true, false])
  const dup = await createPilgrimField(pilgrimFieldCreateSchema.parse({ key: 'golonganDarah', label: 'Lagi', fieldType: 'text' }))
  assert.ok(!dup.ok && dup.status === 409 && dup.field === 'key')
  const sys = await createPilgrimField(pilgrimFieldCreateSchema.parse({ key: 'fullName', label: 'Nama Lain', fieldType: 'text' }))
  assert.ok(!sys.ok && sys.status === 409, 'kode kolom bawaan tak bisa dipakai ulang')
})

await t('D2 ubah bawaan: label/wajib/urutan/aktif boleh; tipe/pilihan ditolak; Nama Lengkap tak bisa dimatikan/opsional', async () => {
  const pp = sysId('passportNumber')
  assert.ok((await updatePilgrimField(pp, { label: 'No. Paspor', required: true, order: 5 })).ok)
  const after = await prisma.pilgrimField.findUniqueOrThrow({ where: { id: pp } })
  assert.deepEqual([after.label, after.required, after.fieldType, after.key], ['No. Paspor', true, 'text', 'passportNumber'])
  const t1 = await updatePilgrimField(pp, { fieldType: 'number' }); assert.ok(!t1.ok && t1.field === 'fieldType')
  const t2 = await updatePilgrimField(sysId('gender'), { options: [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }] }); assert.ok(!t2.ok && t2.field === 'options')
  for (const p of [{ isActive: false }, { required: false }]) { const r = await updatePilgrimField(sysId('fullName'), p); assert.ok(!r.ok && r.status === 400, JSON.stringify(p)) }
  await prisma.pilgrimField.update({ where: { id: pp }, data: { label: 'Nomor Paspor', required: false, order: 5 } }) // pulihkan
  assert.ok(!(await updatePilgrimField('00000000-0000-0000-0000-000000000000', { label: 'Ada' })).ok)
})

await t('D2 ubah admin: tipe boleh diganti selama belum berisi data, ditolak sesudahnya; select tanpa pilihan cukup ditolak; label NIK ditolak', async () => {
  const id = (await prisma.pilgrimField.findUniqueOrThrow({ where: { key: 'golonganDarah' } })).id
  assert.ok((await updatePilgrimField(id, { fieldType: 'text' })).ok, 'belum dipakai → boleh')
  assert.equal((await prisma.pilgrimField.findUniqueOrThrow({ where: { id } })).options, null, 'pilihan dibuang saat bukan Pilihan')
  const sel = await updatePilgrimField(id, { fieldType: 'select' }); assert.ok(!sel.ok && sel.field === 'options')
  const nik = await updatePilgrimField(id, { label: 'NIK Ibu' }); assert.ok(!nik.ok && nik.field === 'label')
  await prisma.bookingPilgrim.update({ where: { id: inG2.id }, data: { fieldValues: { golonganDarah: 'O' } } })
  assert.deepEqual(await fieldUsage('golonganDarah'), { bookingPilgrims: 1, cards: 0 })
  const locked = await updatePilgrimField(id, { fieldType: 'number' }); assert.ok(!locked.ok && locked.field === 'fieldType')
  assert.ok((await updatePilgrimField(id, { label: 'Gol. Darah', required: true })).ok, 'label/wajib tetap boleh')
})

await t('D2 hapus-aman: berisi data → nonaktif; tak dipakai → terhapus; bawaan → nonaktif (bisa diaktifkan lagi)', async () => {
  const used = (await prisma.pilgrimField.findUniqueOrThrow({ where: { key: 'golonganDarah' } })).id
  const r1 = await deletePilgrimField(used)
  assert.ok(!r1.deleted && (await prisma.pilgrimField.findUniqueOrThrow({ where: { id: used } })).isActive === false)
  await prisma.bookingPilgrim.update({ where: { id: inG2.id }, data: { fieldValues: {} } })
  assert.deepEqual(await deletePilgrimField(used), { deleted: true }, 'sesudah tak dipakai → hapus sungguhan')
  const bp = sysId('birthPlace')
  const r3 = await deletePilgrimField(bp)
  assert.ok(!r3.deleted)
  assert.ok((await updatePilgrimField(bp, { isActive: true })).ok)
  await prisma.pilgrimField.update({ where: { id: bp }, data: { isActive: false } }) // pulihkan bawaan migrasi
  await assert.rejects(() => deletePilgrimField('00000000-0000-0000-0000-000000000000'), (e: unknown) => (e as { code?: string }).code === 'P2025')
})

await t('D2 route: requireManager di setiap handler, memakai penulis tunggal, Nama Lengkap tak bisa dihapus, menu Produk → Data Jamaah', () => {
  const list = readFileSync(join(root, 'app/api/v1/admin/products/pilgrim-fields/route.ts'), 'utf8')
  const one = readFileSync(join(root, 'app/api/v1/admin/products/pilgrim-fields/[id]/route.ts'), 'utf8')
  for (const [src, n] of [[list, 2], [one, 3]] as const) assert.equal(src.match(/await requireManager\(\)/g)?.length, n)
  assert.ok(list.includes('createPilgrimField(') && one.includes('updatePilgrimField(') && one.includes('deletePilgrimField(') && one.includes("role === 'display_name'"))
  const nav = readFileSync(join(root, 'lib/admin/navigation.ts'), 'utf8')
  assert.ok(nav.indexOf("'/admin/products/pilgrim-fields'") > nav.indexOf("'/admin/products/document-types'"), 'menu Data Jamaah di bawah Jenis Dokumen')
})

// ── D3: saklar per produk (setPilgrimDataEnabled) + editor ─────────────────────────────────────────────────────────
await t('D3 saklar: produk tak ada → null; bawaan terbaca tanpa baris; tulis eksplisit tersimpan dan langsung mengubah kolom yang diminta', async () => {
  const ghost = { productType: 'visa' as const, productId: '00000000-0000-0000-0000-000000000000' }
  assert.equal(await pilgrimDataState(ghost), null)
  assert.equal(await setPilgrimDataEnabled(ghost, true), null)
  assert.equal(await prisma.productPilgrimData.count({ where: { productId: ghost.productId } }), 0, 'tak ada baris untuk produk tak ada')
  const cat = { productType: 'catering' as const, productId: catering.id }
  assert.deepEqual(await setPilgrimDataEnabled(cat, false), { enabled: false, defaultEnabled: false, stored: true }, 'katering (semua jamaah, dari uji rombongan) dimatikan lewat penulis')
  assert.deepEqual(await demandedOf(), { visa: active, g1: [], g2: [] })
  const ref = { productType: 'visa' as const, productId: visa.id }
  assert.deepEqual(await pilgrimDataState(ref), { enabled: true, defaultEnabled: true, stored: false })
  assert.deepEqual(await setPilgrimDataEnabled(ref, false), { enabled: false, defaultEnabled: true, stored: true })
  assert.deepEqual((await demandedOf()).visa, [], 'mati → visa tak meminta data')
  assert.deepEqual(await setPilgrimDataEnabled(ref, true), { enabled: true, defaultEnabled: true, stored: true })
  assert.deepEqual((await demandedOf()).visa, activeFields(await pilgrimCatalog()).map(f => f.fieldKey))
  assert.equal(await prisma.productPilgrimData.count({ where: { productType: 'catering', productId: catering.id } }), 1, 'upsert, bukan baris ganda')
})

await t('D3 editor: setiap jenis pemilik saklar punya <PilgrimDataToggle productType="…"> di halaman edit/kelolanya; route manager+ & strict', () => {
  const A = join(root, 'app/[locale]/admin/(protected)/products')
  const PAGE: Record<string, string> = {
    visa: 'visa/[id]/page.tsx', package: 'packages/[id]/page.tsx', haji: 'haji/[id]/page.tsx', tour_package: 'tour-packages/[id]/page.tsx',
    hotel: 'hotels/[id]/page.tsx', transport: 'transport/trips/[id]/page.tsx', flight: 'flight/[id]/page.tsx', catering: 'catering/[id]/page.tsx',
    muthowif: 'muthowif/page.tsx',
  }
  assert.deepEqual(Object.keys(PAGE).sort(), [...PILGRIM_DATA_OWNER_TYPES].sort(), 'jenis pemilik baru → tambahkan halamannya di sini')
  for (const [type, page] of Object.entries(PAGE)) assert.match(readFileSync(join(A, page), 'utf8'), new RegExp(`<PilgrimDataToggle productType="${type}"`), `${page}: saklar ${type} hilang`)
  const route = readFileSync(join(root, 'app/api/v1/admin/products/pilgrim-data/route.ts'), 'utf8')
  assert.equal(route.match(/await requireManager\(\)/g)?.length, 2)
  assert.equal(route.match(/\.strict\(\)/g)?.length, 2)
  assert.ok(route.includes('setPilgrimDataEnabled(') && route.includes('z.string().uuid()'))
})

await t('D4 snapshot: kolom buatan admin dari `extra` kartu (kosong → dikosongkan), kolom berperan tetap dari atribut; semua kolom katalog terikat kartu', () => {
  const fields = [{ fieldKey: 'fullName', fieldType: 'text', role: 'display_name' }, { fieldKey: 'golDarah', fieldType: 'select', role: null }, { fieldKey: 'catatan', fieldType: 'text', role: null }]
  const card: CardForSnapshot = { fullName: 'Budi', gender: null, birthPlace: null, birthDate: null, nationality: 'ID', hasNik: false, passportLast4: null, passportIssuedAt: null, passportExpiry: null, phone: null, whatsapp: null, email: null, address: null }
  assert.deepEqual(snapshotFromCard(fields, { ...card, extra: { golDarah: 'a' } }), { fullName: 'Budi', golDarah: 'a', catatan: null })
  assert.deepEqual(snapshotFromCard(fields, card), { fullName: 'Budi' }, 'tanpa extra: kolom tanpa peran tak disentuh')
  assert.deepEqual(snapshotFromCard(fields, { ...card, extra: { __proto__: 'x', toString: 'y' } as Record<string, unknown> }), { fullName: 'Budi', golDarah: null, catatan: null }, 'hanya kunci milik sendiri')
  assert.deepEqual(cardBoundKeys(fields), ['fullName', 'golDarah', 'catatan'])
  const admin = { id: 'x', fieldKey: 'golDarah', label: 'G', fieldType: 'text', options: null, required: false, role: null, isSystem: false, isActive: true, order: 1 }
  assert.deepEqual(cardExtraFields([...catalog, admin, { ...admin, fieldKey: 'mati', isActive: false }]).map(f => f.fieldKey), ['golDarah'], 'hanya kolom admin aktif')
})

await t('D4 booking baru: isian jamaah dinilai di server atas katalog — kunci asing / bentuk salah ditolak (gap manifest §9)', async () => {
  const run = (values: Record<string, unknown>) => prisma.$transaction(async (tx) => sealNewPilgrim(tx, values))
  const unknown = await run({ tidakAda: 'x' })
  assert.ok(!unknown.ok && 'tidakAda' in unknown.errors)
  const bad = await run({ dateOfBirth: 'kemarin' })
  assert.ok(!bad.ok && 'dateOfBirth' in bad.errors && bad.labels?.dateOfBirth, JSON.stringify(bad))
})

await t('D4 slot: `needed` = produk meminta kolom atau dokumen; jamaah tanpa kewajiban tidak diminta apa pun; halaman pelanggan menyembunyikan tabel', async () => {
  const rows = await prisma.bookingPilgrim.findMany({ where: { bookingId: booking.id }, orderBy: { id: 'asc' }, select: { id: true, savedPilgrimId: true, fieldValues: true, reviewStatus: true, visaApplication: { select: { status: true, plannedTravelDate: true, visaProductId: true } } } })
  const { slots } = await bookingPilgrimSlots(booking.id, null, rows)
  const byId = new Map(slots.map(x => [x.id, x.needed]))
  assert.deepEqual([byId.get(withVisa.id), byId.get(inG1.id), byId.get(inG2.id)], [true, false, false])
  const page = readFileSync(join(root, 'app/[locale]/(pilgrim)/bookings/[id]/page.tsx'), 'utf8')
  assert.ok(page.includes('slots.some(x => x.needed)') && page.includes("t('booking.pilgrimsNotNeeded'"))
})

await t('D4 sumber: kartu = satu-satunya jalur isian pelanggan (route PUT isian tambahan & layanannya dihapus); formulir kartu memuat kolom tambahan; definisi butuh sesi', () => {
  const exists = (f: string) => { try { statSync(join(root, f)); return true } catch { return false } }
  assert.ok(!exists('lib/pilgrims/extraFields.ts') && !exists('app/[locale]/(pilgrim)/bookings/[id]/PilgrimExtraFields.tsx'))
  assert.ok(!/export async function PUT/.test(readFileSync(join(root, 'app/api/v1/bookings/[id]/pilgrims/[pilgrimId]/route.ts'), 'utf8')))
  const fieldsUi = readFileSync(join(root, 'components/shared/pilgrims/SavedPilgrimFields.tsx'), 'utf8')
  assert.ok(fieldsUi.includes('useCardExtraFields()') && fieldsUi.includes('<ManifestFieldsForm'))
  const route = readFileSync(join(root, 'app/api/v1/pilgrim-fields/route.ts'), 'utf8')
  assert.ok(route.includes('await getSession()') && route.includes("'unauthorized', 401") && route.includes('cardExtraFields('))
  assert.ok(readFileSync(join(root, 'lib/pilgrims/bookingLink.ts'), 'utf8').includes('extraValues: true'), 'snapshot membaca extraValues kartu')
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
