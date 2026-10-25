// Penjaga regresi route handler (SEC-07, SEC-08; docs/lessons-learned.md). Memindai SEMUA app/api/**/route.ts — statis, tanpa
// database/Redis. Yang dikunci: route tidak boleh pura-pura sukses tanpa auth (stub), dan (fase berikutnya) error tidak boleh
// disamarkan jadi 403.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`)
  }
}

const API = 'app/api'
const routes = (readdirSync(API, { recursive: true }) as string[])
  .filter(f => f.endsWith('route.ts'))
  .map(f => join(API, f))
  .sort()
const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => relative(API, f)

await t('pemindai menemukan route (bukan lulus karena direktori kosong)', () => {
  assert.ok(routes.length > 100, `hanya ${routes.length} route ditemukan`)
})

// Pemeriksaan auth yang dikenali. Route publik sengaja tidak memakainya, tetapi route publik tidak boleh menjawab `ok(null)`.
const AUTH_CALL = /\b(require(Session|Admin|Manager|SuperAdmin)|getSession|resolveSession|clearSession)\b/
// Satu-satunya route yang sah menjawab ok(null) tanpa pemeriksaan "siapa kamu": logout (memanggil clearSession, sudah ikut AUTH_CALL).
const STUB_ALLOWLIST = new Set<string>([])

await t('SEC-07: tidak ada route stub yang menjawab ok(null) tanpa pemeriksaan auth', () => {
  const stubs = routes.filter(f => {
    const src = read(f)
    return /\bok\(null\)/.test(src) && !AUTH_CALL.test(src) && !STUB_ALLOWLIST.has(rel(f))
  })
  assert.deepEqual(stubs.map(rel), [], 'route stub tanpa auth yang membalas sukses (hapus, atau beri auth + 501):')
})

await t('SEC-07: tidak ada route yang isinya hanya handler kosong ber-sukses (tanpa prisma/lib, tanpa auth)', () => {
  const hollow = routes.filter(f => {
    const src = read(f)
    const handlers = (src.match(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
    const hasLogic = /\bprisma\b|@\/lib\/(?!validators)/.test(src)
    return handlers > 0 && !hasLogic && !AUTH_CALL.test(src)
  })
  assert.deepEqual(hollow.map(rel), [], 'route tanpa logika dan tanpa auth:')
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
