// Ringkasan "pakai rumus" (lib/booking/orderSummary.ts): baris identik digabung, total tak berubah, baris berbeda tetap terpisah.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collapseRows, formulaOf } from '@/lib/booking/orderSummary'

const money = (n: number) => `Rp ${n}`
const visa = (amount: number, name = 'Visa Umroh Longstay', detail = '30 hari') => ({ group: 'Visa', name, detail, unit: 'jamaah', amount })

const three = collapseRows([visa(6_250_000), visa(6_250_000), visa(6_250_000)])
assert.equal(three.length, 1)
assert.equal(three[0]!.count, 3)
assert.equal(three[0]!.amount, 18_750_000)
assert.equal(formulaOf(three[0]!, money), '3 jamaah × Rp 6250000')

// Harga satuan, produk, atau lama tinggal berbeda → baris terpisah; urutan kemunculan pertama dipertahankan.
const mixed = collapseRows([visa(6_250_000), visa(5_000_000), visa(6_250_000), visa(6_250_000, 'Visa Istidhofah'), visa(6_250_000, undefined, '15 hari')])
assert.deepEqual(mixed.map(r => [r.name, r.detail, r.count, r.amount]), [
  ['Visa Umroh Longstay', '30 hari', 2, 12_500_000],
  ['Visa Umroh Longstay', '30 hari', 1, 5_000_000],
  ['Visa Istidhofah', '30 hari', 1, 6_250_000],
  ['Visa Umroh Longstay', '15 hari', 1, 6_250_000],
])
assert.equal(formulaOf(mixed[1]!, money), null, 'satu baris tanpa rumus')

// Jumlah tetap Σ baris asli (sen, tanpa galat pecahan) — rincian harus tetap menjumlah ke tagihan.
const cents = collapseRows(Array.from({ length: 10 }, () => visa(0.1)))
assert.equal(cents[0]!.amount, 1)
const rows = [visa(1_234_567.89), visa(1_234_567.89), visa(42)]
assert.equal(Math.round(collapseRows(rows).reduce((s, r) => s + r.amount, 0) * 100), Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100))

// Kelompok beda tak pernah digabung walau nama & harga sama; `first` = baris asli pertama.
const groups = collapseRows([{ ...visa(1), group: 'A', extra: 1 }, { ...visa(1), group: 'B', extra: 2 }])
assert.equal(groups.length, 2)
assert.equal(groups[1]!.first.extra, 2)

// Ketiga tampilan memakai helper yang sama (tak ada baris visa per jamaah yang ditulis ulang tangan).
for (const f of ['app/[locale]/(pilgrim)/bookings/[id]/page.tsx', 'app/[locale]/admin/(protected)/bookings/[id]/page.tsx', 'app/[locale]/(public)/checkout/[kind]/CheckoutSummary.tsx']) {
  assert.match(readFileSync(f, 'utf8'), /collapseRows\(/, f)
}
console.log('test-order-summary: semua lolos')
