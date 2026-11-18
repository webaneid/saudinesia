// Fase 13e-1 bagi hasil Platform Provider (docs/arsitektur-bagi-hasil.md §5e): rekening Platform Provider + pencairan terhadap DATABASE SUNGGUHAN.
// Dibuktikan: pencatat = superadmin klien (bukan akun Platform Provider); jumlah ≤ saldo (Σ hak − Σ pencairan berlaku), dinilai di dalam kunci;
// QRIS/rekening nonaktif/tujuan nonaktif/waktu di luar batas ditolak tanpa menulis apa pun; pencairan memosting `out`/`bagi_hasil`, batal = pembalik
// dan saldo naik lagi; baris beku (trigger) + CHECK; rekening hapus-aman; penjaga sumber (penulis tunggal, peran route).
//
// PENGAMAN: menulis data sementara → hanya database sekali pakai.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { assertThrowawayDb } from './lib/testDb'
import { createPayout, providerBalance, voidPayout, listPayouts, getPayout } from '@/lib/revenue-share/payouts'
import { createProviderAccount, removeProviderAccount, updateProviderAccount, getProviderAccount, ProviderAccountError } from '@/lib/revenue-share/accounts'
import { canRecordPayout } from '@/lib/revenue-share/policy'
import { providerBankAccountSchema, revenueSharePayoutSchema } from '@/lib/validators/revenueShare'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
function files(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) out.push(...files(rel))
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}
const tag = `rsp${Date.now()}`

// ── dunia uji ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const owner = await prisma.user.create({ data: { email: `${tag}-p@example.test`, passwordHash: 'x', fullName: 'Pemesan', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const boss = await prisma.user.create({ data: { email: `${tag}-s@example.test`, passwordHash: 'x', fullName: 'Superadmin Klien', role: 'superadmin', isActive: true, emailVerifiedAt: new Date() } })
const prov = await prisma.user.create({ data: { email: `${tag}-v@example.test`, passwordHash: 'x', fullName: 'Penyedia', role: 'superadmin', isActive: true, emailVerifiedAt: new Date() } }) // pelaku jejak rekening (penanda provider hanya lewat skripnya)
const bank = await prisma.bankAccount.create({ data: { bankName: `${tag} BSI`, accountNumber: '8001', accountHolder: 'PT Uji', isActive: true } })
const offBank = await prisma.bankAccount.create({ data: { bankName: `${tag} BRI`, accountNumber: '8002', accountHolder: 'PT Uji', isActive: false } })
const qris = await prisma.qrisAccount.findFirst({ select: { id: true } })
const booking = await prisma.booking.create({ data: { bookingCode: `${tag}-1`, userId: owner.id, status: 'active', departureDate: new Date('2091-01-01'), season: 'regular', totalAmount: 10_000_000 } })
const base = await providerBalance()
// Hak 1.000.000 lewat baris entri langsung (penulis aslinya syncRevenueShare diuji di test-revenue-share-entitlement; di sini hanya saldo yang dipakai).
await prisma.revenueShareEntry.create({ data: { bookingId: booking.id, source: 'payment', refId: `${tag}-pay`, amountIdr: 1_000_000, potentialIdr: 1_000_000, paidRatio: 1, entitledAfterIdr: 1_000_000 } })
const recipient = await createProviderAccount({ bankName: `${tag} Mandiri`, accountNumber: '1234567890', accountHolder: 'PT Penyedia' }, prov.id)
const now = new Date()
const ok = <T,>(r: { ok: true; value: T } | { ok: false; kind: string }): T => { if (!r.ok) throw new Error(`gagal: ${r.kind}`); return r.value }
const rv = async (id: string) => new Date((await getProviderAccount(id))!.updatedAt) // versi rekening yang "dilihat" pencatat
const payoutsOf = () => prisma.revenueSharePayout.findMany({ where: { recipientAccountId: { in: [recipient.id] } }, orderBy: { createdAt: 'asc' } })

async function cleanup() {
  const accs = (await prisma.platformProviderBankAccount.findMany({ where: { bankName: { startsWith: tag } }, select: { id: true } })).map(a => a.id)
  const pays = (await prisma.revenueSharePayout.findMany({ where: { recipientAccountId: { in: accs } }, select: { id: true } })).map(p => p.id)
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica')
    await tx.cashEntry.deleteMany({ where: { reverses: { refType: 'revenue_share_payout', refId: { in: pays } } } })
    await tx.cashEntry.deleteMany({ where: { refType: 'revenue_share_payout', refId: { in: pays } } })
    await tx.revenueSharePayout.deleteMany({ where: { id: { in: pays } } })
    await tx.revenueShareEntry.deleteMany({ where: { bookingId: booking.id } })
  })
  await prisma.platformProviderBankAccount.deleteMany({ where: { id: { in: accs } } })
  await prisma.booking.deleteMany({ where: { id: booking.id } })
  await prisma.$transaction(async tx => { await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica'); await tx.settingsAudit.deleteMany({ where: { staffId: prov.id } }) })
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, boss.id, prov.id] } } }) // test-seed-guard butuh DB tanpa jamaah
}

try {
  await t('peran: pencatat = superadmin klien; akun Platform Provider dan peran lain tidak', () => {
    assert.equal(canRecordPayout({ role: 'superadmin', isPlatformProvider: false }), true)
    assert.equal(canRecordPayout({ role: 'superadmin', isPlatformProvider: true }), false, 'penerima tak mencatat pembayaran untuk dirinya sendiri')
    for (const role of ['manager', 'admin', 'pilgrim'] as const) assert.equal(canRecordPayout({ role, isPlatformProvider: false }), false, role)
  })

  await t('validator: rekening (nomor dibersihkan, angka saja, ketat); pencairan (rupiah bulat > 0, akun kas berbentuk, tanpa kolom asing)', () => {
    assert.equal(providerBankAccountSchema.parse({ bankName: 'BCA', accountNumber: '123-456 789', accountHolder: 'PT A' }).accountNumber, '123456789')
    assert.equal(providerBankAccountSchema.safeParse({ bankName: 'BCA', accountNumber: '12ab34', accountHolder: 'PT A' }).success, false)
    assert.equal(providerBankAccountSchema.safeParse({ bankName: 'BCA', accountNumber: '123456', accountHolder: 'PT A', role: 'x' }).success, false, 'strict')
    const good = { amount: 1000, paidAt: now.toISOString(), cashAccount: `bank:${bank.id}`, recipientAccountId: recipient.id, recipientVersion: recipient.updatedAt }
    assert.equal(revenueSharePayoutSchema.safeParse(good).success, true)
    for (const bad of [{ amount: 0 }, { amount: 10.5 }, { amount: -1 }, { cashAccount: 'qris' }, { cashAccount: 'bank:../x' }, { createdById: boss.id }, { recipientVersion: 'kemarin' }]) {
      assert.equal(revenueSharePayoutSchema.safeParse({ ...good, ...bad }).success, false, JSON.stringify(bad))
    }
  })

  await t('saldo: Σ hak − Σ pencairan berlaku; jumlah melebihi saldo → over_balance tanpa menulis', async () => {
    const b = await providerBalance()
    assert.equal(b.entitledIdr - base.entitledIdr, 1_000_000)
    const r = await createPayout({ amount: b.balanceIdr + 1, paidAt: now, cashAccount: `bank:${bank.id}`, recipientAccountId: recipient.id, recipientVersion: await rv(recipient.id), note: null }, boss.id, now)
    assert.deepEqual(r, { ok: false, kind: 'over_balance', balanceIdr: b.balanceIdr })
    assert.equal((await payoutsOf()).length, 0)
  })

  await t('ditolak tanpa menulis: QRIS, rekening kas nonaktif, tujuan nonaktif/tak ada, waktu masa depan/terlalu lama', async () => {
    const base0 = { amount: 1000, paidAt: now, cashAccount: `bank:${bank.id}`, recipientAccountId: recipient.id, recipientVersion: await rv(recipient.id), note: null }
    if (qris) assert.equal((await createPayout({ ...base0, cashAccount: `qris:${qris.id}` }, boss.id, now)).ok, false)
    assert.deepEqual(await createPayout({ ...base0, cashAccount: `qris:${crypto.randomUUID()}` }, boss.id, now), { ok: false, kind: 'bad_cash_account' })
    assert.deepEqual(await createPayout({ ...base0, cashAccount: `bank:${offBank.id}` }, boss.id, now), { ok: false, kind: 'bad_cash_account' })
    assert.deepEqual(await createPayout({ ...base0, recipientAccountId: crypto.randomUUID() }, boss.id, now), { ok: false, kind: 'recipient_unavailable' })
    assert.deepEqual(await createPayout({ ...base0, paidAt: new Date(now.getTime() + 3_600_000) }, boss.id, now), { ok: false, kind: 'future_date' })
    assert.deepEqual(await createPayout({ ...base0, paidAt: new Date(now.getTime() - 400 * 24 * 3_600_000) }, boss.id, now), { ok: false, kind: 'too_old' })
    const off = await createProviderAccount({ bankName: `${tag} Off`, accountNumber: '5555', accountHolder: 'PT Penyedia' }, prov.id)
    await updateProviderAccount(off.id, { isActive: false }, prov.id)
    assert.deepEqual(await createPayout({ ...base0, recipientAccountId: off.id, recipientVersion: await rv(off.id) }, boss.id, now), { ok: false, kind: 'recipient_unavailable' })
    assert.equal((await payoutsOf()).length, 0)
    assert.equal(await prisma.cashEntry.count({ where: { refType: 'revenue_share_payout', cashAccount: { bankAccountId: offBank.id } } }), 0)
  })

  let payoutId = ''
  await t('pencairan: baris + salinan rekening beku + entri out/bagi_hasil; saldo turun', async () => {
    const before = await providerBalance()
    payoutId = ok(await createPayout({ amount: 400_000, paidAt: now, cashAccount: `bank:${bank.id}`, recipientAccountId: recipient.id, recipientVersion: await rv(recipient.id), note: 'ref 123' }, boss.id, now)).id
    const row = await prisma.revenueSharePayout.findUniqueOrThrow({ where: { id: payoutId } })
    assert.deepEqual([row.recipientBankName, row.recipientNumber, row.recipientHolder, Number(row.amountIdr), row.createdById], [`${tag} Mandiri`, '1234567890', 'PT Penyedia', 400_000, boss.id])
    const ents = await prisma.cashEntry.findMany({ where: { refType: 'revenue_share_payout', refId: payoutId } })
    assert.deepEqual(ents.map(e => [e.direction, e.component, Number(e.amountIdr), e.bookingId]), [['out', 'bagi_hasil', 400_000, null]])
    assert.equal((await providerBalance()).balanceIdr, before.balanceIdr - 400_000)
    // Rekening diubah sesudahnya → riwayat pencairan tetap memakai salinan saat dibayar.
    await updateProviderAccount(recipient.id, { accountHolder: 'PT Penyedia Baru' }, prov.id)
    assert.match((await getPayout(payoutId))!.to, /a\.n\. PT Penyedia$/)
    const list = await listPayouts({ status: 'active' }, { page: 1, limit: 50, skip: 0 })
    assert.ok(list.items.some(i => i.id === payoutId))
  })

  await t('SEC-292: rekening diubah sesudah formulir dimuat → recipient_changed tanpa menulis; versi terbaru → lolos validasi rekening', async () => {
    const seen = await rv(recipient.id)
    await updateProviderAccount(recipient.id, { accountNumber: '1234567899' }, prov.id)
    const n = (await payoutsOf()).length
    assert.deepEqual(await createPayout({ amount: 1, paidAt: now, cashAccount: 'cash', recipientAccountId: recipient.id, recipientVersion: seen, note: null }, boss.id, now), { ok: false, kind: 'recipient_changed' })
    assert.equal((await payoutsOf()).length, n)
    await updateProviderAccount(recipient.id, { accountNumber: '1234567890' }, prov.id)
  })

  await t('SEC-292: setiap perubahan rekening berjejak append-only (nomor disamarkan, tanpa ubah kosong)', async () => {
    const trail = await prisma.settingsAudit.findMany({ where: { entity: 'platform_provider_account', entityId: recipient.id }, orderBy: { at: 'asc' } })
    assert.deepEqual(trail.map(a => a.action), ['create', 'update', 'update', 'update'])
    assert.ok(trail.every(a => a.staffId === prov.id))
    assert.doesNotMatch(JSON.stringify(trail.map(a => a.summary)), /1234567890|1234567899/, 'nomor utuh tak masuk jejak')
    assert.deepEqual(trail[1]!.summary, { accountHolder: ['PT Penyedia', 'PT Penyedia Baru'] })
    const before = trail.length
    await updateProviderAccount(recipient.id, { accountHolder: 'PT Penyedia Baru' }, prov.id)
    assert.equal(await prisma.settingsAudit.count({ where: { entity: 'platform_provider_account', entityId: recipient.id } }), before, 'tanpa perubahan → tanpa jejak')
  })

  await t('SEC-294: kirim ulang isi persis sama → duplicate tanpa menulis; waktu bayar berbeda → pencairan baru', async () => {
    const row = await prisma.revenueSharePayout.findUniqueOrThrow({ where: { id: payoutId } })
    const n = (await payoutsOf()).length
    const again = { amount: 400_000, paidAt: row.paidAt, cashAccount: `bank:${bank.id}`, recipientAccountId: recipient.id, recipientVersion: await rv(recipient.id), note: 'ref 123' }
    assert.deepEqual(await createPayout(again, boss.id, now), { ok: false, kind: 'duplicate' })
    assert.equal((await payoutsOf()).length, n)
    const other = ok(await createPayout({ ...again, amount: 1, paidAt: new Date(now.getTime() - 60_000) }, boss.id, now)).id
    ok(await voidPayout(other, 'uji', boss.id, now))
  })

  await t('batas saldo memperhitungkan pencairan sebelumnya', async () => {
    const b = await providerBalance()
    assert.deepEqual(await createPayout({ amount: b.balanceIdr + 1, paidAt: now, cashAccount: 'cash', recipientAccountId: recipient.id, recipientVersion: await rv(recipient.id), note: null }, boss.id, now), { ok: false, kind: 'over_balance', balanceIdr: b.balanceIdr })
  })

  await t('batal: voidedAt + pembalik, saldo naik lagi; batal dua kali → already_void; tak ada → not_found', async () => {
    const before = await providerBalance()
    ok(await voidPayout(payoutId, 'salah nominal', boss.id, now))
    const row = await prisma.revenueSharePayout.findUniqueOrThrow({ where: { id: payoutId } })
    assert.ok(row.voidedAt && row.voidedById === boss.id && row.voidReason === 'salah nominal')
    const own = await prisma.cashEntry.findMany({ where: { refType: 'revenue_share_payout', refId: payoutId }, select: { id: true } })
    const rev = await prisma.cashEntry.findMany({ where: { reversesEntryId: { in: own.map(e => e.id) } } })
    assert.deepEqual(rev.map(e => [e.direction, e.component, Number(e.amountIdr)]), [['in', 'koreksi', 400_000]])
    assert.equal((await providerBalance()).balanceIdr, before.balanceIdr + 400_000)
    assert.deepEqual(await voidPayout(payoutId, 'lagi', boss.id, now), { ok: false, kind: 'already_void' })
    assert.deepEqual(await voidPayout(crypto.randomUUID(), 'x', boss.id, now), { ok: false, kind: 'not_found' })
  })

  await t('DB: baris beku (ubah/hapus/batal-ulang/TRUNCATE ditolak) + CHECK bentuk', async () => {
    await assert.rejects(prisma.$executeRaw`DELETE FROM revenue_share_payouts WHERE id = ${payoutId}`, /frozen/)
    await assert.rejects(prisma.$executeRaw`UPDATE revenue_share_payouts SET "amountIdr" = 2 WHERE id = ${payoutId}`, /frozen/)
    await assert.rejects(prisma.$executeRaw`UPDATE revenue_share_payouts SET "voidedAt" = NULL, "voidedById" = NULL, "voidReason" = NULL WHERE id = ${payoutId}`, /frozen/)
    await assert.rejects(prisma.$executeRaw`TRUNCATE revenue_share_payouts`, /frozen/)
    const live = ok(await createPayout({ amount: 1, paidAt: now, cashAccount: 'cash', recipientAccountId: recipient.id, recipientVersion: await rv(recipient.id), note: null }, boss.id, now)).id
    await assert.rejects(prisma.$executeRaw`UPDATE revenue_share_payouts SET id = ${crypto.randomUUID()}, "voidedAt" = ${now}, "voidedById" = ${boss.id}, "voidReason" = 'x' WHERE id = ${live}`, /frozen/, 'id tak boleh diganti (entri kas merujuk lewat refId)')
    const cash = await prisma.cashEntry.findFirstOrThrow({ where: { refType: 'revenue_share_payout', refId: payoutId }, select: { cashAccountId: true } })
    const ins = (amount: number, voided: boolean) => prisma.$executeRaw`INSERT INTO revenue_share_payouts (id, "amountIdr", "paidAt", "cashAccountId", "recipientAccountId", "recipientBankName", "recipientNumber", "recipientHolder", "createdById", "voidedAt")
      VALUES (${crypto.randomUUID()}, ${amount}, ${now}, ${cash.cashAccountId}, ${recipient.id}, 'B', '1234', 'H', ${boss.id}, ${voided ? now : null})`
    await assert.rejects(ins(0, false), /revenue_share_payouts_shape/)
    await assert.rejects(ins(1, true), /revenue_share_payouts_shape/, 'voidedAt tanpa voidedById/alasan')
    await assert.rejects(prisma.$executeRaw`INSERT INTO platform_provider_bank_accounts (id, "bankName", "accountNumber", "accountHolder", "updatedAt") VALUES (${crypto.randomUUID()}, 'B', '12ab', 'H', ${now})`, /platform_provider_bank_accounts_shape/)
  })

  await t('rekening: hapus-aman (dipakai pencairan → nonaktif; tidak → hapus); duplikat → 409', async () => {
    const used = await removeProviderAccount(recipient.id, prov.id)
    assert.equal(used.deleted, false)
    assert.equal((await getProviderAccount(recipient.id))?.isActive, false)
    assert.equal((await prisma.settingsAudit.findFirst({ where: { entity: 'platform_provider_account', entityId: recipient.id }, orderBy: { at: 'desc' } }))?.action, 'toggle')
    const fresh = await createProviderAccount({ bankName: `${tag} Baru`, accountNumber: '9999', accountHolder: 'PT Penyedia' }, prov.id)
    assert.deepEqual(await removeProviderAccount(fresh.id, prov.id), { deleted: true })
    assert.equal(await getProviderAccount(fresh.id), null)
    assert.equal(await prisma.settingsAudit.count({ where: { entity: 'platform_provider_account', entityId: fresh.id, action: 'delete' } }), 1)
    await assert.rejects(createProviderAccount({ bankName: `${tag} Mandiri`, accountNumber: '1234567890', accountHolder: 'X' }, prov.id), (e: unknown) => e instanceof ProviderAccountError && e.status === 409)
    await assert.rejects(removeProviderAccount(crypto.randomUUID(), prov.id), (e: unknown) => e instanceof ProviderAccountError && e.status === 404)
  })

  await t('PENJAGA: penulis tunggal tabel pencairan/rekening; entri bagi_hasil hanya dari payouts.ts; peran route', () => {
    const src = [...files('app'), ...files('lib')]
    const writes = (model: string, table: string) => src.filter(f => new RegExp(`${model}\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\(|(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\\s+"?${table}`).test(read(f)))
    assert.deepEqual(writes('revenueSharePayout', 'revenue_share_payouts'), ['lib/revenue-share/payouts.ts'])
    assert.deepEqual(writes('platformProviderBankAccount', 'platform_provider_bank_accounts'), ['lib/revenue-share/accounts.ts'])
    assert.deepEqual(src.filter(f => /'bagi_hasil'/.test(read(f)) && !f.startsWith('lib/cash/')).sort(), ['lib/revenue-share/payouts.ts'])
    const api = 'app/api/v1/admin/system/platform-provider'
    const head = (f: string, method: string) => { const s = read(f); const i = s.indexOf(`export async function ${method}`); assert.ok(i >= 0, `${f} ${method}`); return s.slice(i, i + 400) }
    assert.match(head(`${api}/payouts/route.ts`, 'POST'), /requirePayoutRecorder\(\)/)
    assert.match(head(`${api}/payouts/route.ts`, 'GET'), /requireSuperAdmin\(\)/)
    assert.match(head(`${api}/payouts/[id]/route.ts`, 'POST'), /requirePayoutRecorder\(\)/)
    assert.match(head(`${api}/payouts/options/route.ts`, 'GET'), /requirePayoutRecorder\(\)/)
    assert.match(head(`${api}/accounts/route.ts`, 'POST'), /requirePlatformProvider\(\)/)
    assert.match(head(`${api}/accounts/route.ts`, 'GET'), /requireSuperAdmin\(\)/)
    for (const m of ['PUT', 'DELETE']) assert.match(head(`${api}/accounts/[id]/route.ts`, m), /requirePlatformProvider\(\)/)
    assert.match(read('lib/revenue-share/policy.ts'), /SUPERADMIN_ROLES\.includes\(s\.role\) && !s\.isPlatformProvider/)
  })
} finally {
  await cleanup()
}

await prisma.$disconnect()
console.log(failed ? `${failed} GAGAL` : 'SEMUA LULUS')
process.exit(failed ? 1 : 0)
