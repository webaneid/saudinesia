// SEC-307: kurs dari API publik diperiksa kewajarannya sebelum disimpan (lib/pricing/exchangeRateSanity.ts). Murni + pindai cron.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { assessExchangeRate, MAX_JUMP, REBASE_AFTER_MS } from '@/lib/pricing/exchangeRateSanity'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`)
  }
}
const now = new Date('2026-11-20T01:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const prev = (mid: number, ms = 12 * 3_600 * 1000) => ({ mid, fetchedAt: ago(ms) })
const reason = (v: ReturnType<typeof assessExchangeRate>) => (v.ok ? 'ok' : v.reason)

t('bukan angka / NaN / ≤ 0 / tak hingga → invalid', () => {
  for (const mid of [undefined, null, '16000', Number.NaN, 0, -16000, Number.POSITIVE_INFINITY]) assert.equal(reason(assessExchangeRate({ from: 'USD', mid, previous: null, now })), 'invalid', String(mid))
})

t('di luar rentang [1, 1.000.000] → out_of_range (juga tanpa kurs sebelumnya)', () => {
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 0.5, previous: null, now })), 'out_of_range')
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 2_000_000, previous: null, now })), 'out_of_range')
  assert.deepEqual(assessExchangeRate({ from: 'USD', mid: 16_250, previous: null, now }), { ok: true, rebased: false })
})

t(`lonjakan > ${MAX_JUMP * 100}% dari kurs tersimpan (≤ 72 jam) → jump; ≤ 10% dan pergerakan wajar diterima`, () => {
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 16_000 * 1.11, previous: prev(16_000), now })), 'jump')
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 16_000 * 0.85, previous: prev(16_000), now })), 'jump')
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 16_000 * 1.099, previous: prev(16_000), now })), 'ok')
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 16_180, previous: prev(16_000), now })), 'ok')
})

t('kurs tersimpan > 72 jam → lonjakan diterima sebagai patokan baru (krisis nyata tak membekukan kurs selamanya)', () => {
  assert.deepEqual(assessExchangeRate({ from: 'USD', mid: 19_000, previous: prev(16_000, REBASE_AFTER_MS + 1), now }), { ok: true, rebased: true })
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 19_000, previous: prev(16_000, REBASE_AFTER_MS), now })), 'jump')
  // Rentang tetap berlaku walau patokan basi.
  assert.equal(reason(assessExchangeRate({ from: 'USD', mid: 2_000_000, previous: prev(16_000, REBASE_AFTER_MS * 10), now })), 'out_of_range')
})

t('SAR menyimpang > 2% dari patokan 3,75 atas USD yang diterima → peg (meski lonjakan sendiri kecil); tanpa USD tak dinilai', () => {
  assert.equal(reason(assessExchangeRate({ from: 'SAR', mid: 4_333, previous: prev(4_300), now, acceptedUsdMid: 16_250 })), 'ok')
  assert.equal(reason(assessExchangeRate({ from: 'SAR', mid: 4_000, previous: prev(4_100), now, acceptedUsdMid: 16_250 })), 'peg')
  assert.equal(reason(assessExchangeRate({ from: 'SAR', mid: 4_000, previous: prev(4_100), now })), 'ok')
})

t('cron: setiap kurs melewati assessExchangeRate sebelum exchangeRate.create; USD diambil sebelum SAR', () => {
  const src = readFileSync('lib/cron/exchangeRateJob.ts', 'utf8')
  const assess = src.indexOf('assessExchangeRate({')
  const create = src.indexOf('prisma.exchangeRate.create(')
  assert.ok(assess > 0 && create > assess, 'assess sebelum create')
  assert.match(src.slice(assess, create), /if \(!verdict\.ok\) \{[\s\S]*?continue/)
  assert.ok(src.indexOf("from: 'USD'") < src.indexOf("from: 'SAR'"))
  const writers = ['lib', 'app'].flatMap(d => (spawnSync('grep', ['-rl', 'exchangeRate.create', d]).stdout.toString().trim().split('\n').filter(Boolean)))
  assert.deepEqual(writers, ['lib/cron/exchangeRateJob.ts'])
})

console.log(failed ? `${failed} GAGAL` : 'SEMUA LULUS')
if (failed) process.exit(1)
