import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { claimRefusal, paymentLimits, type ClaimRefusal } from '@/lib/payments/limits'
import { feeRulesOf, gatewayFee, type FeeRule } from '@/lib/payments/fees'
import { checkTransaction, createDirect, ipaymuFromEnv, IpaymuError, listChannels, type IpaymuChannelGroup, type IpaymuConfig, type TrxStatus } from '@/lib/payments/ipaymu'
import { confirmSeats, seatInclude } from '@/lib/payments/process'
import { ensureGatewayCashAccount } from '@/lib/cash/accounts'
import { postEntries, splitPaymentCredit } from '@/lib/cash/ledger'
import { syncRevenueShare } from '@/lib/revenue-share/entitlement'
import { appUrl } from '@/lib/email/templates'
import { calendarDateOf, dateInApp, endOfDayExclusiveInApp, todayInApp } from '@/lib/time'
import { notify } from '@/lib/notifications/notify'
import { logError } from '@/lib/log'

// Pembayaran online lewat iPaymu (Fase 9, docs/arsitektur-booking-engine-v2.md §10.12) — SATU-SATUNYA penulis pembayaran gateway.
// Alur: buat (`awaiting`, nominal dinilai di dalam kunci booking) → pelanggan membayar VA/QR/… → webhook ATAU "Periksa status" → `syncGatewayPayment`
// membaca status dari iPaymu (`/transaction`, sumber kebenaran — isi callback tak pernah dipercaya) → `confirmed` otomatis + buku kas + kursi (≥ DP).
// Uang yang benar-benar masuk SELALU dicatat, walau pembayaran lokal sudah `expired` atau booking sudah batal/hangus (K9-4) — kelebihannya diurus lewat refund.
type Tx = Prisma.TransactionClient

const lockBooking = (tx: Tx, id: string) => tx.$queryRaw(Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
const cents = (n: number | Prisma.Decimal) => Math.round(Number(n) * 100)
const MAX_HOURS = 24 // K9-6

/** Konfigurasi aktif: metode iPaymu menyala DAN kunci env terpasang. `override` = uji (server tiruan). */
export async function ipaymuConfig(override?: IpaymuConfig): Promise<IpaymuConfig | null> {
  const s = await getInvoiceSettings()
  if (!s.methodIpaymu) return null
  return override ?? ipaymuFromEnv(s.gatewaySandbox)
}

export type GatewayOptions = { groups: IpaymuChannelGroup[]; fees: FeeRule[] }

/** Kanal yang bisa dipilih pelanggan + aturan biaya (dibaca server; klien hanya menampilkan). null = bayar online tak tersedia. */
export async function gatewayOptions(override?: IpaymuConfig): Promise<GatewayOptions | null> {
  const cfg = await ipaymuConfig(override)
  if (!cfg) return null
  const groups = await listChannels(cfg)
  if (groups.length === 0) return null
  return { groups, fees: await feeRulesOf('ipaymu') }
}

/**
 * Masa berlaku (jam, bulat ≥ 1): 24 jam, dipotong ke akhir hari jatuh tempo bila lebih dekat (K9-6) — VA/QR checkout berakhir tepat saat pesanan boleh
 * hangus (SEC-256). Lewat jatuh tempo hanya mungkin untuk pesanan admin (pesanan checkout yang lewat jatuh tempo ditolak `createGatewayPayment`): 24 jam.
 */
export function expiryHours(deadline: Date | null, now = new Date()): number {
  if (!deadline) return MAX_HOURS
  const end = endOfDayExclusiveInApp(dateInApp(deadline)) // jatuh tempo berlaku sampai akhir harinya
  const hours = Math.floor((end.getTime() - now.getTime()) / 3_600_000)
  return hours >= 1 ? Math.min(MAX_HOURS, hours) : MAX_HOURS
}

export type CreateFailure = { kind: 'not_found' } | { kind: 'unavailable' } | { kind: 'channel' } | { kind: 'closed' } | { kind: 'busy' } | { kind: 'refused'; refusal: ClaimRefusal } | { kind: 'gateway' }
export type CreateOk = { kind: 'done'; paymentId: string }

/**
 * Buat pembayaran online. Baris `awaiting` dibuat DULU di dalam kunci booking (nominal dinilai `paymentLimits`, satu aktif per booking — K9-3, tak boleh ada bukti
 * transfer menunggu), BARU memanggil iPaymu di luar transaksi; gagal → baris dikedaluwarsakan (tak ada transaksi gantung).
 */
export async function createGatewayPayment(input: { bookingId: string; userId: string; amount: number; channelId: string }, override?: IpaymuConfig): Promise<CreateFailure | CreateOk> {
  const cfg = await ipaymuConfig(override)
  if (!cfg) return { kind: 'unavailable' }
  const groups = await listChannels(cfg)
  const channel = groups.flatMap(g => g.channels).find(c => c.id === input.channelId)
  if (!channel) return { kind: 'channel' }
  const fees = await feeRulesOf('ipaymu')
  const fee = gatewayFee(input.amount, channel.group, fees)
  const { minimumFirstPaymentPercent, companyPhone } = await getInvoiceSettings()

  const head = await prisma.booking.findFirst({ where: { id: input.bookingId, userId: input.userId, status: { not: 'draft' } }, select: { id: true } })
  if (!head) return { kind: 'not_found' }
  const created = await prisma.$transaction(async (tx): Promise<CreateFailure | { kind: 'row'; id: string; code: string; deadline: Date | null; buyer: { fullName: string; email: string; phone: string | null; whatsapp: string | null } }> => {
    await lockBooking(tx, input.bookingId)
    const b = await tx.booking.findUniqueOrThrow({
      where: { id: input.bookingId },
      select: {
        status: true, bookingCode: true, totalAmount: true, paymentDeadline: true,
        invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true, issuedById: true, dueDate: true } },
        payments: { where: { status: { in: ['pending', 'confirmed', 'awaiting'] } }, select: { status: true, amount: true } },
        refunds: billRefunds,
        user: { select: { fullName: true, email: true, phone: true, whatsapp: true } },
      },
    })
    if (b.status !== 'active' || !b.invoice) return { kind: 'closed' }
    // Pesanan checkout yang lewat jatuh tempo menunggu hangus (SEC-221): VA/QR baru tak boleh menahannya terus-menerus (SEC-256).
    if (b.invoice.issuedById === null && b.invoice.dueDate && calendarDateOf(b.invoice.dueDate) < todayInApp()) return { kind: 'closed' }
    if (b.payments.some(p => p.status === 'pending' || p.status === 'awaiting')) return { kind: 'busy' }
    const refused = claimRefusal(paymentLimits(billOf(b), minimumFirstPaymentPercent), input.amount)
    if (refused) return { kind: 'refused', refusal: refused }
    const row = await tx.payment.create({
      data: {
        bookingId: input.bookingId, amount: 0, method: 'ipaymu', status: 'awaiting', gateway: 'ipaymu',
        claimedAmountIdr: input.amount, serviceFeeIdr: fee, channel: channel.id, channelName: `${channel.name}`.slice(0, 120),
        destinationLabel: `iPaymu · ${channel.name}`.slice(0, 200),
      },
      select: { id: true },
    })
    return { kind: 'row', id: row.id, code: b.bookingCode, deadline: b.paymentDeadline, buyer: b.user }
  })
  if (created.kind !== 'row') return created

  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
  const phone = digits(created.buyer.phone) || digits(created.buyer.whatsapp) || digits(companyPhone) || '0'
  try {
    const r = await createDirect(cfg, {
      referenceId: created.id, amount: input.amount + fee, channelId: channel.id, expiredHours: expiryHours(created.deadline),
      notifyUrl: `${appUrl()}/api/v1/webhooks/ipaymu`,
      buyer: { name: created.buyer.fullName.slice(0, 100), email: created.buyer.email, phone }, product: `Pembayaran ${created.code}`,
    })
    await prisma.payment.updateMany({
      where: { id: created.id, status: 'awaiting' }, // bisa sudah dibatalkan/kedaluwarsa sementara iPaymu dipanggil
      data: { gatewayTrxId: r.trxId, payCode: r.payCode, channelName: (r.channelName ?? channel.name).slice(0, 120), payExpiresAt: r.expiresAt ?? new Date(Date.now() + expiryHours(created.deadline) * 3_600_000) },
    })
    return { kind: 'done', paymentId: created.id }
  } catch (e) {
    logError('gateway/create', e)
    await prisma.payment.updateMany({ where: { id: created.id, status: 'awaiting' }, data: { status: 'expired', gatewayCheckedAt: new Date() } })
    return { kind: 'gateway' }
  }
}

/** Pelanggan membatalkan pembayaran online yang masih menunggu (supaya bisa membuat baru). Bila ternyata sudah dibayar, sinkronisasi berikutnya tetap mencatatnya. */
export async function cancelGatewayPayment(paymentId: string, userId: string): Promise<'done' | 'not_found' | 'conflict'> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id: paymentId, gateway: { not: null }, booking: { userId } }, select: { bookingId: true } })
    if (!p) return 'not_found'
    await lockBooking(tx, p.bookingId)
    const n = await tx.payment.updateMany({ where: { id: paymentId, status: 'awaiting' }, data: { status: 'expired' } })
    return n.count === 1 ? 'done' : 'conflict'
  })
}

export type SyncResult =
  | { kind: 'not_found' }
  | { kind: 'unavailable' }
  | { kind: 'pending' }
  | { kind: 'expired' }
  | { kind: 'mismatch' }
  | { kind: 'already' }
  | { kind: 'confirmed'; userId: string; bookingId: string; code: string; balance: number; seatConfirmed: boolean }
  | { kind: 'late'; bookingId: string } // lunas sesudah booking batal/hangus: seluruhnya kelebihan, staf mengembalikan (tanpa notifikasi "dikonfirmasi")

/**
 * Sinkronkan satu pembayaran gateway dengan iPaymu. `trxIdHint` (dari callback) hanya dipakai bila id transaksi belum tersimpan, dan baru dipercaya bila
 * `/transaction` menyatakan ReferenceId = id pembayaran ini. Status `paid` dengan nominal ≠ yang kita minta → `mismatch` (dicatat log, tak dikonfirmasi otomatis).
 */
export async function syncGatewayPayment(paymentId: string, opts: { trxIdHint?: string | null; override?: IpaymuConfig } = {}): Promise<SyncResult> {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, gateway: true, status: true, gatewayTrxId: true, claimedAmountIdr: true, serviceFeeIdr: true, payExpiresAt: true } })
  if (!p || p.gateway !== 'ipaymu') return { kind: 'not_found' }
  if (p.status === 'confirmed') return { kind: 'already' }
  const s = await getInvoiceSettings()
  const cfg = opts.override ?? ipaymuFromEnv(s.gatewaySandbox) // sinkronisasi tetap berjalan walau metode dimatikan sesudah pelanggan membayar
  if (!cfg) return { kind: 'unavailable' }
  const trxId = p.gatewayTrxId ?? (opts.trxIdHint && /^[0-9A-Za-z_-]{1,80}$/.test(opts.trxIdHint) ? opts.trxIdHint : null)
  if (!trxId) return { kind: 'pending' }

  let st: TrxStatus
  try { st = await checkTransaction(cfg, trxId) } catch (e) {
    logError('gateway/sync', e)
    return { kind: 'pending' }
  }
  if (st.referenceId !== p.id) { logError('gateway/sync ReferenceId tak cocok', p.id); return { kind: 'mismatch' } }
  const now = new Date()
  if (st.state !== 'paid') {
    const done = st.state === 'expired' || st.state === 'failed' || (p.payExpiresAt !== null && p.payExpiresAt.getTime() < now.getTime() - 3_600_000)
    await prisma.payment.updateMany({ where: { id: p.id, status: { in: ['awaiting', 'expired'] } }, data: { ...(done ? { status: 'expired' } : {}), gatewayCheckedAt: now, gatewayTrxId: p.gatewayTrxId ?? trxId } })
    return { kind: done ? 'expired' : 'pending' }
  }
  const expected = cents(p.claimedAmountIdr ?? 0) + cents(p.serviceFeeIdr)
  if (cents(st.amount) !== expected) {
    logError('gateway/sync nominal tak cocok', p.id) // diselesaikan manual oleh staf (SEC-258)
    const stale = p.payExpiresAt !== null && p.payExpiresAt.getTime() < now.getTime()
    await prisma.payment.updateMany({ where: { id: p.id, status: { in: ['awaiting', 'expired'] } }, data: { ...(stale ? { status: 'expired' } : {}), gatewayCheckedAt: now } })
    return { kind: 'mismatch' }
  }
  return confirmGatewayPayment(p.id, st, s.minimumFirstPaymentPercent)
}

/** Konfirmasi otomatis (oleh sistem — `confirmedById` null) di dalam kunci booking; idempoten. */
async function confirmGatewayPayment(paymentId: string, st: TrxStatus, minimumFirstPaymentPercent: number): Promise<SyncResult> {
  return prisma.$transaction(async (tx): Promise<SyncResult> => {
    const head = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { bookingId: true } })
    await lockBooking(tx, head.bookingId)
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
    if (p.status === 'confirmed') return { kind: 'already' }
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: head.bookingId },
      include: { ...seatInclude, invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } }, payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } }, refunds: billRefunds },
    })
    const credit = Number(p.claimedAmountIdr)
    const serviceFee = Number(p.serviceFeeIdr)
    const before = billOf(booking)
    const live = booking.status === 'active'
    const cashAccountId = await ensureGatewayCashAccount(tx, 'ipaymu')
    const paidAt = st.paidAt && st.paidAt.getTime() <= Date.now() + 5 * 60_000 ? st.paidAt : new Date()
    await tx.payment.update({
      where: { id: p.id },
      data: { status: 'confirmed', amount: credit, gatewayTrxId: st.trxId, gatewayFeeIdr: st.fee, transferredAt: paidAt, confirmedAt: new Date(), confirmedById: null, destinationCashAccountId: cashAccountId, gatewayCheckedAt: new Date() },
    })
    const src = { refType: 'payment' as const, refId: p.id, cashAccountId, entryDate: paidAt, bookingId: booking.id, createdById: null }
    // Kredit dipecah seperti verifikasi manual (pokok/ppn/kelebihan); biaya layanan = pemasukan terpisah (D15); MDR yang dipotong iPaymu = uang keluar.
    await postEntries(tx, { ...src, direction: 'in' }, [...splitPaymentCredit({ amount: credit, balanceBefore: live ? before.balance : 0, grandTotal: before.grandTotal, taxAdded: before.taxAdded }), { component: 'biaya_layanan', amountIdr: serviceFee }])
    await postEntries(tx, { ...src, direction: 'out' }, [{ component: 'mdr', amountIdr: st.fee }])
    await syncRevenueShare(tx, booking.id, { source: 'payment', refId: p.id }) // hak bagi hasil (P5) — juga uang yang masuk sesudah batal (turun lagi saat direfund)
    const after = paymentLimits({ grandTotal: before.grandTotal, paid: before.paid + credit }, minimumFirstPaymentPercent)
    let seatConfirmed = false
    // Kursi hanya untuk booking yang masih hidup; uang yang masuk ke booking batal/hangus tetap tercatat (K9-4) dan dikembalikan lewat refund.
    if (!live) return { kind: 'late', bookingId: booking.id }
    if (booking.confirmedAt === null && after.dpMet) {
      seatConfirmed = true
      await confirmSeats(tx, booking, null)
    }
    return { kind: 'confirmed', userId: booking.userId, bookingId: booking.id, code: booking.bookingCode, balance: after.balance, seatConfirmed }
  })
}

/** Sinkronkan lalu kirim notifikasi "pembayaran dikonfirmasi" bila baru saja terkonfirmasi (sesudah commit; `notify` tak pernah melempar). */
export async function syncAndNotify(paymentId: string, opts: { trxIdHint?: string | null; override?: IpaymuConfig } = {}): Promise<SyncResult> {
  const r = await syncGatewayPayment(paymentId, opts)
  if (r.kind === 'confirmed') void notify({ userId: r.userId, bookingId: r.bookingId, event: { type: 'payment_confirmed', code: r.code, balance: r.balance } })
  return r
}

/** Cron: pembayaran online yang masih menunggu (atau baru kedaluwarsa ≤ 48 jam — pelanggan bisa saja tetap membayar) diperiksa ke iPaymu. */
export async function reconcileGatewayPayments(opts: { override?: IpaymuConfig; limit?: number } = {}): Promise<SyncResult[]> {
  const since = new Date(Date.now() - 48 * 3_600_000)
  // Tanpa id transaksi (iPaymu tak mengembalikannya dan callback tak pernah datang) status tak bisa ditanyakan: lewat batas waktu + 1 jam → kedaluwarsa,
  // supaya tak menahan hangus selamanya (callback yang datang belakangan tetap dicatat lewat `trxIdHint`).
  await prisma.payment.updateMany({
    where: { gateway: 'ipaymu', status: 'awaiting', gatewayTrxId: null, OR: [{ payExpiresAt: { lt: new Date(Date.now() - 3_600_000) } }, { payExpiresAt: null, createdAt: { lt: new Date(Date.now() - 25 * 3_600_000) } }] },
    data: { status: 'expired' },
  })
  // Yang menunggu lebih dulu, lalu yang paling lama tak diperiksa — baris lama yang tak pernah berubah tak menutup antrean 50 baris.
  const rows = await prisma.payment.findMany({
    where: { gateway: 'ipaymu', gatewayTrxId: { not: null }, OR: [{ status: 'awaiting' }, { status: 'expired', payExpiresAt: { gte: since } }] },
    orderBy: [{ status: 'asc' }, { gatewayCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }], take: opts.limit ?? 50, select: { id: true },
  })
  const out: SyncResult[] = []
  for (const r of rows) out.push(await syncAndNotify(r.id, { override: opts.override }))
  return out
}
