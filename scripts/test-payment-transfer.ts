// Fase 7a F1 (docs/arsitektur-booking-engine-v2.md §10.7): batas nominal bertahap (P1–P3) dan validator data transfer. Murni — tanpa database.
import assert from 'node:assert/strict'
import { claimRefusal, paymentLimits } from '@/lib/payments/limits'
import { paymentTransferSchema, TRANSFER_KEYS } from '@/lib/validators/paymentTransfer'
import { matchText } from '@/lib/errors/api'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

t('DP 30%: pembayaran pertama minimal DP, maksimal sisa; kursi dikonfirmasi saat terbayar ≥ DP', () => {
  const l0 = paymentLimits({ grandTotal: 6_550_000, paid: 0 }, 30)
  assert.deepEqual(l0, { balance: 6_550_000, dpAmount: 1_965_000, confirmThreshold: 1_965_000, dpMet: false, minClaim: 1_965_000 })
  const l1 = paymentLimits({ grandTotal: 6_550_000, paid: 1_000_000 }, 30) // admin mengonfirmasi kurang dari DP (P2: hanya peringatan)
  assert.deepEqual([l1.dpMet, l1.minClaim, l1.balance], [false, 965_000, 5_550_000])
  const l2 = paymentLimits({ grandTotal: 6_550_000, paid: 3_000_000 }, 30)
  assert.deepEqual([l2.dpMet, l2.minClaim, l2.balance], [true, 1, 3_550_000])
})

t('DP 0% (P3): pembayaran pertama berapa pun > 0 sudah mengonfirmasi', () => {
  const l = paymentLimits({ grandTotal: 1_000_000, paid: 0 }, 0)
  assert.deepEqual([l.dpAmount, l.minClaim, l.dpMet], [0, 1, false])
  assert.equal(paymentLimits({ grandTotal: 1_000_000, paid: 1 }, 0).dpMet, true)
})

t('DP dibulatkan ke atas ke rupiah penuh; tak melebihi tagihan; persen di luar 0..100 dijepit; lunas → sisa 0', () => {
  assert.equal(paymentLimits({ grandTotal: 1_000_001, paid: 0 }, 33.33).dpAmount, 333_301) // 333.300,33 → 333.301
  assert.equal(paymentLimits({ grandTotal: 500_000, paid: 0 }, 150).dpAmount, 500_000)
  assert.equal(paymentLimits({ grandTotal: 500_000, paid: 0 }, -5).dpAmount, 0)
  const paid = paymentLimits({ grandTotal: 500_000, paid: 500_000 }, 30)
  assert.deepEqual([paid.balance, paid.minClaim, paid.dpMet], [0, 0, true])
  assert.equal(paymentLimits({ grandTotal: 500_000, paid: 600_000 }, 30).balance, 0, 'kelebihan bayar tak membuat sisa negatif')
})

t('validator: semua isian wajib kecuali catatan; kunci liar ditolak; pesan = teks katalog (berkode untuk pelanggan)', () => {
  const ok = { amount: '3000000', transferredAt: '2026-11-15T02:30:00.000Z', destination: '0', senderBank: 'BCA', senderAccountName: 'Siti Aminah' }
  const r = paymentTransferSchema.safeParse(ok)
  assert.ok(r.success); assert.equal(r.data.amount, 3_000_000)
  const code = (v: Record<string, unknown>) => { const x = paymentTransferSchema.safeParse(v); assert.ok(!x.success); return matchText(x.error.issues[0]!.message)?.code }
  assert.equal(code({ ...ok, amount: '0' }), 'paymentAmountInvalid')
  assert.equal(code({ ...ok, amount: '1.5' }), 'paymentAmountInvalid')
  assert.equal(code({ ...ok, amount: '99999999999' }), 'paymentAmountInvalid')
  assert.equal(code({ ...ok, transferredAt: '15-11-2026 09:30' }), 'paymentTimeInvalid')
  assert.equal(code({ ...ok, destination: '' }), 'paymentDestinationRequired')
  assert.equal(code({ ...ok, senderBank: ' ' }), 'paymentSenderBankRequired')
  assert.equal(code({ ...ok, senderAccountName: 'A' }), 'paymentSenderNameRequired')
  assert.equal(code({ ...ok, note: 'x'.repeat(501) }), 'paymentNoteTooLong')
  assert.equal(paymentTransferSchema.safeParse({ ...ok, status: 'confirmed' }).success, false, 'kunci liar (mass assignment)')
  assert.equal(paymentTransferSchema.safeParse({ ...ok, note: 'transfer dari rekening istri' }).success, true)
})

t('claimRefusal (F2): di bawah minimal / di atas sisa / lunas ditolak dengan batasnya; tepat batas diterima', () => {
  const dp = paymentLimits({ grandTotal: 10_000_000, paid: 0 }, 30)
  assert.deepEqual(claimRefusal(dp, 2_999_999), { code: 'paymentAmountBelowMin', min: 3_000_000 })
  assert.equal(claimRefusal(dp, 3_000_000), null)
  assert.equal(claimRefusal(dp, 10_000_000), null)
  assert.deepEqual(claimRefusal(dp, 10_000_001), { code: 'paymentAmountAboveBalance', max: 10_000_000 })
  const after = paymentLimits({ grandTotal: 10_000_000, paid: 3_000_000 }, 30)
  assert.equal(claimRefusal(after, 1), null) // DP terpenuhi: cicilan berapa pun ≤ sisa
  assert.deepEqual(claimRefusal(paymentLimits({ grandTotal: 1_000_000, paid: 1_000_000 }, 30), 1), { code: 'paymentNothingDue' })
})
t('validator F2: waktu = instan ISO (DateTimeField), rekening = urutan, daftar kolom diturunkan dari skema', () => {
  const ok = { amount: '3000000', transferredAt: '2026-11-15T02:30:00.000Z', destination: '0', senderBank: 'BCA', senderAccountName: 'Siti Aminah' }
  const code = (v: Record<string, unknown>) => { const x = paymentTransferSchema.safeParse(v); assert.ok(!x.success); return matchText(x.error.issues[0]!.message)?.code }
  const r = paymentTransferSchema.safeParse(ok)
  assert.ok(r.success && r.data.transferredAt instanceof Date && r.data.destination.kind === 'bank' && r.data.destination.index === 0 && r.data.amount === 3_000_000)
  assert.equal(code({ ...ok, destination: 'bank-1' }), 'paymentDestinationRequired')
  // Fase 8: QRIS = `qris:<uuid>` persis; bentuk lain ditolak.
  const q = paymentTransferSchema.safeParse({ ...ok, destination: 'qris:0f8fad5b-d9cb-469f-a165-70867728950e' })
  assert.ok(q.success && q.data.destination.kind === 'qris' && q.data.destination.id === '0f8fad5b-d9cb-469f-a165-70867728950e')
  for (const bad of ['qris:', 'qris:abc', 'qris:0F8FAD5B-D9CB-469F-A165-70867728950E', 'qris:0f8fad5b-d9cb-469f-a165-70867728950e;x']) assert.equal(code({ ...ok, destination: bad }), 'paymentDestinationRequired')
  // Kolom wajib yang TIDAK dikirim (isian kosong dibuang pembaca multipart) tetap berpesan katalog, bukan teks Zod generik.
  const without = (k: string) => Object.fromEntries(Object.entries(ok).filter(([x]) => x !== k))
  assert.deepEqual(['amount', 'transferredAt', 'destination', 'senderBank', 'senderAccountName'].map(k => code(without(k))),
    ['paymentAmountInvalid', 'paymentTimeInvalid', 'paymentDestinationRequired', 'paymentSenderBankRequired', 'paymentSenderNameRequired'])
  assert.deepEqual([...TRANSFER_KEYS].sort(), ['amount', 'destination', 'note', 'senderAccountName', 'senderBank', 'transferredAt'])
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
