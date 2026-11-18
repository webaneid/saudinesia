// Fase 13e-2 bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md §5e): Pendapatan terhadap DATABASE SUNGGUHAN.
// Dibuktikan: potensi batch = potensi per booking (rencana, beku saat selesai, tanpa aturan); ringkasan bulanan memakai batas bulan ZONA APLIKASI (entri 00.30 WIB
// tanggal 1 = bulan itu walau UTC masih bulan sebelumnya), hak bertanda, pencairan batal tak dihitung, saldo kumulatif dari saldo awal; daftar per booking hanya
// booking ber-aturan beku, filter status/kode, hak ÷ potensi; penjaga (modul baca saja, peran route/halaman, CSV lewat csvResponse).
//
// PENGAMAN: menulis data sementara → hanya database sekali pakai.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { bookingSharePotential, bookingSharePotentials } from '@/lib/revenue-share/potential'
import { bookingIncome, monthBounds, monthlyIncome } from '@/lib/revenue-share/income'
import { parseCashTarget, resolveCashTarget } from '@/lib/cash/accounts'
import { revenueShareIncomeExportSchema } from '@/lib/validators/revenueShare'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const tag = `rsi${Date.now()}`
const YEAR = 2093 // tahun jauh: tak bertabrakan dengan data uji lain

// ── dunia uji ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const owner = await prisma.user.create({ data: { email: `${tag}-p@example.test`, passwordHash: 'x', fullName: 'Pemesan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const boss = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Superadmin', role: 'superadmin', isActive: true, emailVerifiedAt: new Date() } })
let n = 0
async function booking(o: { status?: 'active' | 'completed' | 'cancelled'; rule?: { percent: number; basis: 'markup' | 'margin' } | null; frozen?: number; lines?: Array<[number | null, number]>; issuedAt?: Date }) {
  const i = ++n
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${i}`, userId: owner.id, status: o.status ?? 'active', departureDate: new Date('2093-06-01'), season: 'regular', totalAmount: 1_000_000, ...(o.frozen != null ? { completedAt: new Date(), completedById: boss.id, completedPotentialIdr: o.frozen } : {}) } })
  await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-INV-${i}`, sequenceKey: `r${i}`.slice(0, 8), sequence: i, issuedAt: o.issuedAt ?? new Date(Date.UTC(2093, 0, i)), invoiceDate: new Date('2093-01-01'), dueDate: new Date('2093-01-05'), companySnapshot: {}, ...(o.rule ? { revenueSharePercent: o.rule.percent, revenueShareBasis: o.rule.basis } : {}) } })
  for (const [k, [cost, sell]] of (o.lines ?? []).entries()) {
    await prisma.priceSnapshot.create({ data: { bookingId: b.id, itemType: 'hotel', itemId: `${b.id}-${k}`, itemLabel: 'Hotel Uji', itemQty: 1, description: 'malam', qty: 1, unit: 'item', unitSellIdr: sell, totalSellIdr: sell, unitCostIdr: cost, totalCostIdr: cost, mode: 'auto' } })
  }
  return b
}
const entry = (bookingId: string, amount: number, at: Date) => prisma.revenueShareEntry.create({ data: { bookingId, source: amount > 0 ? 'payment' : 'refund', refId: `${tag}-${++n}`, amountIdr: amount, potentialIdr: 1_000_000, paidRatio: 1, entitledAfterIdr: Math.max(0, amount) , createdAt: at } })

const bMarkup = await booking({ rule: { percent: 5, basis: 'markup' }, lines: [[800_000, 1_000_000], [null, 200_000]] })
const bMargin = await booking({ rule: { percent: 10, basis: 'margin' }, lines: [[600_000, 1_000_000]] })
const bDone = await booking({ status: 'completed', rule: { percent: 10, basis: 'margin' }, frozen: 12_345, lines: [[600_000, 1_000_000]] })
const bNoRule = await booking({ rule: null, lines: [[600_000, 1_000_000]] })
const bCancelled = await booking({ status: 'cancelled', rule: { percent: 5, basis: 'markup' }, lines: [[100_000, 150_000]] })
const all = [bMarkup, bMargin, bDone, bNoRule, bCancelled]
const cash = await prisma.$transaction(tx => resolveCashTarget(tx, parseCashTarget('cash')!))
const acc = await prisma.platformProviderBankAccount.create({ data: { bankName: `${tag} Bank`, accountNumber: '4444', accountHolder: 'PT P' } })
const payout = (amount: number, paidAt: Date, voided = false) => prisma.revenueSharePayout.create({ data: { amountIdr: amount, paidAt, cashAccountId: cash!, recipientAccountId: acc.id, recipientBankName: 'B', recipientNumber: '4444', recipientHolder: 'H', createdById: boss.id, ...(voided ? { voidedAt: paidAt, voidedById: boss.id, voidReason: 'uji' } : {}) } })

async function cleanup() {
  const ids = all.map(b => b.id)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.revenueShareEntry.deleteMany({ where: { bookingId: { in: ids } } })
    await tx.revenueSharePayout.deleteMany({ where: { recipientAccountId: acc.id } })
    await tx.priceSnapshot.deleteMany({ where: { bookingId: { in: ids } } })
  })
  await prisma.platformProviderBankAccount.deleteMany({ where: { id: acc.id } })
  await prisma.invoice.deleteMany({ where: { bookingId: { in: ids } } })
  await prisma.booking.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, boss.id] } } }) // test-seed-guard butuh DB tanpa jamaah
}

try {
  await t('potensi batch = potensi per booking (markup, margin, selesai beku, tanpa aturan, batal) — rumus sama', async () => {
    const batch = await bookingSharePotentials(prisma, [...all.map(b => b.id), bMarkup.id])
    for (const b of all) assert.deepEqual(batch.get(b.id), await bookingSharePotential(prisma, b.id), b.bookingCode)
    assert.equal(batch.get(bMarkup.id)!.potentialIdr, 40_000, 'markup 5% × modal 800.000 (baris tanpa modal 0)')
    assert.equal(batch.get(bMargin.id)!.potentialIdr, 40_000, 'margin 10% × (1.000.000 − 600.000)')
    assert.equal(batch.get(bDone.id)!.potentialIdr, 12_345, 'selesai → potensi beku')
    assert.deepEqual(batch.get(bNoRule.id), { rule: null, potentialIdr: 0 })
    assert.equal((await bookingSharePotentials(prisma, [])).size, 0)
  })

  await t('batas bulan zona aplikasi: 1 Maret 00.00 WIB = 28 Feb 17.00 UTC; Desember berakhir di 1 Jan tahun berikut', () => {
    assert.equal(monthBounds(YEAR, 3, 'Asia/Jakarta').start.toISOString(), `${YEAR}-02-28T17:00:00.000Z`)
    assert.equal(monthBounds(YEAR, 12, 'Asia/Jakarta').end.toISOString(), `${YEAR}-12-31T17:00:00.000Z`)
    assert.equal(monthBounds(YEAR, 3, 'America/Los_Angeles').start.toISOString(), `${YEAR}-03-01T08:00:00.000Z`)
  })

  await t('ringkasan bulanan: hak per bulan zona aplikasi (bertanda), pencairan batal diabaikan, saldo awal + kumulatif', async () => {
    const before = await monthlyIncome(YEAR)
    await entry(bMarkup.id, 100_000, new Date(Date.UTC(YEAR - 1, 11, 31, 10)))       // tahun lalu → saldo awal
    await entry(bMarkup.id, 40_000, new Date(Date.UTC(YEAR, 1, 28, 17, 30)))         // 1 Mar 00.30 WIB → Maret
    await entry(bMargin.id, 25_000, new Date(Date.UTC(YEAR, 1, 28, 16, 30)))         // 28 Feb 23.30 WIB → Februari
    await entry(bMargin.id, -5_000, new Date(Date.UTC(YEAR, 2, 15)))                 // koreksi refund → Maret, bertanda
    await payout(30_000, new Date(Date.UTC(YEAR, 2, 31, 18)))                        // 1 Apr 01.00 WIB → April
    await payout(99_000, new Date(Date.UTC(YEAR, 2, 10)), true)                      // dibatalkan → tak dihitung
    await payout(10_000, new Date(Date.UTC(YEAR - 1, 5, 1)))                         // tahun lalu → saldo awal
    const y = await monthlyIncome(YEAR)
    assert.equal(y.months.length, 12)
    assert.equal(y.openingIdr - before.openingIdr, 90_000)
    const m = (k: number) => y.months[k - 1]!
    assert.deepEqual([m(2).entitledIdr, m(3).entitledIdr, m(4).paidOutIdr, m(3).paidOutIdr], [25_000, 35_000, 30_000, 0])
    assert.equal(y.entitledIdr - before.entitledIdr, 60_000)
    assert.equal(y.paidOutIdr - before.paidOutIdr, 30_000)
    assert.equal(y.closingIdr, y.openingIdr + y.entitledIdr - y.paidOutIdr, 'saldo akhir = awal + hak − dicairkan')
    assert.equal(m(12).balanceEndIdr, y.closingIdr)
    assert.equal(m(4).balanceEndIdr, y.openingIdr + m(1).entitledIdr + m(2).entitledIdr + m(3).entitledIdr + m(4).entitledIdr - m(1).paidOutIdr - m(2).paidOutIdr - m(3).paidOutIdr - m(4).paidOutIdr)
  })

  await t('daftar per booking: hanya ber-aturan beku, urut terbit terbaru, hak ÷ potensi, filter status dan kode', async () => {
    const { items, meta } = await bookingIncome({ q: tag }, { page: 1, limit: 50, skip: 0 })
    assert.deepEqual(items.map(r => r.bookingCode), [bCancelled, bDone, bMargin, bMarkup].map(b => b.bookingCode), 'tanpa aturan tak ikut; urut terbit desc')
    assert.equal(meta.total, 4)
    const mk = items.find(r => r.bookingId === bMarkup.id)!
    assert.deepEqual([mk.potentialIdr, mk.entitledIdr, mk.entitledPct, mk.final], [40_000, 140_000, 350, false])
    const done = items.find(r => r.bookingId === bDone.id)!
    assert.deepEqual([done.potentialIdr, done.entitledIdr, done.entitledPct, done.final], [12_345, 0, 0, true])
    assert.deepEqual((await bookingIncome({ q: tag, status: 'completed' }, { page: 1, limit: 50, skip: 0 })).items.map(r => r.bookingId), [bDone.id])
    assert.equal((await bookingIncome({ q: `${tag}-1%` }, { page: 1, limit: 50, skip: 0 })).meta.total, 0, 'wildcard LIKE di-escape')
    const p2 = await bookingIncome({ q: tag }, { page: 2, limit: 3, skip: 3 })
    assert.deepEqual([p2.meta.page, p2.items.length], [2, 1])
  })

  await t('validator ekspor: jenis dikenal, tahun wajar, status daftar putih, tanpa kolom asing', () => {
    assert.equal(revenueShareIncomeExportSchema.safeParse({ kind: 'monthly', year: '2093' }).success, true)
    for (const bad of [{ kind: 'x' }, { kind: 'monthly', year: '1999' }, { kind: 'bookings', status: 'draft' }, { kind: 'bookings', limit: '5' }]) {
      assert.equal(revenueShareIncomeExportSchema.safeParse(bad).success, false, JSON.stringify(bad))
    }
  })

  await t('PENJAGA: income.ts baca saja; route CSV superadmin + csvResponse; halaman superadmin', () => {
    const lib = read('lib/revenue-share/income.ts')
    assert.doesNotMatch(lib, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|INSERT INTO|UPDATE "|DELETE FROM/, 'modul baca saja')
    const route = read('app/api/v1/admin/system/platform-provider/income/export/route.ts')
    assert.match(route.slice(route.indexOf('export async function GET')), /^[\s\S]{0,120}requireSuperAdmin\(\)/)
    assert.match(route, /csvResponse\(/)
    const page = read('app/[locale]/admin/(protected)/system/platform-provider/income/page.tsx')
    assert.match(page, /requireAdminPage\(locale\)[\s\S]{0,80}SUPERADMIN_ROLES\.includes\(session\.role\)/)
    assert.doesNotMatch(page + route + lib, /fullName|email|phone/, 'tanpa data pribadi')
  })
} finally {
  await cleanup()
}

await prisma.$disconnect()
console.log(failed ? `${failed} GAGAL` : 'SEMUA LULUS')
process.exit(failed ? 1 : 0)
