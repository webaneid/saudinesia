// Uji penulis syarat dokumen produk (lib/documents/requirements.ts, docs/arsitektur-jamaah.md §7.6) terhadap DATABASE SUNGGUHAN: ganti-semua
// berurutan, jenis tak ada / nonaktif baru ditolak (nonaktif yang sudah dipakai tetap boleh), produk tak ada → 404, daftar bawaan visa baru,
// hapus jenis yang menjadi syarat → dinonaktifkan, hapus produk membersihkan syarat, dan penjaga penulis tunggal + konsumen lama yang dihapus.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { prisma } from '@/lib/db'
import { REQUIREMENT_OWNERS, requirementsOf, requirementsOfMany, writeDefaultRequirements, writeRequirements } from '@/lib/documents/requirements'
import { createDocumentType, deleteDocumentType } from '@/lib/documents/types'
import { deletePackage, deleteVisaProduct } from '@/lib/admin/productDelete'
import { deleteOrDeactivateHaji } from '@/lib/haji/delete'
import { documentTypeCreateSchema } from '@/lib/validators/documents'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const tag = `rq${Date.now().toString(36)}`
const types = Object.fromEntries((await prisma.documentType.findMany({ select: { id: true, key: true, label: true } })).map(x => [x.key, x]))
const T = (k: string) => types[k]!.id
const visas: string[] = []
const newVisa = async () => { const v = await prisma.visaProduct.create({ data: { name: `${tag} ${visas.length}`, visaType: 'Umroh' } }); visas.push(v.id); return v.id }
const write = (id: string, items: Parameters<typeof writeRequirements>[3]) => prisma.$transaction(tx => writeRequirements(tx, 'visa', id, items))
const item = (k: string, over: Partial<Parameters<typeof writeRequirements>[3][number]> = {}) => ({ documentTypeId: T(k), label: null, description: '', required: true, ...over })

await t('GANTI-SEMUA: urutan = urutan daftar, label kosong → label katalog, label pengganti dipakai; simpan ulang menggantikan seluruhnya', async () => {
  const v = await newVisa()
  assert.deepEqual(await write(v, [item('ktp'), item('passport', { label: 'Paspor Aktif', description: 'Berwarna' }), item('kk', { required: false })]), { ok: true })
  const got = await requirementsOf('visa', v)
  assert.deepEqual(got.map(r => [r.key, r.label, r.typeLabel, r.required]), [['ktp', types.ktp!.label, types.ktp!.label, true], ['passport', 'Paspor Aktif', types.passport!.label, true], ['kk', types.kk!.label, types.kk!.label, false]])
  assert.equal(got[1]!.minValidityMonths, 6)
  assert.deepEqual(await write(v, [item('vaccine')]), { ok: true })
  assert.deepEqual((await requirementsOf('visa', v)).map(r => r.key), ['vaccine'])
  assert.deepEqual(await write(v, []), { ok: true })
  assert.equal((await requirementsOf('visa', v)).length, 0)
})

await t('DITOLAK: jenis tak ada → 400 + field berindeks; produk tak ada → 404; tak ada yang setengah tertulis', async () => {
  const v = await newVisa()
  await write(v, [item('ktp')])
  const bad = await write(v, [item('passport'), { ...item('ktp'), documentTypeId: '00000000-0000-4000-8000-000000000000' }])
  assert.deepEqual(bad, { ok: false, status: 400, error: 'Jenis dokumen tidak tersedia', field: 'requirements.1.documentTypeId' })
  assert.deepEqual((await requirementsOf('visa', v)).map(r => r.key), ['ktp'], 'daftar lama utuh')
  assert.equal((await write('00000000-0000-4000-8000-000000000000', [item('ktp')])).ok ? 0 : 404, 404)
})

await t('JENIS NONAKTIF: tak bisa ditambahkan baru, tapi syarat yang sudah memakainya tetap bisa disimpan ulang', async () => {
  const made = await createDocumentType(documentTypeCreateSchema.parse({ key: `${tag}_x`, label: 'Surat Uji', icon: 'ScrollText', reusable: true }))
  assert.ok(made.ok)
  const id = made.ok ? made.value.id : ''
  const v1 = await newVisa(), v2 = await newVisa()
  assert.deepEqual(await write(v1, [{ ...item('ktp'), documentTypeId: id }]), { ok: true })
  await prisma.documentType.update({ where: { id }, data: { isActive: false } }) // (uji) setara admin menonaktifkan
  assert.deepEqual(await write(v1, [{ ...item('ktp'), documentTypeId: id, description: 'diubah' }]), { ok: true }, 'sudah dipakai → boleh')
  assert.equal((await write(v2, [{ ...item('ktp'), documentTypeId: id }])).ok, false, 'baru → ditolak')
  // Hapus jenis yang menjadi syarat → hanya dinonaktifkan (FK Restrict), pesan menyebut syarat produk.
  const del = await deleteDocumentType(id)
  assert.equal(del.deleted, false)
  await write(v1, [])
  assert.deepEqual(await deleteDocumentType(id), { deleted: true }, 'tak lagi dirujuk → terhapus')
})

await t('BAWAAN visa baru: paspor, KTP, KK, tiket PP — semua wajib, berurutan', async () => {
  const v = await newVisa()
  assert.deepEqual(await prisma.$transaction(tx => writeDefaultRequirements(tx, 'visa', v)), { ok: true })
  assert.deepEqual((await requirementsOf('visa', v)).map(r => [r.key, r.required]), REQUIREMENT_OWNERS.visa.defaults.map(k => [k, true]))
})

await t('BACA BANYAK: satu kueri, produk tanpa syarat → [], kunci per produk', async () => {
  const a = await newVisa(), b = await newVisa()
  await write(a, [item('kk'), item('ktp')])
  const m = await requirementsOfMany([{ productType: 'visa', productId: a }, { productType: 'visa', productId: b }])
  assert.deepEqual(m.get(`visa:${a}`)!.map(r => r.key), ['kk', 'ktp'])
  assert.deepEqual(m.get(`visa:${b}`), [])
})

await t('HAPUS PRODUK sungguhan membersihkan syaratnya (lib/admin/productDelete.ts)', async () => {
  const v = await newVisa()
  await write(v, [item('ktp')])
  const r = await deleteVisaProduct(v)
  assert.equal(r.deleted, true)
  assert.equal(await prisma.documentRequirement.count({ where: { productType: 'visa', productId: v } }), 0)
})

await t('PENJAGA: document_requirements hanya ditulis lib/documents/requirements.ts; daftar keras & tipe lama tak kembali', () => {
  const root = new URL('..', import.meta.url).pathname
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
  const bad: string[] = []
  for (const f of files) {
    const rel = relative(root, f)
    const src = readFileSync(f, 'utf8')
    if (/\.documentRequirement\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(src) && rel !== 'lib/documents/requirements.ts') bad.push(`${rel}: menulis document_requirements`)
    if (/\b(REQUIRED_DOCUMENTS|DOC_LABEL|VisaRequirement|getDocumentRequirements)\b/.test(src)) bad.push(`${rel}: daftar/tipe syarat lama (D5)`)
    if (/['"]use client['"]/.test(src) && /from ['"]@\/lib\/documents\/requirements['"]/.test(src.replace(/import type [^;]+;?/g, ''))) bad.push(`${rel}: komponen klien mengimpor penulis syarat`)
  }
  assert.deepEqual(bad, [])
})

await t('PAKET & HAJI (V4b): bawaan K3 paspor/KTP/KK/vaksin wajib berurutan; produk tak ada → 404; ganti-semua; hapus produk membersihkan syaratnya', async () => {
  assert.deepEqual([...REQUIREMENT_OWNERS.package.defaults], ['passport', 'ktp', 'kk', 'vaccine'])
  assert.deepEqual([...REQUIREMENT_OWNERS.haji.defaults], ['passport', 'ktp', 'kk', 'vaccine'])
  const pkg = await prisma.package.create({ data: { name: `${tag} paket` }, select: { id: true } })
  const haji = await prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'khusus', year: 2027 }, select: { id: true } })
  for (const [owner, id] of [['package', pkg.id], ['haji', haji.id]] as const) {
    assert.deepEqual(await prisma.$transaction(tx => writeDefaultRequirements(tx, owner, id)), { ok: true })
    assert.deepEqual((await requirementsOf(owner, id)).map(r => [r.key, r.required]), [['passport', true], ['ktp', true], ['kk', true], ['vaccine', true]], owner)
    assert.deepEqual(await prisma.$transaction(tx => writeRequirements(tx, owner, id, [item('kk', { required: false })])), { ok: true })
    assert.deepEqual((await requirementsOf(owner, id)).map(r => [r.key, r.required]), [['kk', false]], `${owner} ganti-semua`)
    assert.deepEqual(await prisma.$transaction(tx => writeRequirements(tx, owner, 'tidak-ada', [item('ktp')])), { ok: false, status: 404, error: 'Produk tidak ditemukan' })
    // Syarat terpisah per pemilik: id yang sama di jenis produk lain tak ikut terbaca.
    assert.deepEqual(await requirementsOf(owner === 'package' ? 'haji' : 'package', id), [])
  }
  assert.equal((await deletePackage(pkg.id)).deleted, true)
  assert.equal(await prisma.documentRequirement.count({ where: { productType: 'package', productId: pkg.id } }), 0, 'hapus paket → syarat bersih')
  const hd = await deleteOrDeactivateHaji(haji.id)
  assert.ok(hd.found && hd.deleted, 'haji belum pernah dipesan → terhapus')
  assert.equal(await prisma.documentRequirement.count({ where: { productType: 'haji', productId: haji.id } }), 0, 'hapus haji → syarat bersih')
})

await t('PENJAGA V4b: rute buat/ubah Paket & Haji menulis syarat lewat writeRequirements di transaksi produk (buat tanpa daftar = bawaan), GET mengembalikan documentRequirements; katalog publik memakai RequiredDocuments', () => {
  const root = new URL('..', import.meta.url).pathname
  const src = (f: string) => readFileSync(join(root, f), 'utf8')
  for (const [f, owner, isCreate] of [
    ['app/api/v1/admin/products/packages/route.ts', 'package', true],
    ['app/api/v1/admin/products/packages/[id]/route.ts', 'package', false],
    ['app/api/v1/admin/products/haji/route.ts', 'haji', true],
    ['app/api/v1/admin/products/haji/[id]/route.ts', 'haji', false],
  ] as const) {
    const s = src(f)
    assert.match(s, new RegExp(`\\$transaction\\([\\s\\S]*writeRequirements\\(tx, '${owner}'`), f)
    if (isCreate) assert.match(s, new RegExp(`writeDefaultRequirements\\(tx, '${owner}'`), f)
    else assert.match(s, new RegExp(`requirementsOf\\('${owner}', id\\)`), f)
  }
  assert.match(src('lib/validators/adminUpdates.ts'), /requirements: documentRequirementListSchema\.optional\(\),\n  \}\)\n  \.strict\(\)/)
  for (const [f, owner] of [['app/[locale]/(public)/packages/page.tsx', 'package'], ['app/[locale]/(public)/haji/page.tsx', 'haji'], ['app/[locale]/(public)/visa/page.tsx', 'visa']] as const) {
    const s = src(f)
    assert.match(s, /<RequiredDocuments requirements=/, f)
    assert.match(s, new RegExp(`productType: '${owner}'`), f)
  }
  for (const f of ['app/[locale]/admin/(protected)/products/packages/[id]/page.tsx', 'app/[locale]/admin/(protected)/products/haji/[id]/page.tsx']) {
    assert.match(src(f), /<RequirementsEditor /, f)
    assert.match(src(f), /requirements: bodyFromRows\(/, f)
  }
})

// Bersihkan (DB uji).
await prisma.documentRequirement.deleteMany({ where: { productId: { in: visas } } })
await prisma.visaProduct.deleteMany({ where: { id: { in: visas } } })
await prisma.documentType.deleteMany({ where: { key: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
