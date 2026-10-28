// Aturan peringatan harga (docs/arsitektur-harga-terpadu.md §21; lib/pricing/warnings.ts). Fungsi murni — nilai di tabel DIHITUNG TANGAN, bukan diturunkan dari kode.
// Peringatan hanya mengingatkan: tes terakhir memastikan modul tak punya jalur yang menolak/melempar karena level.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluatePricing, type PricingInput } from '@/lib/pricing/warnings'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 10).join('\n     ')}`) }
}
const base: PricingInput = { costKnownIdr: 1_000_000, costUnknownLines: 0, recommendedIdr: 1_200_000, recommendedUnknownLines: 0, sellIdr: 1_200_000 }
const ev = (o: Partial<PricingInput>) => evaluatePricing({ ...base, ...o })

// HPP 1.000.000 · rekomendasi 1.200.000
const TABLE: Array<[string, Partial<PricingInput>, { level: string; marginIdr: number; marginPct: number | null; short: number | null; loss: number }]> = [
  ['jual = rekomendasi → ok',                         { sellIdr: 1_200_000 }, { level: 'ok', marginIdr: 200_000, marginPct: 16.7, short: 0, loss: 0 }],
  ['jual di atas rekomendasi → ok',                   { sellIdr: 1_500_000 }, { level: 'ok', marginIdr: 500_000, marginPct: 33.3, short: 0, loss: 0 }],
  ['jual 1 rupiah di bawah rekomendasi → lunak',      { sellIdr: 1_199_999 }, { level: 'below_recommended', marginIdr: 199_999, marginPct: 16.7, short: 1, loss: 0 }],
  ['jual = HPP → lunak (impas, bukan rugi)',          { sellIdr: 1_000_000 }, { level: 'below_recommended', marginIdr: 0, marginPct: 0, short: 200_000, loss: 0 }],
  ['jual 1 rupiah di bawah HPP → rugi',               { sellIdr: 999_999 },   { level: 'below_cost', marginIdr: -1, marginPct: -0, short: 200_001, loss: 1 }],
  ['jual jauh di bawah HPP → rugi',                   { sellIdr: 600_000 },   { level: 'below_cost', marginIdr: -400_000, marginPct: -66.7, short: 600_000, loss: 400_000 }],
]
for (const [name, o, x] of TABLE) {
  t(name, () => {
    const r = ev(o)
    assert.equal(r.level, x.level)
    assert.equal(r.marginIdr, x.marginIdr)
    assert.equal(Object.is(r.marginPct, -0) ? 0 : r.marginPct, Object.is(x.marginPct, -0) ? 0 : x.marginPct)
    assert.equal(r.shortfallVsRecommendedIdr, x.short)
    assert.equal(r.lossIdr, x.loss)
  })
}

t('pecahan sen tidak menimbulkan galat banding (0,1 + 0,2 vs 0,3 sen bulat)', () => {
  assert.equal(ev({ costKnownIdr: 0.1 + 0.2, recommendedIdr: 0.3, sellIdr: 0.3 }).level, 'ok')
  assert.equal(ev({ costKnownIdr: 1_000_000.1 + 0.2, sellIdr: 1_000_000.3, recommendedIdr: 1_000_000.3 }).level, 'ok')
})
t('HPP belum lengkap: rugi tetap sahih (HPP sebenarnya ≥ yang diketahui); level lunak/ok tetap dihitung; penanda `incompleteCost` menyala', () => {
  const loss = ev({ costUnknownLines: 2, sellIdr: 900_000 })
  assert.deepEqual([loss.level, loss.incompleteCost, loss.lossIdr], ['below_cost', true, 100_000])
  assert.deepEqual([ev({ costUnknownLines: 1 }).level, ev({ costUnknownLines: 1 }).incompleteCost], ['ok', true])
})
t('rekomendasi tak lengkap (baris lama manual): tak mengklaim "di bawah rekomendasi", shortfall null; rugi tetap terdeteksi', () => {
  const r = ev({ recommendedUnknownLines: 1, sellIdr: 1_100_000 })
  assert.deepEqual([r.level, r.incompleteRecommended, r.shortfallVsRecommendedIdr], ['ok', true, null])
  assert.equal(ev({ recommendedUnknownLines: 1, sellIdr: 900_000 }).level, 'below_cost')
})
t('tanpa rekomendasi (0) → tak ada peringatan lunak; HPP 0 dan jual > 0 → ok; jual 0 → marginPct null', () => {
  assert.equal(ev({ recommendedIdr: 0, sellIdr: 1_000_000 }).level, 'ok')
  assert.equal(ev({ costKnownIdr: 0, recommendedIdr: 0, sellIdr: 500_000 }).level, 'ok')
  assert.equal(ev({ sellIdr: 0 }).marginPct, null)
})
t('angka keluaran dibulatkan ke sen (tak membocorkan ekor pecahan)', () => {
  const r = ev({ costKnownIdr: 100.004, recommendedIdr: 120.004, sellIdr: 110.004 })
  assert.deepEqual([r.costIdr, r.recommendedIdr, r.sellIdr], [100, 120, 110])
})
t('PERINGATAN TAK MEMBLOKIR: modul tak melempar/menolak dan tak mengimpor apa pun (murni)', () => {
  const src = readFileSync(new URL('../lib/pricing/warnings.ts', import.meta.url), 'utf8')
  assert.ok(!/\bthrow\b|^import /m.test(src), 'warnings.ts harus murni: tanpa throw dan tanpa import')
  for (const sell of [-5, 0, 1, 999_999]) assert.doesNotThrow(() => ev({ sellIdr: sell }))
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
