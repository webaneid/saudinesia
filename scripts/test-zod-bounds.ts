// SEC-211 (GHSA-mrhx-c7xc-m3w5): Zod 3 memvalidasi SEMUA elemen array walau `.max()` terlampaui — satu body 7,8 MB
// `{"items":[{},{},…]}` menghasilkan jutaan issue dan ±2 GB RSS. Zod ≥ 4.6.6 menolak koleksi kebesaran SEBELUM elemen
// diparse — tetapi HANYA bila koleksi itu punya `.max()`. Uji ini mengunci tiga hal (docs/rencana-zod-4.md):
//   1. versi Zod terpasang ≥ 4.6.6;
//   2. setiap array (dan record yang kuncinya/isinya bisa gagal) di skema masukan berbatas — penemu sendiri, tanpa daftar hafalan:
//      penjelajah pohon skema untuk semua ekspor `lib/validators/`, dan penjaga sumber untuk skema lokal di `app/`/`lib/`;
//   3. perilaku nyata: body kebesaran ditolak dini dengan segelintir issue, bukan jutaan.
// Tanpa database (impor skema tidak membuka koneksi).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import zodPkg from 'zod/package.json'
import { z } from 'zod'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

await t('versi Zod terpasang ≥ 4.6.6 (perbaikan upstream GHSA-mrhx-c7xc-m3w5)', () => {
  const [major = 0, minor = 0, patch = 0] = zodPkg.version.split('.').map(n => Number.parseInt(n, 10))
  assert.ok(major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))), `zod ${zodPkg.version}`)
})

// ── penjelajah pohon skema ─────────────────────────────────────────────────────────────────────────────────────────────
type Def = { type: string; checks?: Array<{ _zod: { def: { check: string } } }>; [k: string]: unknown }
const defOf = (s: unknown): Def | null => ((s as { _zod?: { def?: Def } })?._zod?.def ?? null)
const hasCheck = (d: Def, check: string) => (d.checks ?? []).some(c => c._zod.def.check === check)
/** Skema yang PASTI lolos untuk nilai apa pun (tak bisa menghasilkan issue per elemen/kunci). */
const neverFails = (s: unknown): boolean => {
  const d = defOf(s)
  if (!d) return false
  if (d.type === 'unknown' || d.type === 'any') return !d.checks?.length
  if (d.type === 'string') return !d.checks?.length
  return false
}

function unbounded(schema: unknown, path: string, seen = new Set<unknown>()): string[] {
  const d = defOf(schema)
  if (!d || seen.has(schema)) return []
  seen.add(schema)
  const child = (s: unknown, p: string) => unbounded(s, p, seen)
  switch (d.type) {
    case 'array':
      return [...(hasCheck(d, 'max_length') || hasCheck(d, 'length_equals') ? [] : [`${path}: array tanpa .max()`]), ...child(d.element, `${path}[]`)]
    case 'record': {
      const own = neverFails(d.keyType) && neverFails(d.valueType) ? [] : [`${path}: record yang kunci/isinya bisa gagal (satu issue per kunci) — batasi jumlah kunci SEBELUM diparse`]
      return [...own, ...child(d.keyType, `${path}{key}`), ...child(d.valueType, `${path}{}`)]
    }
    case 'set': case 'map':
      return [`${path}: ${d.type} tidak dipakai di masukan`]
    case 'object':
      return Object.entries(d.shape as Record<string, unknown>).flatMap(([k, v]) => child(v, `${path}.${k}`)).concat(d.catchall ? child(d.catchall, `${path}.*`) : [])
    case 'union':
      return (d.options as unknown[]).flatMap((o, i) => child(o, `${path}|${i}`))
    case 'intersection':
      return [...child(d.left, path), ...child(d.right, path)]
    case 'tuple':
      return [...(d.items as unknown[]).flatMap((o, i) => child(o, `${path}[${i}]`)), ...(d.rest ? child(d.rest, `${path}[...]`) : [])]
    case 'pipe':
      // Sisi `out` hanya diparse bila `in` lolos: pembatas di `in` (mis. hitung kunci) melindungi `out`.
      return ['unknown', 'custom'].includes(defOf(d.in)?.type ?? '') && (defOf(d.in)?.checks?.length ?? 0) > 0 ? [] : [...child(d.in, path), ...child(d.out, path)]
    case 'lazy':
      return child((d.getter as () => unknown)(), path)
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'catch': case 'readonly': case 'nonoptional': case 'success':
      return child(d.innerType, path)
    default:
      return []
  }
}

await t('skema masukan lib/validators: setiap array/record berbatas (Zod hanya menolak dini koleksi yang punya .max())', async () => {
  const problems: string[] = []
  let count = 0
  const dir = join(root, 'lib/validators')
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts')).sort()) {
    const mod = await import(join(dir, f)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!(value instanceof z.ZodType)) continue
      count++
      problems.push(...unbounded(value, `${f}:${name}`))
    }
  }
  assert.ok(count > 50, `penjelajah menemukan terlalu sedikit skema (${count}) — impor rusak?`)
  assert.deepEqual(problems, [])
})

await t('penjelajah benar-benar menangkap array/record tak berbatas (kontrol negatif)', () => {
  assert.deepEqual(unbounded(z.object({ a: z.array(z.string()) }), 's'), ['s.a: array tanpa .max()'])
  assert.deepEqual(unbounded(z.object({ a: z.array(z.array(z.number()).max(3)).max(2) }), 's'), [])
  assert.equal(unbounded(z.object({ a: z.record(z.string().max(5), z.unknown()) }), 's').length, 1)
  assert.deepEqual(unbounded(z.object({ a: z.record(z.string(), z.unknown()) }), 's'), [])
  assert.equal(unbounded(z.object({ a: z.array(z.string()).max(2).optional().default([]) }).strict(), 's').length, 0)
})

// Skema lokal di route/handler tidak diekspor → penjaga sumber: setiap `z.array(` di luar lib/validators wajib `.max(` di baris yang sama
// (gaya satu-baris di berkas-berkas itu), dan `z.record(` dengan kunci/isi yang bisa gagal wajib dibatasi sebelum diparse.
await t('penjaga sumber: z.array( di app/ dan lib/ (di luar lib/validators) selalu .max( di baris yang sama', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue }
      if (!/\.(ts|tsx)$/.test(name) || p.startsWith(join(root, 'lib/validators'))) continue
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (line.trim().startsWith('//')) return
        if (/\bz\.array\(/.test(line) && !/\.max\(/.test(line)) offenders.push(`${relative(root, p)}:${i + 1}`)
        if (/\bz\.record\(/.test(line) && !/z\.record\(z\.string\(\), z\.unknown\(\)\)/.test(line) && !/boundedKeys\(/.test(line)) offenders.push(`${relative(root, p)}:${i + 1} (record)`)
      })
    }
  }
  walk(join(root, 'app')); walk(join(root, 'lib'))
  assert.deepEqual(offenders, [])
})

// ── perilaku nyata: body kebesaran ─────────────────────────────────────────────────────────────────────────────────────
await t('body JSON 7,8 MB {"items":[{},{},…]} terhadap array .max(50): ditolak dini — segelintir issue, memori tak meledak', async () => {
  const { bookingDraftSchema } = await import('@/lib/validators/booking')
  const body = `{"items":[${Array(2_600_000).fill('{}').join(',')}]}`
  assert.ok(body.length > 7_800_000, `body ${body.length} byte`)
  const parsed: unknown = JSON.parse(body)
  const rssBefore = process.memoryUsage().rss
  const started = performance.now()
  const r = bookingDraftSchema.safeParse(parsed)
  const ms = performance.now() - started
  const grownMb = (process.memoryUsage().rss - rssBefore) / 1_048_576
  assert.equal(r.success, false)
  const issues = r.success ? [] : r.error.issues
  assert.ok(issues.length < 20, `${issues.length} issue (Zod 3: jutaan)`)
  assert.ok(issues.some(i => i.code === 'too_big' && i.path.join('.') === 'items'), JSON.stringify(issues.slice(0, 3)))
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`)
  assert.ok(grownMb < 100, `RSS naik ${grownMb.toFixed(0)} MB`)
  console.log(`     ${issues.length} issue, ${ms.toFixed(1)} ms, RSS +${grownMb.toFixed(0)} MB`)
})

await t('boundedKeys: record kebesaran ditolak dengan SATU issue sebelum kunci diparse; di bawah batas tetap diperiksa per kunci', async () => {
  const { boundedKeys } = await import('@/lib/validators')
  const s = z.object({ fieldValues: boundedKeys(50, 'Terlalu banyak field', z.record(z.string().max(64), z.unknown())) }).strict()
  const huge = Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`${'k'.repeat(70)}${i}`, 0]))
  const r = s.safeParse({ fieldValues: huge })
  assert.ok(!r.success && r.error.issues.length === 1 && r.error.issues[0]?.message === 'Terlalu banyak field', JSON.stringify(r.error?.issues.slice(0, 2)))
  const small = s.safeParse({ fieldValues: { [`${'k'.repeat(70)}`]: 1 } })
  assert.ok(!small.success && small.error.issues[0]?.path.join('.').startsWith('fieldValues'), 'kunci > 64 tetap ditolak')
  assert.equal(s.safeParse({ fieldValues: { nama: 'A' } }).success, true)
  assert.equal(s.safeParse({ fieldValues: 'x' }).success, false, 'bukan objek tetap ditolak')
  assert.equal(unbounded(s, 's').length, 0)
  assert.equal(unbounded(z.object({ a: z.unknown().pipe(z.record(z.string().max(5), z.unknown())) }), 's').length, 1, 'pipe tanpa pembatas tidak diloloskan')
})

await t('array di bawah batas tetap divalidasi per elemen (perbaikan tidak melonggarkan)', async () => {
  const { bookingDraftSchema } = await import('@/lib/validators/booking')
  const r = bookingDraftSchema.safeParse({ items: [{}, {}] })
  assert.equal(r.success, false)
  assert.ok(!r.success && r.error.issues.some(i => i.path[0] === 'items' && i.path[1] === 0), 'elemen pertama diperiksa')
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua uji batas Zod lolos')
