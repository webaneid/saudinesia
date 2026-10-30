// Penjaga zona waktu (docs/arsitektur-booking-engine-v2.md §5.7, aturan "Waktu & zona waktu" di CLAUDE.md): MENEMUKAN SENDIRI pelanggaran di app/, components/, lib/
// (bukan daftar berkas yang dihafal). Semua waktu hanya lewat `lib/time`. Pengecualian hanya lewat daftar beralasan di bawah. Tanpa database.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

let failed = 0
const pending: Promise<void>[] = []
function t(name: string, fn: () => void | Promise<void>) {
  const bad = (e: unknown) => { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 14).join('\n     ')}`) }
  try {
    const r = fn()
    if (r instanceof Promise) pending.push(r.then(() => console.log(`PASS ${name}`)).catch(bad))
    else console.log(`PASS ${name}`)
  } catch (e) { bad(e) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`
    if (statSync(join(root, rel)).isDirectory()) { if (e !== 'node_modules' && e !== '.next') walk(rel, out) } else if (/\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}
/** Sumber tanpa komentar (// dan /* *​/) supaya penjelasan yang menyebut pola terlarang tak dianggap pelanggaran. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const FILES = ['app', 'components', 'lib'].flatMap(d => walk(d)).filter(f => !f.startsWith('lib/time/'))

// Pengecualian: berkas → alasan. Kosong = tak ada yang diizinkan.
const EXCEPTIONS: Record<string, string> = {}

function violations(re: RegExp): string[] {
  const out: string[] = []
  for (const f of FILES) {
    if (EXCEPTIONS[f]) continue
    const src = code(read(f))
    src.split('\n').forEach((line, i) => { if (re.test(line)) out.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`) })
  }
  return out
}

t('tak ada toLocaleDateString/toLocaleTimeString/Intl.DateTimeFormat di luar lib/time (zona proses/peramban menggeser tanggal) — pakai formatInstant / formatCalendarDate', () => {
  assert.deepEqual(violations(/toLocaleDateString\(|toLocaleTimeString\(|Intl\.DateTimeFormat/), [])
})

t('toLocaleString(...) dengan opsi tanggal/jam (dateStyle, timeStyle, hour, minute, month, weekday) dilarang di luar lib/time; format angka `toLocaleString(\'id-ID\')` tetap boleh', () => {
  assert.deepEqual(violations(/toLocaleString\([^)]*(dateStyle|timeStyle|hour\b|minute\b|month\b|weekday\b)/), [])
})

t('tak ada offset zona yang ditanam (7 * 3_600_000, +07:00, +0700, UTC+7) — zona hanya APP_TIMEZONE', () => {
  assert.deepEqual(violations(/\b7 \* 3_?600_?000|3_?600_?000 \* 7|\b7 \* 60 \* 60 \* 1000|[T\d]\+07:?00|UTC\+7\b|\bWIB_MS\b/), [])
})

t('tak ada getter/setter tanggal lokal (getFullYear/getMonth/getDate/getDay/getHours/getMinutes/setHours/setDate/setMonth…) di luar lib/time — hasilnya mengikuti zona server/peramban', () => {
  assert.deepEqual(violations(/\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|setHours|setDate|setMonth|setFullYear|setMinutes|setSeconds)\(/), [])
})

t('tak ada aritmetika hari lewat 86_400_000 atau string "T00:00:00" di luar lib/time (addDays/daysBetween/startOfDayInApp/dbDateOf)', () => {
  assert.deepEqual(violations(/\b86_?400_?000\b|\bT00:00:00/), [])
})

t('tak ada toISOString().slice(0, 10) / .split(\'T\')[0] di luar lib/time (tanggal kalender = calendarDateOf; "hari ini" = todayInApp)', () => {
  assert.deepEqual(violations(/toISOString\(\)\.slice\(0, *10\)|toISOString\(\)\.split\('T'\)/), [])
})

t('input datetime-local HANYA di DateTimeField (zona aplikasi, label zona terlihat); tak ada `<input type="datetime-local">` lain', () => {
  const offenders = FILES.filter(f => f !== 'components/shared/DateTimeField.tsx' && /type=["']datetime-local["']/.test(code(read(f))))
  assert.deepEqual(offenders, [])
  const src = read('components/shared/DateTimeField.tsx')
  for (const needle of ['parseAppDateTime', 'toAppDateTimeInput', 'zoneLabel', 'type="datetime-local"']) assert.ok(src.includes(needle), needle)
})

t('migrasi BARU (setelah 20261103) tak memakai now()/CURRENT_TIMESTAMP mentah untuk kolom tanpa zona — pakai nilai dari aplikasi, timezone(\'UTC\', now()), atau tandai `-- tz-ok` (kolom timestamptz)', () => {
  const bad: string[] = []
  for (const dir of readdirSync(join(root, 'prisma/migrations')).filter(d => /^\d{14}_/.test(d) && d.slice(0, 14) > '20261103000000')) {
    const sql = read(`prisma/migrations/${dir}/migration.sql`)
    sql.split('\n').forEach((line, i) => {
      if (/\bnow\(\)|CURRENT_TIMESTAMP/i.test(line) && !/timezone\('UTC'|tz-ok/i.test(line) && !/^\s*--/.test(line)) bad.push(`${dir}:${i + 1}: ${line.trim().slice(0, 100)}`)
    })
  }
  assert.deepEqual(bad, [])
})

t('infra: kontainer berzona UTC (ENV TZ=UTC di Dockerfile runtime dan layanan app di compose) dan Postgres dipaksa UTC oleh migrasi; boot memperingatkan bila zona DB bukan UTC', () => {
  assert.match(read('Dockerfile'), /^ENV TZ=UTC$/m)
  assert.ok(existsSync(join(root, 'lib/time/dbZone.ts')))
  assert.match(read('lib/time/dbZone.ts'), /SHOW timezone/)
  assert.match(read('instrumentation-node.ts'), /checkDatabaseTimezone/)
  const mig = readdirSync(join(root, 'prisma/migrations')).filter(d => d.endsWith('_database_timezone_utc'))
  assert.equal(mig.length, 1, 'tepat satu migrasi zona UTC')
  assert.match(read(`prisma/migrations/${mig[0]}/migration.sql`), /ALTER DATABASE[\s\S]*SET timezone TO ''UTC''/i)
  assert.match(read('docker-compose.yml'), /^\s+TZ: UTC$/m, 'compose dev: layanan app tanpa TZ=UTC')
  assert.match(read('docker-compose.prod.yml'), /^\s+TZ: UTC$/m, 'compose prod: layanan web tanpa TZ=UTC')
})

t('DateTimeField dirender: nilai ditampilkan di zona aplikasi + label "WIB"', async () => {
  const { DateTimeField, inputToIso, isoToInput } = await import('@/components/shared/DateTimeField')
  assert.equal(inputToIso('2026-10-30T09:24'), '2026-10-30T02:24:00.000Z', 'ketikan WIB → UTC')
  assert.equal(inputToIso('2026-10-30T09:24', 'America/Los_Angeles'), '2026-10-30T16:24:00.000Z')
  assert.equal(inputToIso(''), null); assert.equal(inputToIso('2026-02-30T10:00'), null)
  assert.equal(isoToInput('2026-10-30T02:24:00.000Z'), '2026-10-30T09:24'); assert.equal(isoToInput(null), '')
  const src = read('components/shared/DateTimeField.tsx')
  assert.match(src, /onChange=\{e => onChange\(inputToIso\(e\.target\.value, tz\)\)\}/, 'handler memakai inputToIso')
  assert.match(src, /type="datetime-local" value=\{shown\}/)
  const html = renderToStaticMarkup(createElement(DateTimeField, { value: '2026-10-30T02:24:00.000Z', onChange: () => {}, label: 'Waktu transfer' }))
  assert.match(html, /type="datetime-local"/)
  assert.match(html, /value="2026-10-30T09:24"/, 'instan UTC 02:24 tampil 09:24 WIB')
  assert.match(html, />WIB</)
  assert.match(html, /Waktu transfer/)
})

await Promise.all(pending)
if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
