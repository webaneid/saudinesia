// Penjaga galat API berkode (docs/arsitektur-i18n-frontend.md §6.6, I6) — tanpa database. MENEMUKAN SENDIRI pelanggaran:
//  1. Route pelanggan (CODED_ROUTE_DIRS) tak memanggil `err(…)` — galat lewat `apiErrorJson`/`zodFailure`/`failureJson` (lib/errors/api.ts).
//  2. Modul yang menghasilkan galat untuk route itu (CODED_MODULES) tak menulis teks galat sendiri: `fail`/`bad` menerima KODE katalog,
//     tak ada `err(` atau `error: '<teks>'`.
//  3. Klien area pelanggan membaca galat API HANYA lewat `useApiError` (tak ada `json.error ?? …`).
//  4. Pesan statis validator jalur pelanggan ada di katalog (indeks balik `codeOfText` untuk galat Zod).
//  5. Katalog: teks `id` statis unik (indeks balik tak ambigu), `en` benar-benar diterjemahkan, setiap kode dipakai.
//  6. Perilaku: `resolveApiError` (aturan klien), `zodFailure`, `apiError`, `failureJson`.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { routing } from '@/i18n/routing'
import { apiError, apiErrorText, codeOfText, failureJson, zodFailure } from '@/lib/errors/api'
import { readErrorParams, resolveApiError } from '@/lib/errors/params'

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 16).join('\n     ')}`)
  }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`
    if (statSync(join(root, rel)).isDirectory()) { if (e !== 'node_modules' && !e.startsWith('.next')) walk(rel, out) } else if (/\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const lineOf = (src: string, i: number) => src.slice(0, i).split('\n').length

const ID = JSON.parse(read('i18n/messages/id.json')).apiErrors as Record<string, string>
const EN = JSON.parse(read('i18n/messages/en.json')).apiErrors as Record<string, string>
const KEYS = new Set(Object.keys(ID))

// Route pelanggan yang sudah berkode. I6b menambah checkout/keranjang (`bookings/route.ts`, `bookings/preview`).
const CODED_ROUTE_DIRS = ['app/api/v1/auth', 'app/api/v1/account', 'app/api/v1/address', 'app/api/v1/manifest', 'app/api/v1/bookings/[id]']
const CODED_ROUTES = CODED_ROUTE_DIRS.flatMap(d => walk(d)).filter(f => f.endsWith('/route.ts'))

// Modul penghasil galat route di atas. Galat khusus staf di modul lain (gudang identitas, katalog jenis dokumen) tetap teks (admin).
const CODED_MODULES = [
  'lib/pilgrims/http.ts', 'lib/pilgrims/service.ts', 'lib/pilgrims/bookingLink.ts', 'lib/pilgrims/review.ts', 'lib/pilgrims/extraFields.ts',
  'lib/documents/http.ts', 'lib/documents/service.ts', 'lib/documents/file.ts', 'lib/address/prepare.ts', 'lib/auth/contact.ts', 'lib/auth/rateLimit.ts',
]

// Area klien pelanggan. Checkout & keranjang menyusul di I6b (pesan mesin pesan belum berkode).
const CLIENT_DIRS = ['app/[locale]/(auth)', 'app/[locale]/(pilgrim)', 'app/[locale]/(public)', 'app/[locale]/invoice', 'components/shared', 'components/booking']
const CLIENT_PENDING_I6B = ['app/[locale]/(public)/checkout/', 'app/[locale]/(public)/keranjang/']
const CLIENT_FILES = CLIENT_DIRS.flatMap(d => walk(d)).filter(f => !CLIENT_PENDING_I6B.some(p => f.startsWith(p)))

// Pesan Zod yang bisa sampai ke pelanggan: berkas utuh, atau potongan [awal, akhir) untuk berkas campuran admin/pelanggan.
const CUSTOMER_VALIDATORS: { file: string; from?: string; to?: string }[] = [
  { file: 'lib/validators/auth.ts' },
  { file: 'lib/validators/pilgrims.ts' },
  { file: 'lib/validators/address.ts' },
  { file: 'lib/validators/documents.ts', from: 'const calendarDate', to: 'export type DocumentUploadFields' },
]

await t('route pelanggan berkode: tak ada `err(` (pakai apiErrorJson/zodFailure/failureJson)', () => {
  assert.ok(CODED_ROUTES.length >= 30, `route ditemukan terlalu sedikit (${CODED_ROUTES.length}) — pola folder berubah?`)
  const bad: string[] = []
  for (const f of CODED_ROUTES) {
    const src = code(read(f))
    for (const m of src.matchAll(/\berr\(/g)) bad.push(`${f}:${lineOf(src, m.index)}`)
  }
  assert.deepEqual(bad, [])
})

await t('modul penghasil galat: fail/bad menerima kode katalog; tak ada err( atau error: \'<teks>\'', () => {
  const bad: string[] = []
  for (const f of CODED_MODULES) {
    const src = code(read(f))
    for (const m of src.matchAll(/\berr\(/g)) bad.push(`${f}:${lineOf(src, m.index)} err(`)
    for (const m of src.matchAll(/\berror: ['`]/g)) bad.push(`${f}:${lineOf(src, m.index)} error: <teks>`)
    for (const m of src.matchAll(/\b(?:fail\(\d{3}, |bad\(|codedError\(|apiErrorJson\(|apiError\(|DocumentFileRejected\()(['`])([^'`]*)\1/g)) {
      if (!KEYS.has(m[2]!)) bad.push(`${f}:${lineOf(src, m.index)} bukan kode katalog: ${m[2]}`)
    }
    for (const m of src.matchAll(/\b(?:fail\(\d{3}, |bad\()`/g)) bad.push(`${f}:${lineOf(src, m.index)} teks templat`)
  }
  assert.deepEqual(bad, [])
})

await t('klien area pelanggan membaca galat API hanya lewat useApiError', () => {
  const bad: string[] = []
  for (const f of CLIENT_FILES) {
    if (f === 'components/shared/useApiError.ts') continue
    const src = code(read(f))
    for (const m of src.matchAll(/[\w\])]\??\.error\s*(\?\?|\|\||\)|\}|,|;)/g)) bad.push(`${f}:${lineOf(src, m.index)} ${m[0]}`)
  }
  assert.deepEqual(bad, [], 'pakai `const errorText = useApiError()` lalu `errorText(json, t(\'…Failed\'))`')
})

await t('pesan statis validator pelanggan ada di katalog (galat Zod berkode lewat codeOfText)', () => {
  const missing: string[] = []
  for (const v of CUSTOMER_VALIDATORS) {
    let src = code(read(v.file))
    if (v.from) { const a = src.indexOf(v.from), b = src.indexOf(v.to!); assert.ok(a >= 0 && b > a, `potongan ${v.file} tak ditemukan`); src = src.slice(a, b) }
    const msgs = [
      ...src.matchAll(/\.\w+\((?:[^()'`]*, )?'([^']+)'\)/g),
      ...src.matchAll(/\b(?:error|message): '([^']+)'/g),
    ].map(m => m[1]!).filter(s => /^[A-Z]/.test(s) && s.includes(' '))
    for (const s of msgs) if (!codeOfText(s)) missing.push(`${v.file}: ${s}`)
  }
  assert.deepEqual(missing, [])
})

await t('katalog: teks id statis unik, en diterjemahkan (beda dari id), kunci id↔en sama', () => {
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(ID).sort())
  const seen = new Map<string, string>(), dup: string[] = [], same: string[] = []
  for (const [k, v] of Object.entries(ID)) {
    if (!v.includes('{')) { const o = seen.get(v); if (o) dup.push(`${o} = ${k}`); else seen.set(v, k) }
    if (EN[k] === v) same.push(k)
  }
  assert.deepEqual(dup, [], 'dua kode dengan teks id sama → indeks balik ambigu')
  assert.deepEqual(same, [], 'teks en sama dengan id')
})

await t('katalog: setiap kode dipakai (literal kode di kode sumber, atau teks id = pesan validator)', () => {
  const src = ['app', 'components', 'lib'].flatMap(d => walk(d)).map(f => code(read(f))).join('\n')
  const unused = [...KEYS].filter(k => !src.includes(`'${k}'`) && !src.includes(`'${ID[k]!}'`))
  assert.deepEqual(unused, [])
})

await t('resolveApiError: /id = teks server; bahasa lain = kode → terjemahan (tanggal ikut bahasa), tanpa kode/kode asing → fallback', () => {
  const en = (k: string, p?: Record<string, string | number>) => `${EN[k]}|${JSON.stringify(p ?? {})}`
  const tr = (locale: string) => ({ locale, defaultLocale: routing.defaultLocale, has: (k: string) => k in EN, t: en })
  const body = { success: false, error: 'Teks rinci Indonesia', meta: { code: 'fieldInvalid', params: { label: 'Nomor HP Host', evil: { x: 1 } } } }
  assert.equal(resolveApiError(body, 'gagal', tr('id')), 'Teks rinci Indonesia')
  assert.equal(resolveApiError({ success: false }, 'gagal', tr('id')), 'gagal')
  assert.equal(resolveApiError(body, 'failed', tr('en')), `${EN.fieldInvalid}|${JSON.stringify({ label: 'Nomor HP Host' })}`, 'param bukan string/angka dibuang')
  assert.equal(resolveApiError({ error: 'Teks', meta: { code: 'kodeAsing' } }, 'failed', tr('en')), 'failed')
  assert.equal(resolveApiError({ error: 'Teks tanpa kode' }, 'failed', tr('en')), 'failed', 'I6-1: tanpa kode → teks Inggris bawaan, bukan Indonesia')
  assert.equal(resolveApiError(null, 'failed', tr('en')), 'failed')
  for (const code of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'fieldInvalid.x', ''])
    assert.equal(resolveApiError({ meta: { code } }, 'failed', { ...tr('en'), has: () => true }), 'failed', `kode ${JSON.stringify(code)} ditolak walau has() = true`)
  assert.deepEqual(Object.keys(readErrorParams(JSON.parse('{"__proto__":"x","label":"A"}')) ?? {}), ['label'], '__proto__ di params dibuang')
  assert.equal(resolveApiError('teks', 'failed', tr('en')), 'failed')
  const withDate = resolveApiError({ meta: { code: 'x', params: { fromDate: '2026-12-20', n: 2 } } }, 'f', { ...tr('en'), has: () => true })
  assert.match(withDate, /"fromDate":"20 Dec 2026"/)
  assert.match(withDate, /"n":2/)
})

await t('server: zodFailure berkode bila pesan dikenal, apiError/failureJson membawa meta & Retry-After', async () => {
  const known = zodFailure(z.object({ password: z.string().min(8, 'Password minimal 8 karakter') }).safeParse({ password: 'x' }).error!)
  assert.equal(known.status, 400)
  assert.deepEqual(await known.json(), { success: false, error: 'Password minimal 8 karakter', meta: { code: 'passwordMin', field: 'password' } })
  const unknown = await zodFailure(z.object({ a: z.string() }).safeParse({ a: 1 }).error!).json() as { meta?: { code?: string; field?: string } }
  assert.equal(unknown.meta?.code, undefined, 'pesan Zod bawaan tak dikenal → tanpa kode (klien en memakai fallback)')
  assert.equal(unknown.meta?.field, 'a')
  assert.deepEqual(apiError('maxDocuments', { params: { max: 20 } }), { success: false, error: apiErrorText('maxDocuments', { max: 20 }), meta: { code: 'maxDocuments', params: { max: 20 } } })
  assert.match(apiErrorText('maxDocuments', { max: 20 }), /Maksimal 20 dokumen/)
  assert.match(apiErrorText('tooManyAttempts', { minutes: 3 }), /3 menit/)
  const r = failureJson({ status: 429, error: 'x', code: 'tooManyPilgrimChanges', retryAfterSec: 30, field: 'nik' })
  assert.equal(r.status, 429); assert.equal(r.headers.get('Retry-After'), '30')
  assert.deepEqual(await r.json(), { success: false, error: 'x', meta: { code: 'tooManyPilgrimChanges', field: 'nik' } })
  assert.deepEqual(await failureJson({ status: 404, error: 'Teks staf' }).json(), { success: false, error: 'Teks staf' })
})

if (failed > 0) { console.log(`\n${failed} uji gagal`); process.exit(1) }
console.log('\nSEMUA LULUS')
