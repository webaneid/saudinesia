// Sistem → WhatsApp (lib/whatsapp/admin.ts + route admin/system/whatsapp, docs/rencana-gowa-self-host.md §4.1) terhadap GOWA tiruan + DB sekali pakai:
// status panel (nomor beda dengan nomor bisnis = peringatan), kirim uji HANYA ke nomor terverifikasi staf sendiri, jejak tanpa nomor, dan
// penjaga sumber route (superadmin, no-store, tanpa isian nomor dari klien).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'
import { assertThrowawayDb } from './lib/testDb'
import { panelStatus, recordWhatsappAction, sendTestToStaff, TEST_MESSAGE } from '@/lib/whatsapp/admin'
import { whatsappActionSchema } from '@/lib/validators/whatsapp'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}
const env = process.env as Record<string, string | undefined>
const USER = 'saudinesia', PASS = 'sandi-uji-0123456789'
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`
const BUSINESS = '6281100000001'

let seen: FakeRequest[] = []
let state = { loggedIn: true, jid: `${BUSINESS}:7@s.whatsapp.net` }
const gowa = await startFakeServer((req) => {
  seen.push(req)
  if (req.headers.get('authorization') !== AUTH) return { status: 401, body: { code: 'UNAUTHORIZED' } }
  if (req.path === '/devices') return { status: 200, body: { code: 'SUCCESS', results: [{ id: 'saudinesia' }] } }
  if (req.path === '/app/status') return { status: 200, body: { code: 'SUCCESS', results: { is_connected: true, is_logged_in: state.loggedIn, jid: state.loggedIn ? state.jid : '' } } }
  if (req.method === 'POST' && req.path === '/send/message') return { status: 200, body: { code: 'SUCCESS' } }
  return { status: 404, body: {} }
})
function reset(over: Partial<typeof state> = {}) {
  env.WA_GATEWAY_URL = `http://127.0.0.1:${gowa.port}`; env.WA_GATEWAY_USER = USER; env.WA_GATEWAY_PASSWORD = PASS
  env.NEXT_PUBLIC_BUSINESS_WA = BUSINESS
  seen = []
  state = { loggedIn: true, jid: `${BUSINESS}:7@s.whatsapp.net`, ...over }
}

const tag = `wa-admin-${Date.now()}`
const mk = (suffix: string, data: { whatsapp?: string | null; whatsappVerifiedAt?: Date | null; verifiedWhatsapp?: string | null }) =>
  prisma.user.create({ data: { email: `${tag}-${suffix}@example.test`, fullName: 'Staf Uji', role: 'superadmin', passwordHash: 'x', ...data }, select: { id: true } })

await t('status: terhubung dengan nomor bisnis → tanpa peringatan; nomor lain → numberMismatch', async () => {
  reset()
  let s = await panelStatus()
  assert.equal(s.gateway.connected, true); assert.equal(s.gateway.phone, BUSINESS); assert.equal(s.businessNumber, BUSINESS); assert.equal(s.numberMismatch, false)
  reset({ jid: '6289999999999@s.whatsapp.net' })
  s = await panelStatus()
  assert.equal(s.numberMismatch, true)
  reset({ loggedIn: false })
  s = await panelStatus()
  assert.equal(s.gateway.connected, false); assert.equal(s.numberMismatch, false)
})

await t('status: gateway mati / kredensial salah → tidak pernah melempar', async () => {
  reset(); env.WA_GATEWAY_PASSWORD = 'salah'
  assert.equal((await panelStatus()).gateway.unauthorized, true)
  reset(); env.WA_GATEWAY_URL = 'http://127.0.0.1:1'
  assert.equal((await panelStatus()).gateway.reachable, false)
})

await t('kirim uji: hanya ke nomor TERVERIFIKASI milik staf; tak terverifikasi/berbeda → tidak ada pesan keluar', async () => {
  const none = await mk('none', {})
  const unverified = await mk('unv', { whatsapp: '6281200000002' })
  const changed = await mk('chg', { whatsapp: '6281200000003', whatsappVerifiedAt: new Date(), verifiedWhatsapp: '6281200000099' })
  const ok = await mk('ok', { whatsapp: '6281200000004', whatsappVerifiedAt: new Date(), verifiedWhatsapp: '6281200000004' })
  for (const u of [none, unverified, changed]) {
    reset()
    assert.deepEqual(await sendTestToStaff(u.id), { status: 'unverified' })
    assert.equal(seen.filter(r => r.path === '/send/message').length, 0)
  }
  reset()
  assert.deepEqual(await sendTestToStaff(ok.id), { status: 'sent' })
  const sent = seen.filter(r => r.path === '/send/message')
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0]!.body, { phone: '6281200000004', message: TEST_MESSAGE })
})

await t('jejak: settings_audit entity whatsapp, ringkasan tanpa nomor', async () => {
  const u = await mk('audit', {})
  await recordWhatsappAction(u.id, 'wa_disconnect', 'ok')
  const row = await prisma.settingsAudit.findFirst({ where: { staffId: u.id }, orderBy: { at: 'desc' } })
  assert.ok(row)
  assert.equal(row.entity, 'whatsapp'); assert.equal(row.action, 'wa_disconnect'); assert.deepEqual(row.summary, { outcome: 'ok' })
  assert.ok(!/\d{8,}/.test(JSON.stringify(row.summary)))
})

await t('masukan: hanya { action } — nomor/teks dari klien ditolak (.strict)', () => {
  assert.equal(whatsappActionSchema.safeParse({ action: 'test' }).success, true)
  assert.equal(whatsappActionSchema.safeParse({ action: 'test', phone: '6281234567890' }).success, false)
  assert.equal(whatsappActionSchema.safeParse({ action: 'pairCode', phone: '6281234567890' }).success, false)
  assert.equal(whatsappActionSchema.safeParse({ action: 'send' }).success, false)
})

await t('route: GET dan POST superadmin saja, respons no-store, QR lewat POST (bukan GET)', () => {
  const src = readFileSync('app/api/v1/admin/system/whatsapp/route.ts', 'utf8')
  const gets = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  const posts = src.slice(src.indexOf('export async function POST'))
  assert.match(gets, /requireSuperAdmin\(\)/); assert.match(posts, /requireSuperAdmin\(\)/)
  assert.match(src, /'Cache-Control': 'no-store'/)
  assert.doesNotMatch(gets, /loginQr|loginWithCode|logout|reconnect/)
  assert.doesNotMatch(src, /\bfetch\(/, 'GOWA hanya lewat lib/whatsapp/client.ts')
  const page = readFileSync('app/[locale]/admin/(protected)/system/whatsapp/page.tsx', 'utf8')
  assert.match(page, /requireAdminPage\(locale\)/); assert.match(page, /SUPERADMIN_ROLES\.includes/)
})

// settings_audit append-only (trigger) — baris jejak uji dibiarkan di DB sekali pakai; akun staf uji tetap dihapus.
await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await gowa.stop()
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
