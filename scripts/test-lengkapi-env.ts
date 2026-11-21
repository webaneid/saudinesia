// scripts/lengkapi-env-production.sh (docs/rencana-gowa-self-host.md §3): melengkapi .env.production LAMA tanpa pernah menimpa nilai yang ada,
// tanpa mencetak rahasia, dan menjaga izin 600. Tanpa Docker/DB.
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}
const script = resolve('scripts/lengkapi-env-production.sh')
function box(content: string | null, mode = 0o600) {
  const dir = mkdtempSync(join(tmpdir(), 'lengkapi-'))
  if (content !== null) { writeFileSync(join(dir, '.env.production'), content); chmodSync(join(dir, '.env.production'), mode) }
  return dir
}
const run = (dir: string) => {
  const r = spawnSync('bash', [script], { env: { PATH: '/usr/bin:/bin', APP_DIR: dir } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}`, env: () => readFileSync(join(dir, '.env.production'), 'utf8') }
}
const val = (env: string, k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]

t('env lama (baris WhatsApp kosong): diisi, token kosong dibuang, nilai lain utuh, izin 600, rahasia tak tercetak', () => {
  const dir = box('A=1\nWA_GATEWAY_URL=\nWA_GATEWAY_TOKEN=\nWHATSAPP_WEBHOOK_SECRET=sudahada0123456789abcdef0123456789\nZ=akhir\n')
  const r = run(dir)
  assert.equal(r.code, 0, r.out)
  const e = r.env()
  assert.equal(val(e, 'WA_GATEWAY_URL'), 'http://gowa:3000')
  assert.equal(val(e, 'WA_GATEWAY_USER'), 'saudinesia')
  assert.match(val(e, 'WA_GATEWAY_PASSWORD') ?? '', /^[0-9a-f]{48}$/)
  assert.equal(val(e, 'WHATSAPP_WEBHOOK_SECRET'), 'sudahada0123456789abcdef0123456789')
  assert.equal(val(e, 'A'), '1'); assert.equal(val(e, 'Z'), 'akhir')
  assert.ok(!/^WA_GATEWAY_TOKEN=/m.test(e))
  assert.ok(!r.out.includes(val(e, 'WA_GATEWAY_PASSWORD')!), 'sandi tercetak')
  assert.equal(statSync(join(dir, '.env.production')).mode & 0o777, 0o600)
})
t('dijalankan dua kali = idempoten (sandi tak berganti)', () => {
  const dir = box('WA_GATEWAY_URL=\n')
  run(dir); const first = run(dir)
  assert.equal(first.code, 0); assert.match(first.out, /tidak ada yang perlu/)
  const pw = val(first.env(), 'WA_GATEWAY_PASSWORD')
  run(dir); assert.equal(val(first.env(), 'WA_GATEWAY_PASSWORD'), pw)
})
t('nilai yang sudah terisi TIDAK ditimpa (termasuk gateway lain) — diperingatkan', () => {
  const dir = box('WA_GATEWAY_URL=https://lain.example\nWA_GATEWAY_USER=u\nWA_GATEWAY_PASSWORD=p\nWHATSAPP_WEBHOOK_SECRET=s\nWA_GATEWAY_TOKEN=tok\n')
  const before = readFileSync(join(dir, '.env.production'), 'utf8')
  const r = run(dir)
  assert.equal(r.code, 0, r.out); assert.match(r.out, /PERINGATAN/)
  assert.equal(r.env(), before)
})
t('tanpa .env.production / izin longgar → gagal tanpa membuat berkas', () => {
  let r = run(box(null)); assert.equal(r.code, 1); assert.match(r.out, /buat-env-production/)
  const dir = box('X=1\n', 0o644); r = run(dir); assert.equal(r.code, 1); assert.match(r.out, /600/)
  assert.equal(readFileSync(join(dir, '.env.production'), 'utf8'), 'X=1\n')
})

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
