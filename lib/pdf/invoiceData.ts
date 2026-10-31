import type { Prisma } from '@prisma/client'
import { displayStatus, type DisplayStatus } from '@/lib/booking/lifecycle'
import { getFieldByRole, getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { DATE_SHORT_MONTH_2D, formatCalendarDate, formatInstant } from '@/lib/time'
import { formatAddressLine } from '@/lib/address/format'
import { billOf } from '@/lib/invoice/bill'
import { frozenTaxRules, type BankSnapshot, type CompanySnapshot } from '@/lib/invoice/issue'
import { computeTax } from '@/lib/invoice/tax'
import type { TaxLine } from '@/lib/invoice/tax'
import { plainText } from '@/lib/rich-text/doc'
import { getPaymentConfig } from '@/lib/constants/payment'

// Invoice dibangun HANYA dari `price_snapshots` (docs/arsitektur-harga-terpadu.md §17, invarian I3/I4/I5): harga yang tertera adalah harga yang DIBEKUKAN saat dipesan —
// bukan dihitung ulang dan bukan dibaca dari kolom harga item. Hanya JUAL yang masuk ke sini; modal/untung tak pernah keluar ke dokumen pilgrim.
// Nama jamaah pada baris Visa ditempel saat render dari manifest (snapshot sengaja tanpa data pribadi, UU PDP).
export const invoiceBookingInclude = {
  user: { include: { address: { include: { province: true, regency: true, district: true, village: true } } } },
  priceSnapshots: { orderBy: [{ takenAt: 'asc' }, { itemType: 'asc' }, { itemId: 'asc' }, { lineKey: 'asc' }] },
  pilgrims: { include: { visaApplication: { select: { id: true, visaProductId: true } } } },
  payments: true,
  invoice: true,
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
  /** > 1 = invoice pernah direvisi (Fase 6b). */
  revision:      number
  /** Kop beku saat terbit (atau setelan terkini untuk booking tanpa invoice). */
  company:       CompanySnapshot
  banks:         BankSnapshot[]
  taxLines:      TaxLine[]
  /** Pajak yang DITAMBAHKAN ke tagihan. */
  taxAdded:      number
  /** Σ pembayaran terkonfirmasi. */
  paid:          number
  terms:         string
  footerNote:    string
  buyer: {
    name:    string
    address: string
    phone:   string
    email:   string
  }
  lineItems:   InvoiceLineItem[]
  subtotal:    number
  /** TAGIHAN = subtotal + pajak ditambahkan (lib/invoice/bill.ts). */
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


// Urutan baris di invoice: paket umroh, tiket, hotel, transport, muthowif, katering, paket ziarah, haji, visa; penyesuaian tingkat-booking paling akhir.
const ITEM_ORDER = ['package', 'flight', 'hotel', 'transport', 'muthowif', 'catering', 'tourPackage', 'haji', 'visa', 'booking']
// Item yang diurai SATU BARIS PER KOMPONEN di invoice (keputusan pemilik P2, docs/arsitektur-booking-engine-v2.md §10.2): "Visa × 2", "Hotel Makkah × 2", …
const ITEMIZED = new Set(['package'])

export async function buildInvoiceData(booking: InvoiceBooking): Promise<InvoiceData> {
  // Satu baris invoice per ITEM (paket berbaris-banyak — komponen, hotel, penyesuaian — tampil sebagai satu baris bagi pilgrim).
  const groups = new Map<string, { type: string; itemId: string; label: string; detail: string; qty: number; amountCents: number }>()
  for (const l of booking.priceSnapshots) {
    const itemized = ITEMIZED.has(l.itemType)
    const key = itemized ? `${l.itemType}|${l.itemId}|${l.lineKey}` : `${l.itemType}|${l.itemId}`
    const g = groups.get(key) ?? (itemized
      ? { type: l.itemType, itemId: l.itemId, label: l.description, detail: `${l.itemLabel} · ${l.itemDetail}`, qty: Number(l.qty), amountCents: 0 }
      : { type: l.itemType, itemId: l.itemId, label: l.itemLabel, detail: l.itemDetail, qty: l.itemQty, amountCents: 0 })
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
  // Tagihan, terbayar, dan sisa dari SATU pembaca (lib/invoice/bill.ts): pajak ditambahkan ikut ditagih; jumlah kurang tak pernah tampil lunas.
  const bill = billOf(booking)
  const inv = booking.invoice
  // Pajak tercetak harus = aturan beku × subtotal terkini (dokumen pajak): tak cocok → jangan terbitkan dokumen, sama seperti invarian I4.
  if (inv) {
    const expected = computeTax(subtotal, frozenTaxRules(inv.taxLines))
    if (Math.round(expected.addedIdr * 100) !== Math.round(Number(inv.taxAddedIdr) * 100) || Math.round(expected.includedIdr * 100) !== Math.round(Number(inv.taxIncludedIdr) * 100)) {
      throw new Error(`Invoice ${inv.number}: pajak tersimpan tidak sesuai subtotal ${subtotal}`)
    }
  }
  // Booking tanpa invoice (hanya pratinjau draf — semua booking terbit punya invoice sejak Fase 6a): kop & rekening dari setelan lama, tanpa pajak.
  const fallback = getPaymentConfig()

  return {
    invoiceNumber: inv?.number ?? `INV-${booking.bookingCode}`,
    invoiceDate:   inv ? formatCalendarDate(inv.invoiceDate, DATE_SHORT_MONTH_2D) : formatDate(booking.createdAt),
    dueDate:       inv ? formatCalendarDate(inv.dueDate, DATE_SHORT_MONTH_2D) : null,
    revision:      inv?.revision ?? 1,
    company:       inv ? (inv.companySnapshot as CompanySnapshot) : { name: fallback.businessName, taxId: null, address: fallback.businessAddress || null, phone: fallback.businessWa || null, email: null, website: null },
    banks:         inv ? (inv.bankSnapshot as BankSnapshot[]) : fallback.banks.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountName, branch: null })),
    taxLines:      inv ? (inv.taxLines as TaxLine[]) : [],
    taxAdded:      bill.taxAdded,
    paid:          bill.paid,
    terms:         plainText(inv?.termsDoc),
    footerNote:    plainText(inv?.footerNoteDoc),
    paidDate:      confirmedPayment?.confirmedAt ? formatDate(confirmedPayment.confirmedAt) : null,
    statusLabel:   STATUS_LABEL[displayStatus({ status: booking.status, confirmedAt: booking.confirmedAt, hasPendingPayment: booking.payments.some(p => p.status === 'pending'), departureDate: booking.departureDate, returnDate: booking.returnDate })],
    bookingCode:   booking.bookingCode,
    buyer: {
      name:    booking.user.fullName,
      address: formatAddressLine(booking.user.address),
      phone:   booking.user.phone ?? '',
      email:   booking.user.email,
    },
    lineItems,
    subtotal,
    totalAmount: bill.grandTotal,
    balanceDue:  Math.max(0, bill.balance),
  }
}
