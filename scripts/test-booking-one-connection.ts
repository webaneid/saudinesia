// SEC-212 (penjaga dinamis): uji booking dijalankan ulang dengan pool SATU koneksi. Kueri global di dalam transaksi menunggu koneksi yang dipegang transaksi itu sendiri lalu gagal P2024,
// jadi jalur yang lolos penganalisis statis (scripts/test-tx-no-global.ts) karena pola yang tak dikenalnya tetap tertangkap di sini.
// Uji yang sengaja memakai dua koneksi melewati dirinya sendiri (lihat `twoConnections` di test-booking-drafts.ts).
import { spawnSync } from 'node:child_process'

const raw = process.env.DATABASE_URL
if (!raw) { console.error('DATABASE_URL kosong'); process.exit(2) }
const url = new URL(raw)
url.searchParams.set('connection_limit', '1')
url.searchParams.set('pool_timeout', '10')

let failed = 0
for (const script of ['test-booking-engine-core', 'test-booking-snapshot', 'test-booking-drafts', 'test-booking-revisions']) {
  const started = Date.now()
  const r = spawnSync('bun', [`scripts/${script}.ts`], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname, maxBuffer: 64 * 1024 * 1024 })
  const secs = Math.round((Date.now() - started) / 1000)
  if (r.status === 0) { console.log(`PASS ${script} pada connection_limit=1 (${secs} dtk)`); continue }
  failed++
  const fails = (r.stdout ?? '').split('\n').filter(l => l.startsWith('FAIL'))
  console.log(`FAIL ${script} pada connection_limit=1 (exit ${r.status})\n     ${fails.join('\n     ') || (r.stderr ?? '').slice(-800)}`)
}
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
