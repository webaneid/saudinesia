// Uji kolom data jamaah produk (docs/arsitektur-manifest.md §9) terhadap DATABASE SUNGGUHAN: bawaan produk baru, ganti-semua dengan kunci stabil, kunci baru dari label,
// penolakan bentuk/peran/data rahasia, penguncian tipe setelah dipesan, kunci stale, dan penjaga penulis tunggal.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { prisma } from '@/lib/db'
import { STANDARD_FIELDS, fieldKeyFromLabel, uniqueFieldKey } from '@/lib/manifest/fieldDefs'
import { ManifestFieldsRejected, manifestFieldsForEditor, writeDefaultManifestFields, writeManifestFields } from '@/lib/manifest/fields'
import { MANIFEST_ROLES } from '@/lib/manifest/roles'
import { manifestFieldListSchema, type ManifestFieldInput } from '@/lib/validators/manifest'
import { bodyFromManifestRows, defaultRows, newFreeRow, rowFromField } from '@/components/admin/manifest/manifestRows'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const tag = `mf${Date.now().toString(36)}`
const visas: string[] = []
const newVisa = async () => { const v = await prisma.visaProduct.create({ data: { name: `${tag} ${visas.length}`, visaType: 'Umroh' } }); visas.push(v.id); return v.id }
const defaults = () => prisma.$transaction(async tx => { const id = await tx.visaProduct.create({ data: { name: `${tag} d${visas.length}`, visaType: 'Umroh' } }); visas.push(id.id); await writeDefaultManifestFields(tx, 'visa', id.id); return id.id })
const write = (id: string, items: ManifestFieldInput[]) => prisma.$transaction(tx => writeManifestFields(tx, 'visa', id, items))
const editor = (id: string) => manifestFieldsForEditor('visa', id)
const asInput = (f: Awaited<ReturnType<typeof editor>>['fields'][number]): ManifestFieldInput => ({ fieldKey: f.fieldKey, label: f.label, fieldType: f.fieldType as ManifestFieldInput['fieldType'], required: f.required, role: f.role as ManifestFieldInput['role'], options: f.options })
const name: ManifestFieldInput = { fieldKey: null, label: 'Nama Lengkap', fieldType: 'text', required: true, role: 'display_name', options: null }
const free = (label: string, over: Partial<ManifestFieldInput> = {}): ManifestFieldInput => ({ fieldKey: null, label, fieldType: 'text', required: true, role: null, options: null, ...over })
const message = (r: ReturnType<typeof manifestFieldListSchema.safeParse>) => (r.success ? '' : r.error.issues.map(i => i.message).join(' | '))

await t('BAWAAN: produk baru mendapat 9 kolom standar dengan peran, urut, nama wajib', async () => {
  const { fields, used } = await editor(await defaults())
  assert.equal(used, false)
  assert.deepEqual(fields.map(f => f.fieldKey), ['fullName', 'gender', 'email', 'phone', 'whatsapp', 'passportNumber', 'passportExpiry', 'nationality', 'dateOfBirth'])
  assert.equal(fields[0]!.required, true)
  assert.deepEqual(fields[1]!.options?.map(o => o.value), ['male', 'female'])
  assert.equal(fields.every(f => f.role), true)
  assert.equal(manifestFieldListSchema.safeParse(fields.map(asInput)).success, true, 'bawaan harus lolos validator sendiri')
})

await t('STANDAR: semua peran sistem punya tepat satu kolom standar yang lolos validator', () => {
  assert.deepEqual(STANDARD_FIELDS.map(f => f.role).sort(), [...MANIFEST_ROLES].sort())
  const list: ManifestFieldInput[] = STANDARD_FIELDS.map(f => ({ fieldKey: null, label: f.label, fieldType: f.fieldType, required: f.required, role: f.role, options: f.options ? [...f.options] : null }))
  const r = manifestFieldListSchema.safeParse(list)
  assert.equal(r.success, true, message(r))
})

await t('TAMBAH: kolom bebas mendapat kunci dari label; kunci lama tetap; urutan = urutan daftar', async () => {
  const id = await defaults()
  const before = (await editor(id)).fields.map(asInput)
  await write(id, [free('Short Address / Unwan Wathoni'), ...before, free('Nomor HP Host', { fieldType: 'phone' })])
  const after = (await editor(id)).fields
  assert.equal(after[0]!.fieldKey, 'shortAddressUnwanWathoni')
  assert.equal(after.at(-1)!.fieldKey, 'nomorHpHost')
  assert.equal(after.at(-1)!.fieldType, 'phone')
  assert.deepEqual(after.slice(1, -1).map(f => f.fieldKey), before.map(f => f.fieldKey))
  // Menyimpan ulang apa adanya tak mengubah apa pun.
  await write(id, after.map(asInput))
  assert.deepEqual((await editor(id)).fields, after)
})

await t('KUNCI: label kembar dan nama properti bawaan objek tidak menghasilkan kunci bentrok', async () => {
  const id = await newVisa()
  await write(id, [name, free('Catatan'), free('Catatan!'), free('constructor'), free('Email')])
  const keys = (await editor(id)).fields.map(f => f.fieldKey)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(keys.includes('constructor'), false)
  assert.equal(keys.includes('email'), false, 'kolom bebas tak boleh memakai kunci standar')
  assert.equal(fieldKeyFromLabel('٣٤'), 'kolom')
  assert.equal(uniqueFieldKey('toString', new Set()), 'toString2')
})

await t('DITOLAK validator: tanpa nama, nama opsional, peran ganda, tipe tak sesuai peran, PII di kolom bebas, pilihan kurang, kunci aneh, kolom asing', () => {
  const bad = (list: unknown, want: RegExp) => { const r = manifestFieldListSchema.safeParse(list); assert.equal(r.success, false, `mestinya ditolak: ${String(want)}`); assert.match(message(r), want) }
  bad([free('Catatan')], /Nama Lengkap wajib ada/)
  bad([], /Nama Lengkap wajib ada/)
  bad([{ ...name, required: false }], /Nama Lengkap harus wajib/)
  bad([name, name], /dipilih dua kali/)
  bad([{ ...name, fieldType: 'number' }], /tidak sesuai peran/)
  bad([name, { ...free('Paspor'), role: 'passport_number', fieldType: 'number' }], /tidak sesuai peran/)
  for (const label of ['NIK', 'Nomor KTP', 'No. Paspor', 'passport number', 'Nomor Induk Kependudukan']) bad([name, free(label)], /kolom standar/)
  bad([name, free('Ukuran', { fieldType: 'select', options: [{ label: 'S', value: 'S' }] })], /minimal 2 pilihan/)
  bad([name, free('Ukuran', { fieldType: 'select', options: [{ label: 'S', value: 'S' }, { label: 'S2', value: 'S' }] })], /pilihan yang sama/)
  bad([name, free('Catatan', { options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }] })], /hanya tipe Pilihan/)
  bad([name, { ...free('Kelamin'), role: 'gender', fieldType: 'select', options: [{ label: 'x', value: 'x' }, { label: 'y', value: 'y' }] }], /laki-laki/)
  bad([name, { ...free('Catatan'), fieldKey: '__proto__' }], /Kunci kolom tidak valid/)
  assert.equal(manifestFieldListSchema.safeParse([{ ...name, extra: 1 }]).success, false, 'kolom asing harus ditolak')
  assert.equal(manifestFieldListSchema.safeParse([{ ...name, fieldType: 'html' }]).success, false, 'tipe asing harus ditolak')
  assert.equal(manifestFieldListSchema.safeParse([{ ...name, role: 'admin' }]).success, false, 'peran asing harus ditolak')
})

await t('KUNCI BASI: kunci yang tak dimiliki produk ditolak, data tetap utuh; produk tak ada ditolak', async () => {
  const id = await defaults()
  const before = (await editor(id)).fields
  await assert.rejects(write(id, [...before.map(asInput), { ...free('Sisipan'), fieldKey: 'bukanMilikProduk' }]), ManifestFieldsRejected)
  assert.deepEqual((await editor(id)).fields, before)
  await assert.rejects(write('00000000-0000-0000-0000-000000000000', [name]), ManifestFieldsRejected)
})

await t('SUDAH DIPESAN: tipe kolom lama terkunci; label/wajib/urutan boleh; kolom baru bersufiks acak; hapus kolom tak menyentuh nilai jamaah', async () => {
  const id = await defaults()
  await write(id, [...(await editor(id)).fields.map(asInput), free('Nomor HP Host')])
  const user = await prisma.user.create({ data: { email: `${tag}@test.local`, fullName: tag, role: 'pilgrim', isActive: true, passwordHash: 'x' } })
  const booking = await prisma.booking.create({ data: { bookingCode: tag.slice(0, 20), userId: user.id, status: 'active', totalAmount: 0, season: 'regular' } })
  const pilgrim = await prisma.bookingPilgrim.create({ data: { bookingId: booking.id, fieldValues: { fullName: 'Budi', nomorHpHost: '0812' } }, select: { id: true } })
  await prisma.visaApplication.create({ data: { bookingPilgrimId: pilgrim.id, visaProductId: id, visaType: 'Umroh', status: 'pending_documents' } })
  try {
    const { fields, used } = await editor(id)
    assert.equal(used, true)
    const host = fields.find(f => f.fieldKey === 'nomorHpHost')!
    await assert.rejects(write(id, fields.map(f => (f === host ? { ...asInput(f), fieldType: 'phone' as const } : asInput(f)))), /tipenya tidak bisa diubah/)
    const passport = fields.find(f => f.role === 'passport_number')!
    await assert.rejects(write(id, fields.map(f => (f === passport ? { ...asInput(f), role: null, label: 'Nomor Dokumen' } : asInput(f)))), /tipenya tidak bisa diubah/, 'melepas peran paspor membuat nilai berikutnya tak tersegel')
    // Kolom standar dikirim tanpa kunci (hapus lalu tambah lagi): tetap kena kunci tipe, bukan jalan pintas.
    const address = { fieldKey: null, label: 'Alamat', fieldType: 'address' as const, required: false, role: 'address' as const, options: null }
    await write(id, [...fields.map(asInput), address])
    await assert.rejects(write(id, [...fields.map(asInput), { ...address, fieldType: 'text' as const }]), /tipenya tidak bisa diubah/, 'tipe alamat tak boleh berganti lewat kunci kosong')
    await write(id, fields.map(f => (f === host ? { ...asInput(f), label: 'HP Pemilik Rumah', required: false } : asInput(f))).reverse())
    const renamed = (await editor(id)).fields
    assert.equal(renamed[0]!.label, 'HP Pemilik Rumah')
    assert.equal(renamed[0]!.fieldKey, 'nomorHpHost', 'kunci tak boleh berubah')
    // Hapus lalu buat kolom berlabel sama: kunci baru, jadi tak menempel ke nilai lama.
    await write(id, renamed.filter(f => f.fieldKey !== 'nomorHpHost').map(asInput))
    await write(id, [...(await editor(id)).fields.map(asInput), free('Nomor HP Host', { fieldType: 'phone' })])
    const recreated = (await editor(id)).fields.at(-1)!
    assert.notEqual(recreated.fieldKey, 'nomorHpHost')
    assert.match(recreated.fieldKey, /^nomorHpHost_[0-9a-f]{6}$/)
    const stored = await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: pilgrim.id }, select: { fieldValues: true } })
    assert.deepEqual(stored.fieldValues, { fullName: 'Budi', nomorHpHost: '0812' })
  } finally {
    await prisma.visaApplication.deleteMany({ where: { bookingPilgrimId: pilgrim.id } })
    await prisma.bookingPilgrim.delete({ where: { id: pilgrim.id }, select: { id: true } })
    await prisma.booking.delete({ where: { id: booking.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
})

await t('BARIS EDITOR: kolom baru tanpa kunci; pilihan lama mempertahankan nilainya; kolom standar memakai pilihan tetap; bawaan lolos validator', () => {
  assert.equal(manifestFieldListSchema.safeParse(bodyFromManifestRows(defaultRows())).success, true)
  const legacy = rowFromField({ fieldKey: 'ukuran', label: 'Ukuran', fieldType: 'select', required: true, role: null, options: [{ label: 'Kecil', value: 'S' }, { label: 'Besar', value: 'L' }] })
  assert.deepEqual(bodyFromManifestRows([{ ...legacy, optionsText: 'Kecil\n\n  Sedang \nBesar' }])[0]!.options, [{ label: 'Kecil', value: 'S' }, { label: 'Sedang', value: 'Sedang' }, { label: 'Besar', value: 'L' }])
  const body = bodyFromManifestRows([{ ...newFreeRow(), label: ' Catatan ' }])[0]!
  assert.equal(body.fieldKey, null)
  assert.equal(body.label, 'Catatan')
  assert.equal(body.options, null)
  const gender = bodyFromManifestRows(defaultRows()).find(r => r.role === 'gender')!
  assert.deepEqual(gender.options?.map(o => o.value), ['male', 'female'])
})

await t('PENJAGA: hanya lib/manifest/fields.ts yang menulis kolom (penghapus produk boleh deleteMany); route visa memanggil penulisnya', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.tsx?$/.test(name) || relative(process.cwd(), p) === join('lib', 'manifest', 'fields.ts')) continue
      if (/manifestFieldRequirement\.(create|createMany|update|updateMany|upsert|delete)\b/.test(readFileSync(p, 'utf8'))) offenders.push(p)
    }
  }
  for (const root of ['app', 'lib', 'components']) walk(root)
  assert.deepEqual(offenders, [])
  assert.match(readFileSync('app/api/v1/admin/products/visa/route.ts', 'utf8'), /writeDefaultManifestFields\(tx, 'visa'/)
  assert.match(readFileSync('app/api/v1/admin/products/visa/[id]/route.ts', 'utf8'), /writeManifestFields\(tx, 'visa'/)
})

for (const id of visas) await prisma.manifestFieldRequirement.deleteMany({ where: { productType: 'visa', productId: id } })
await prisma.visaProduct.deleteMany({ where: { id: { in: visas } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
