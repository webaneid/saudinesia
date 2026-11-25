// Data wilayah Indonesia ikut deploy (docs/arsitektur-alamat.md §10): isi berkas, pengisian idempoten yang gagal-tertutup lewat skrip image migrate
// SUNGGUHAN, aturan isian formulir alamat, dan penjaga sumber. Hanya pada database sekali pakai (nama memuat test/_ci/tmp).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { EXPECTED_COUNTS, parseWilayah, wilayahStatements } from '../prisma/wilayah'
import { PROVINCE_ALIASES } from '@/lib/address/aliases'
import { addressForBody, hasAddressInput } from '@/lib/address/input'
import { addressSchema } from '@/lib/validators/address'
import { isEmptyAddress } from '@/lib/manifest/addressValue'
import { matchOptions } from '@/lib/ui/combobox'

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}
const sql = readFileSync('prisma/data/wilayah.sql', 'utf8')
const levels = parseWilayah(sql)
const name = (i: number, id: string) => levels[i]!.rows.find(r => r.id === id)?.name

await t('berkas data: 38/514/7285/83762; apostrof, induk, dan jenis kab/kota benar; setiap induk punya anak (daftar kosong di UI = gagal)', () => {
  assert.deepEqual(levels.map(l => l.rows.length), [...EXPECTED_COUNTS])
  assert.equal(name(0, '31'), 'Daerah Khusus Ibukota Jakarta')
  assert.equal(name(3, '11.01.02.2018'), "Pasi Kuala Ba'u")
  assert.equal(levels[1]!.rows.find(r => r.id === '31.71')?.type, 'kota')
  assert.equal(levels[3]!.rows.find(r => r.id === '11.01.02.2018')?.parentId, '11.01.02')
  for (let i = 0; i < 3; i++) {
    const parents = new Set(levels[i + 1]!.rows.map(r => r.parentId))
    assert.deepEqual(levels[i]!.rows.filter(r => !parents.has(r.id)).map(r => r.id), [], levels[i]!.table)
  }
  const perDistrict = new Map<string, number>()
  for (const v of levels[3]!.rows) perDistrict.set(v.parentId!, (perDistrict.get(v.parentId!) ?? 0) + 1)
  assert.ok(Math.max(...perDistrict.values()) <= 200, 'AddressPicker memuat semua desa sekaligus: di bawah batas 200 endpoint')
})

await t('berkas rusak ditolak: baris kurang, kode ganda, induk tak ada, kab/kota tanpa awalan', () => {
  assert.throws(() => parseWilayah(sql.replace(/\('94','[^']+'\),?/, '').replace("('31','Daerah Khusus Ibukota Jakarta')", '')), /induk|harap/)
  assert.throws(() => parseWilayah("('11','A'),('11','B')", [2, 0, 0, 0]), /ganda/)
  assert.throws(() => parseWilayah("('11','A'),('12.01','Kota B')", [1, 1, 0, 0]), /induk/)
  assert.throws(() => parseWilayah("('11','A'),('11.01','B')", [1, 1, 0, 0]), /awalan/)
  assert.throws(() => parseWilayah("('11','A')", [2, 0, 0, 0]), /harap 2/)
  assert.throws(() => parseWilayah("('1.1.1.1.1','A')", [0, 0, 0, 0]), /tak dikenal/)
})

await t('singkatan provinsi: kode ada di data dan mengetiknya menemukan provinsinya lebih dulu', () => {
  const opts = levels[0]!.rows.map(r => ({ id: r.id, label: r.name, keywords: PROVINCE_ALIASES[r.id] }))
  for (const [id, words] of Object.entries(PROVINCE_ALIASES)) {
    assert.ok(name(0, id), id)
    for (const w of words.split(' ')) assert.equal(matchOptions(opts, w)[0]?.id, id, w)
  }
  assert.equal(matchOptions(opts, 'dki')[0]?.id, '31')
  assert.equal(matchOptions(opts, 'jakarta')[0]?.id, '31')
})

const EMPTY = { type: 'domestic' as const, fullAddress: '', postalCode: '', provinceId: null as string | null, regencyId: null, districtId: null, villageId: null, countryCode: null as string | null, city: '', stateRegion: '' }
await t('addressForBody: kosong tak dikirim, dikosongkan = null (hapus), isian sebagian TETAP dikirim lalu ditolak server', () => {
  assert.equal(addressForBody(EMPTY, false), undefined)
  assert.equal(addressForBody(EMPTY, true), null)
  const full = { ...EMPTY, provinceId: '31', fullAddress: 'Jl. A' }
  assert.equal(addressForBody(full, false), full)
  assert.equal(addressForBody(full, true), full)
  for (const part of [{ ...EMPTY, provinceId: '31' }, { ...EMPTY, postalCode: '10210' }, { ...EMPTY, type: 'international' as const, countryCode: 'SA' }, { ...EMPTY, city: 'Jeddah' }]) {
    assert.equal(hasAddressInput(part), true)
    assert.equal(addressForBody(part, false), part)
    assert.equal(addressSchema.safeParse(part).success, false)
    assert.equal(isEmptyAddress(part), false, 'data jamaah booking: isian sebagian ditolak, bukan dibuang')
  }
  assert.equal(isEmptyAddress(EMPTY), true)
  assert.equal(hasAddressInput({ ...EMPTY, fullAddress: '   ', city: ' ' }), false)
  const r = addressSchema.safeParse({ ...EMPTY, provinceId: '31', fullAddress: '   ' })
  assert.ok(!r.success && r.error.issues.some(i => i.message === 'Alamat lengkap wajib diisi'), 'spasi saja = kosong')
})

await t('sumber: pengisian jalan di image migrate sesudah peran aplikasi; setiap formulir ber-AddressPicker memakai addressForBody', () => {
  const docker = readFileSync('Dockerfile', 'utf8')
  assert.match(docker, /CMD \["sh", "-c", "bunx prisma migrate deploy && bun prisma\/apply-app-role\.ts && bun prisma\/apply-wilayah\.ts"\]/)
  assert.match(docker, /FROM base AS migrate[\s\S]*?COPY prisma \.\/prisma/)
  assert.doesNotMatch(readFileSync('.dockerignore', 'utf8'), /^(prisma\/data|prisma\/\*|\*\.sql)/m)
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /address\/wilayah\/provinces/, 'smoke CI memeriksa data lewat image produksi')
  assert.doesNotMatch(wilayahStatements(levels[0]!).upsert, /DELETE|TRUNCATE/)
  const files: string[] = []
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = `${d}/${e}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p) } }
  walk('app'); walk('components')
  // Nilai alamat jamaah booking diperiksa server (`isEmptyAddress`); profil selalu mengirim alamat (wajib).
  const OK = new Set(['components/booking/ManifestFieldsForm.tsx', 'app/[locale]/(pilgrim)/profile/ProfileForm.tsx'])
  const BODY: Record<string, string> = { 'components/admin/vendor/VendorForm.tsx': 'components/admin/vendor/types.ts', 'components/shared/pilgrims/SavedPilgrimFields.tsx': 'components/shared/pilgrims/savedPilgrimForm.ts' }
  const users = files.filter(f => /<AddressPicker\b/.test(readFileSync(f, 'utf8')))
  assert.ok(users.length >= 7)
  for (const f of users) if (!OK.has(f)) assert.match(readFileSync(BODY[f] ?? f, 'utf8'), /addressForBody\(/, f)
})

const dbUrl = process.env.DATABASE_URL ?? ''
const db = new PrismaClient({ datasourceUrl: dbUrl })
const current = (await db.$queryRaw<{ d: string }[]>`SELECT current_database()::text AS d`)[0]!.d
if (!/test|_ci|tmp/.test(current)) throw new Error(`Menolak jalan di database ${current}`)
const apply = (url = dbUrl) => { const r = spawnSync(process.execPath, ['prisma/apply-wilayah.ts'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120_000 }); return { code: r.status, out: `${r.stdout}${r.stderr}` } }

await t('skrip image migrate: mengisi penuh, kedua kali tak menulis apa pun, nama yang berubah dibetulkan, baris hilang kembali', async () => {
  const a = apply(); assert.equal(a.code, 0, a.out)
  assert.deepEqual([await db.addressProvince.count(), await db.addressRegency.count(), await db.addressDistrict.count(), await db.addressVillage.count()], [...EXPECTED_COUNTS])
  const b = apply(); assert.equal(b.code, 0, b.out); assert.equal(b.out.match(/\(0 ditulis\)/g)?.length, 4, b.out)
  await db.addressProvince.update({ where: { id: '31' }, data: { name: 'Nama Lama' } })
  await db.addressRegency.update({ where: { id: '31.71' }, data: { type: 'kabupaten' } })
  await db.addressVillage.delete({ where: { id: levels[3]!.rows[0]!.id } })
  const c = apply(); assert.equal(c.code, 0, c.out); assert.equal(c.out.match(/\(1 ditulis\)/g)?.length, 3, c.out)
  assert.equal((await db.addressProvince.findUniqueOrThrow({ where: { id: '31' } })).name, 'Daerah Khusus Ibukota Jakarta')
  assert.equal((await db.addressRegency.findUniqueOrThrow({ where: { id: '31.71' } })).type, 'kota')
})

await t('gagal-tertutup: DATABASE_URL kosong, DB tak terjangkau, atau tulisan ditelan trigger → keluar 1 tanpa membocorkan sandi', async () => {
  assert.equal(apply('').code, 1)
  const bad = apply('postgresql://u:RAHASIA123@127.0.0.1:1/x'); assert.equal(bad.code, 1); assert.doesNotMatch(bad.out, /RAHASIA123/)
  await db.$executeRawUnsafe(`CREATE FUNCTION wilayah_uji_telan() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'`)
  await db.$executeRawUnsafe('CREATE TRIGGER wilayah_uji BEFORE INSERT ON address_villages FOR EACH ROW EXECUTE FUNCTION wilayah_uji_telan()')
  try {
    await db.addressVillage.delete({ where: { id: levels[3]!.rows[0]!.id } })
    const r = apply(); assert.equal(r.code, 1, r.out); assert.match(r.out, /address_villages: 1 baris tidak sesuai/)
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER wilayah_uji ON address_villages')
    await db.$executeRawUnsafe('DROP FUNCTION wilayah_uji_telan()')
  }
  assert.equal(apply().code, 0)
})

await db.$disconnect()
console.log(failed === 0 ? '\nSemua lulus' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
