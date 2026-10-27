// Fase 2 harga terpadu (docs/arsitektur-harga-terpadu.md §15): TIDAK ADA lagi pembaca kolom harga cache lama di luar mesin harga.
//
// Cara membuktikan (bukan pencarian teks): skema SALINAN tanpa 13 kolom harga lama (`VisaProduct.price/durationFeeRules`, `FlightSchedule/HotelRoomSchedule/
// TransportPricing/MuthowifServicePrice/HajiProduct/Package/TourPackage.price`, harga katering 3 musim, `HotelService.price`) → client Prisma di direktori sementara → `tsc` atas seluruh proyek.
// Setiap galat tipe = satu tempat yang masih membaca/menulis kolom itu. Penulis (`create`/`update` dengan `price`) dikecualikan sampai Fase 5
// (kolom dihapus); PEMBACA (select/orderBy/where/akses properti) hanya boleh ada di daftar putih admin di bawah — yang WAJIB menyusut dan kosong di Fase 3.
//
// Tak membutuhkan database (generate client tidak menyambung).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
// Di dalam node_modules/.cache (diabaikan git): `prisma generate` mencari package.json proyek dari lokasi skema — di luar proyek ia mencoba memasang Prisma via npm.
const cacheDir = join(root, 'node_modules/.cache')
mkdirSync(cacheDir, { recursive: true })
const tmp = mkdtempSync(join(cacheDir, 'price-readers-'))

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 14).join('\n     ')}`) }
}

// Pembaca yang SENGAJA masih ada: tampilan admin (halaman/route yang mengembalikan baris + price ke editor lama). Dirombak di Fase 3 (PriceCard) — daftar ini
// hanya boleh menyusut. Menambah entri di sini = menambah utang; tes juga gagal bila entri sudah tak relevan.
const ADMIN_READER_ALLOWLIST: readonly string[] = []

const COLUMNS: ReadonlyArray<[string, string]> = [
  ['VisaProduct', 'price'], ['VisaProduct', 'durationFeeRules'], ['FlightSchedule', 'price'], ['HotelRoomSchedule', 'price'], ['TransportPricing', 'price'],
  ['MuthowifServicePrice', 'price'], ['HajiProduct', 'price'], ['Package', 'price'], ['TourPackage', 'price'],
  // Fase 3: pemilik manual-only (harga diisi admin di PriceCard → titik harga; kolom lama ditulis ganda)
  ['CateringOption', 'pricePerPersonRegular'], ['CateringOption', 'pricePerPersonRamadan'], ['CateringOption', 'pricePerPersonHajj'], ['HotelService', 'price'],
]

function stripColumns(schema: string): string {
  let out = schema.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output   = "${join(tmp, 'gen')}"`)
  for (const [model, field] of COLUMNS) {
    const block = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(out)?.[0]
    assert.ok(block, `model ${model} tidak ditemukan di schema.prisma`)
    const next = block.replace(new RegExp(`^\\s*${field}\\s+.*\\n`, 'm'), '')
    assert.notEqual(next, block, `kolom ${model}.${field} tidak ditemukan — penjaga ini perlu diperbarui`)
    out = out.replace(block, next)
  }
  return out
}

const schemaPath = join(tmp, 'schema.prisma')
writeFileSync(schemaPath, stripColumns(readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')))
const gen = spawnSync(join(root, 'node_modules/.bin/prisma'), ['generate', '--schema', schemaPath], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgresql://x@localhost:5432/x' } })
assert.equal(gen.status, 0, `prisma generate gagal:\n${(gen.stdout + gen.stderr).slice(-600)}`)

writeFileSync(join(tmp, 'tsconfig.json'), JSON.stringify({
  extends: join(root, 'tsconfig.json'),
  compilerOptions: {
    incremental: false, noEmit: true,
    paths: { '@prisma/client': [join(tmp, 'gen')], '@/*': [`${root}/*`] },
  },
  include: [`${root}/**/*.ts`, `${root}/**/*.tsx`, join(root, 'next-env.d.ts')],
  exclude: [join(root, 'node_modules'), join(root, '.next'), join(root, '.next-verify')],
}))
const tsc = spawnSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(tmp, 'tsconfig.json')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const errors = `${tsc.stdout}${tsc.stderr}`.split('\n').filter(l => / error TS\d+:/.test(l))

// Galat penulis: tipe sasaran `…CreateInput`/`…UpdateInput` (termasuk Unchecked/Many). Selain itu = pembaca (select/orderBy/where/akses properti/turunannya).
const WRITER = /(Create|Update)(Many)?(Unchecked)?(Input|ManyMutationInput)|Without<\w*(Create|Update)/
const ENGINE_OR_TEST = /^(lib\/pricing\/engine\/|scripts\/|prisma\/)/
const readerFiles = new Set<string>()
const writerFiles = new Set<string>()
for (const line of errors) {
  const file = relative(root, /^(.*?)\(\d+,\d+\): error/.exec(line)?.[1] ?? line) // jalur dapat memuat "(public)" — potong pada "(baris,kolom)"
  if (ENGINE_OR_TEST.test(file)) continue
  ;(WRITER.test(line) ? writerFiles : readerFiles).add(file)
}

t('tsc dengan skema tanpa kolom cache berjalan dan menghasilkan galat (kalau 0, penjaga ini buta)', () => {
  assert.ok(errors.length > 0, `tsc tidak menghasilkan galat apa pun:\n${(tsc.stdout + tsc.stderr).slice(-400)}`)
})
t('tidak ada pembaca kolom harga cache lama di luar mesin harga, kecuali daftar putih admin', () => {
  const offenders = [...readerFiles].filter(f => !ADMIN_READER_ALLOWLIST.includes(f)).sort()
  assert.deepEqual(offenders, [], `pembaca kolom lama (pindahkan ke lib/pricing/engine/read.ts):\n${offenders.join('\n')}`)
})
t('daftar putih tidak basi: setiap entri masih membaca kolom lama (selesai dipindah → hapus dari daftar)', () => {
  const stale = ADMIN_READER_ALLOWLIST.filter(f => !readerFiles.has(f))
  assert.deepEqual(stale, [], `entri basi:\n${stale.join('\n')}`)
})
console.log(`(info) penulis kolom lama yang menunggu kontraksi Fase 5: ${writerFiles.size} berkas`)

rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
