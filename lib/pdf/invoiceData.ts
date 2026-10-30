import type { Prisma } from '@prisma/client'
import { displayStatus, type DisplayStatus } from '@/lib/booking/lifecycle'
import { getFieldByRole, getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { DATE_SHORT_MONTH_2D, formatInstant } from '@/lib/time'

// Invoice dibangun HANYA dari `price_snapshots` (docs/arsitektur-harga-terpadu.md §17, invarian I3/I4/I5): harga yang tertera adalah harga yang DIBEKUKAN saat dipesan —
// bukan dihitung ulang dan bukan dibaca dari kolom harga item. Hanya JUAL yang masuk ke sini; modal/untung tak pernah keluar ke dokumen pilgrim.
// Nama jamaah pada baris Visa ditempel saat render dari manifest (snapshot sengaja tanpa data pribadi, UU PDP).
export const invoiceBookingInclude = {
  user: { include: { address: { include: { province: true, regency: true, district: true, village: true } } } },
  priceSnapshots: { orderBy: [{ takenAt: 'asc' }, { itemType: 'asc' }, { itemId: 'asc' }, { lineKey: 'asc' }] },
  pilgrims: { include: { visaApplication: { select: { id: true, visaProductId: true } } } },
  payments: true,
} satisfies Prisma.BookingInclude

export type InvoiceBooking = Prisma.BookingGetPayload<{ include: typeof invoiceBookingInclude }>

export type InvoiceLineItem = {
  label:       string
  description: string
  qty:         number
  unitPrice:   number
  amount:      number
}

export type InvoiceData = {
  invoiceNumber: string
  invoiceDate:   string
  dueDate:       string | null
  paidDate:      string | null
  statusLabel:   string
  bookingCode:   string
  buyer: {
    name:    string
    address: string
    phone:   string
    email:   string
  }
  lineItems:   InvoiceLineItem[]
  subtotal:    number
  totalAmount: number
  balanceDue:  number
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  draft:            'DRAF',
  awaiting_payment: 'UNPAID',
  payment_review:   'MENUNGGU KONFIRMASI',
  confirmed:        'LUNAS',
  in_progress:      'LUNAS',
  completed:        'LUNAS',
  cancelled:        'DIBATALKAN',
  expired:          'HANGUS',
}

function formatDate(d: Date): string {
  return formatInstant(d, DATE_SHORT_MONTH_2D)
}

function buildBuyerAddress(user: InvoiceBooking['user']): string {
  const addr = user.address
  if (!addr) return ''
  if (addr.type === 'domestic') {
    return [addr.fullAddress, addr.village?.name, addr.district?.name, addr.regency?.name, addr.province?.name, addr.postalCode]
      .filter(Boolean).join(', ')
  }
  return [addr.fullAddress, addr.city, addr.stateRegion, addr.countryCode].filter(Boolean).join(', ')
}

// Urutan baris di invoice: sama seperti sebelum snapshot (hotel, transport, muthowif, katering, paket ziarah, haji, visa), penyesuaian tingkat-booking paling akhir.
const ITEM_ORDER = ['hotel', 'transport', 'muthowif', 'catering', 'tourPackage', 'haji', 'visa', 'booking']

export async function buildInvoiceData(booking: InvoiceBooking): Promise<InvoiceData> {
  // Satu baris invoice per ITEM (paket berbaris-banyak — komponen, hotel, penyesuaian — tampil sebagai satu baris bagi pilgrim).
  const groups = new Map<string, { type: string; itemId: string; label: string; detail: string; qty: number; amountCents: number }>()
  for (const l of booking.priceSnapshots) {
    const key = `${l.itemType}|${l.itemId}`
    const g = groups.get(key) ?? { type: l.itemType, itemId: l.itemId, label: l.itemLabel, detail: l.itemDetail, qty: l.itemQty, amountCents: 0 }
    g.amountCents += Math.round(Number(l.totalSellIdr) * 100)
    groups.set(key, g)
  }

  const pilgrimByVisa = new Map(booking.pilgrims.flatMap(p => (p.visaApplication ? [[p.visaApplication.id, p] as const] : [])))
  const lineItems: InvoiceLineItem[] = []
  const ordered = [...groups.values()].sort((a, b) => ITEM_ORDER.indexOf(a.type) - ITEM_ORDER.indexOf(b.type))
  for (const g of ordered) {
    let label = g.label
    if (g.type === 'visa') {
      const p = pilgrimByVisa.get(g.itemId)
      const fields = p?.visaApplication?.visaProductId ? await getManifestFieldRequirements('visa', p.visaApplication.visaProductId) : []
      const rawName = p ? getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name') : null
      label = `${g.label} — ${typeof rawName === 'string' && rawName ? rawName : 'Jamaah'}`
    }
    const amount = g.amountCents / 100
    lineItems.push({ label, description: g.detail, qty: g.qty, unitPrice: amount / g.qty, amount })
  }

  const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0)
  const totalAmount = Number(booking.totalAmount)
  // Invarian I4 (total = Σ snapshot): dokumen keuangan yang tidak menjumlah tidak boleh terbit diam-diam.
  if (Math.round(subtotal * 100) !== Math.round(totalAmount * 100)) {
    throw new Error(`Invoice ${booking.bookingCode}: Σ snapshot harga (${subtotal}) ≠ total booking (${totalAmount})`)
  }
  const confirmedPayment = booking.payments.find(p => p.status === 'confirmed')
  // sisa tagihan dari jumlah pembayaran TERKONFIRMASI sebenarnya (bukan sekadar ada/tidaknya pembayaran) — jumlah kurang tak pernah tampil lunas
  const paid = booking.payments.filter(p => p.status === 'confirmed').reduce((sum, p) => sum + Number(p.amount), 0)
  const balanceDue = Math.max(0, Math.round((totalAmount - paid) * 100) / 100)

  return {
    invoiceNumber: `INV-${booking.bookingCode}`,
    invoiceDate:   formatDate(booking.createdAt),
    dueDate:       booking.paymentDeadline ? formatDate(booking.paymentDeadline) : null,
    paidDate:      confirmedPayment?.confirmedAt ? formatDate(confirmedPayment.confirmedAt) : null,
    statusLabel:   STATUS_LABEL[displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment: booking.payments.some(p => p.status === 'pending'), departureDate: booking.departureDate, returnDate: booking.returnDate })],
    bookingCode:   booking.bookingCode,
    buyer: {
      name:    booking.user.fullName,
      address: buildBuyerAddress(booking.user),
      phone:   booking.user.phone ?? '',
      email:   booking.user.email,
    },
    lineItems,
    subtotal,
    totalAmount,
    balanceDue,
  }
}
