// SEC-212 (penjaga statis): tak ada kode yang terjangkau dari callback `$transaction`/`withBookingCode` di app/ dan lib/ yang memakai klien `prisma` global. Kueri seperti itu
// berjalan di koneksi KEDUA: saat pool penuh, transaksi menunggu koneksi yang dipegang transaksi lain sampai gagal, dan bacaannya di luar snapshot transaksi Serializable.
// Fungsi yang dipakai di dalam dan di luar transaksi menerima `db = prisma` lalu dipanggil dengan `tx`; argumen yang dihilangkan terhitung pemakaian global.
// Penjaga dinamisnya: scripts/test-booking-one-connection.ts (uji booking pada connection_limit=1).
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { findGlobalPrisma, loadProgram, prismaSymbol, transactionRoots } from './lib/txReach'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 30).join('\n     ')}`) }
}

function analyze(root: string) {
  const { program, checker } = loadProgram(root)
  const target = prismaSymbol(program, checker, root)
  const roots = transactionRoots(program, root, rel => /^(app|lib)\//.test(rel))
  return { roots, hits: findGlobalPrisma(checker, target, root, roots) }
}

/** Satu proyek mini: penganalisis harus MEMERAH pada setiap bentuk pelanggaran, supaya hasil kosong pada kode asli berarti sesuatu. */
function fixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'tx-reach-'))
  const all: Record<string, string> = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2020', module: 'esnext', moduleResolution: 'bundler', baseUrl: '.', paths: { '@/*': ['./*'] }, types: [] }, include: ['**/*.ts'] }),
    'lib/db/index.ts': `export const prisma = { season: { find: async () => 1 }, $transaction: async <T>(f: (tx: typeof prisma) => Promise<T>) => f(prisma) }\n`,
    ...files,
  }
  try {
    for (const [f, src] of Object.entries(all)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), src) }
    return analyze(`${dir}/`).hits.map(h => h.at).sort()
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const HEAD = `import { prisma } from '@/lib/db'\ntype Db = Pick<typeof prisma, 'season'>\n`

await t('penganalisis memerah: kueri global langsung di callback', () => {
  assert.deepEqual(fixture({ 'lib/a.ts': `${HEAD}export const a = () => prisma.$transaction(async () => prisma.season.find())\n` }), ['lib/a.ts:3'])
})
await t('penganalisis memerah: kueri global lewat rantai fungsi lintas berkas', () => {
  assert.deepEqual(fixture({
    'lib/low.ts': `${HEAD}export const low = () => prisma.season.find()\n`,
    'lib/mid.ts': `import { low } from './low'\nexport async function mid() { return low() }\n`,
    'lib/a.ts': `import { prisma } from '@/lib/db'\nimport { mid } from './mid'\nexport const a = () => prisma.$transaction(async () => mid())\n`,
  }), ['lib/low.ts:3'])
})
await t('penganalisis memerah: `db = prisma` dipanggil TANPA tx di dalam transaksi; lolos bila tx diteruskan', () => {
  const helper = `${HEAD}export function get(id: string, db: Db = prisma) { return db.season.find() }\n`
  assert.deepEqual(fixture({ 'lib/h.ts': helper, 'lib/a.ts': `import { prisma } from '@/lib/db'\nimport { get } from './h'\nexport const a = () => prisma.$transaction(async () => get('x'))\n` }), ['lib/a.ts:3'])
  assert.deepEqual(fixture({ 'lib/h.ts': helper, 'lib/a.ts': `import { prisma } from '@/lib/db'\nimport { get } from './h'\nexport const a = () => prisma.$transaction(async tx => get('x', tx))\n` }), [])
})
await t('penganalisis memerah: lewat registry adapter tingkat modul', () => {
  assert.deepEqual(fixture({
    'lib/adapters.ts': `${HEAD}const hotel = { release: () => prisma.season.find() }\nexport const REGISTRY: Record<string, { release: () => Promise<number> }> = { hotel }\n`,
    'lib/a.ts': `import { prisma } from '@/lib/db'\nimport { REGISTRY } from './adapters'\nexport const a = (k: string) => prisma.$transaction(async () => REGISTRY[k]!.release())\n`,
  }), ['lib/adapters.ts:3'])
})
await t('penganalisis tak salah tuduh: nilai yang dihitung SEBELUM transaksi dibuka dan ditangkap callback', () => {
  assert.deepEqual(fixture({ 'lib/a.ts': `${HEAD}export async function a() { const before = await prisma.season.find(); return prisma.$transaction(async tx => before + await tx.season.find()) }\n` }), [])
})

const projectRoot = new URL('..', import.meta.url).pathname
const { roots, hits } = analyze(projectRoot)
await t(`jalur tulis booking tercakup sebagai akar (${roots.length} transaksi di app/ dan lib/)`, () => {
  const labels = roots.map(r => r.label)
  for (const f of ['lib/checkout/place.ts', 'lib/booking/simulate.ts', 'lib/booking/drafts.ts', 'lib/booking/revise.ts', 'lib/booking/adjustments.ts', 'lib/booking/expire.ts', 'lib/payments/process.ts']) {
    assert.ok(labels.some(l => l.startsWith(`${f}:`)), `akar transaksi ${f} tak ditemukan`)
  }
  assert.ok(roots.length >= 50, `hanya ${roots.length} akar: penemu akar rusak?`)
})
await t('tak ada klien `prisma` global yang terjangkau dari dalam transaksi', () => {
  assert.deepEqual(hits.map(h => `${h.at} | ${h.text} | lewat ${h.via.join(' > ')}`), [])
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
