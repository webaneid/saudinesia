// SEC-103: pencarian teks bebas admin harus memperlakukan "%", "_" dan "\" sebagai huruf biasa (Prisma `contains` tidak meloloskan wildcard LIKE).
// Dibuktikan: tabel nilai `escapeLike`, perilaku NYATA di database (vendor), dan penjaga sumber: tak ada `contains:` dengan masukan pengguna yang tak melewati `escapeLike`.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { prisma } from '@/lib/db'
import { escapeLike } from '@/lib/utils/search'
import { countVendors } from '@/lib/vendors/service'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

await t('escapeLike (tabel nilai): % _ \\ diberi garis miring terbalik; teks biasa utuh; urutan berlapis benar', () => {
  const table: Array<[string, string]> = [
    ['abc', 'abc'], ['', ''], ['100%', '100\\%'], ['a_b', 'a\\_b'], ['a\\b', 'a\\\\b'], ['%_\\', '\\%\\_\\\\'], ["'; drop--", "'; drop--"], ['Budi Santoso', 'Budi Santoso'],
  ]
  for (const [input, expected] of table) assert.equal(escapeLike(input), expected, input)
})

const tag = `se${Date.now().toString(36)}`
const ids: string[] = []
const mk = async (name: string) => {
  const v = await prisma.vendor.create({ data: { name, nameKey: name.toLowerCase(), countryCode: 'SA' } })
  ids.push(v.id)
}
await mk(`${tag} a%b`); await mk(`${tag} axb`); await mk(`${tag} a_b`); await mk(`${tag} a\\b`)
const count = (q: string) => countVendors({ q })

await t('database: pencarian vendor memperlakukan % _ \\ sebagai huruf biasa (dulu "%" / "_" cocok dengan semua)', async () => {
  assert.equal(await count(`${tag} a%b`), 1)
  assert.equal(await count(`${tag} a_b`), 1, '"_" tidak boleh cocok dengan "x"')
  assert.equal(await count(`${tag} a\\b`), 1)
  assert.equal(await count(`${tag} a%`), 1, '"a%" literal: hanya "a%b"')
  assert.equal(await count(`${tag} a`), 4, 'teks biasa tetap mencari sebagian kata')
  assert.equal(await count(`${tag} A`), 4, 'tak peka huruf besar/kecil')
  // "%" / "_" sendirian hanya cocok dengan nama yang MEMUAT huruf itu (fixture: tepat satu masing-masing), bukan semua baris
  assert.equal(await count('%'), 1, '"%" sendirian tak cocok dengan semua baris')
  assert.equal(await count('_'), 1)
})

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
await t('PENJAGA SUMBER: tiap `contains:` di app/ dan lib/ memakai escapeLike (satu-satunya pengecualian: ekspresi `digits` yang hanya berisi angka)', () => {
  const offenders: string[] = []
  for (const f of [...walk(join(root, 'app')), ...walk(join(root, 'lib'))]) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(?<!array_)contains:\s*([^,}\s][^,}]*)/g)) {
        const arg = m[1]!.trim()
        if (!/^escapeLike\(/.test(arg) && arg !== 'digits') offenders.push(`${relative(root, f)}:${i + 1} contains: ${arg}`)
      }
    })
  }
  assert.deepEqual(offenders, [])
  // dan `digits` memang hanya angka
  const q = readFileSync(join(root, 'lib/customers/query.ts'), 'utf8')
  assert.match(q, /const digits = q\.replace\(\/\\D\/g, ''\)/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.vendor.deleteMany({ where: { id: { in: ids } } })
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
