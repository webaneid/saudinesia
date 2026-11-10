import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { displayStatus, type DisplayStatus } from '@/lib/booking/lifecycle'
import { getFieldByRole, getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { DATE_SHORT_MONTH_2D, formatCalendarDate, formatInstant } from '@/lib/time'
import { formatAddressLine } from '@/lib/address/format'
import { billOf } from '@/lib/invoice/bill'
import { frozenTaxRules, type BankSnapshot, type CompanySnapshot } from '@/lib/invoice/issue'
import { computeTax } from '@/lib/invoice/tax'
import { payableBanks } from '@/lib/invoice/banks'
import type { TaxLine } from '@/lib/invoice/tax'
import { plainText } from '@/lib/rich-text/doc'
import { getPaymentConfig } from '@/lib/constants/payment'
import { BOOKING_PILGRIM_SAFE_SELECT } from '@/lib/pilgrims/safeSelect'
import { groupView } from '@/lib/booking/groups'

// Invoice dibangun HANYA dari `price_snapshots` (docs/arsitektur-harga-terpadu.md §17, invarian I3/I4/I5): harga yang tertera adalah harga yang DIBEKUKAN saat dipesan —
// bukan dihitung ulang dan bukan dibaca dari kolom harga item. Hanya JUAL yang masuk ke sini; modal/untung tak pernah keluar ke dokumen pilgrim.
// Nama jamaah pada baris Visa ditempel saat render dari manifest (snapshot sengaja tanpa data pribadi, UU PDP).
export const invoiceBookingInclude = {
  user: { include: { address: { include: { province: true, regency: true, district: true, village: true } } } },
  priceSnapshots: { where: { voidedAt: null }, orderBy: [{ takenAt: 'asc' }, { itemType: 'asc' }, { itemId: 'asc' }, { lineKey: 'asc' }] }, // baris di-void revisi tak tampil (T1)
  pilgrims:   { orderBy: { id: 'asc' }, select: { ...BOOKING_PILGRIM_SAFE_SELECT, visaApplication: { select: { id: true, visaProductId: true } } } }, // tanpa kolom NIK/paspor tersegel
  payments: true,
  invoice: true,
  // Rombongan (§10.8, 11d-2b): nama bagian dirender dari label hidup, bukan snapshot; item hanya membawa rombongannya.
  groups:       { orderBy: { position: 'asc' }, select: { id: true, label: true, position: true } },
  hotels:       { select: { id: true, groupId: true } },
  transports:   { select: { id: true, groupId: true } },
  flights:      { select: { id: true, groupId: true } },
  muthowif:     { select: { id: true, groupId: true } },
  catering:     { select: { id: true, groupId: true } },
  tourPackages: { select: { id: true, groupId: true } },
  haji:         { select: { id: true, groupId: true } },
  packages:     { select: { id: true, groupId: true } },
} satisfies Prisma.BookingInclude

export type InvoiceBooking = Prisma.BookingGetPayload<{ include: typeof invoiceBookingInclude }>

export type InvoiceLineItem = {
  label:       string
  description: string
  qty:         number
  unitPrice:   number
  amount:      number
  /** Baris per jamaah (visa): label TANPA nama + satuan, supaya tampilan ringkas bisa menggabungkannya jadi "3 jamaah × Rp …" (lib/booking/orderSummary.ts). PDF tidak memakainya. */
  group?:      { label: string; unit: string }
  /** Booking berrombongan saja: nama bagian (rombongan, "Semua jamaah", atau "Penyesuaian") — tampilan memberi subjudul saat bagian berganti. */
  section?:    string
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

/** `db` = klien transaksi bila dipanggil di dalam transaksi (pratinjau draf/revisi, SEC-212): jangan mengambil koneksi pool kedua. */
export async function buildInvoiceData(booking: InvoiceBooking, db: Pick<Prisma.TransactionClient, 'manifestFieldRequirement' | 'bankAccount'> = prisma): Promise<InvoiceData> {
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
  // Booking berrombongan: baris dikelompokkan per rombongan ("Semua jamaah" dulu, lalu urut posisi), penyesuaian tingkat booking paling akhir.
  const view = groupView(booking.groups)
  const itemGroup = new Map<string, string | null>([
    ...booking.hotels.map(r => [`hotel|${r.id}`, r.groupId] as const), ...booking.transports.map(r => [`transport|${r.id}`, r.groupId] as const),
    ...booking.flights.map(r => [`flight|${r.id}`, r.groupId] as const), ...booking.muthowif.map(r => [`muthowif|${r.id}`, r.groupId] as const),
    ...booking.catering.map(r => [`catering|${r.id}`, r.groupId] as const), ...booking.tourPackages.map(r => [`tourPackage|${r.id}`, r.groupId] as const),
    ...booking.haji.map(r => [`haji|${r.id}`, r.groupId] as const), ...booking.packages.map(r => [`package|${r.id}`, r.groupId] as const),
  ])
  const groupOf = (type: string, itemId: string) => (type === 'visa' ? pilgrimByVisa.get(itemId)?.groupId : itemGroup.get(`${type}|${itemId}`)) ?? null
  const rankOf = (type: string, itemId: string) => (!view ? 0 : type === 'booking' ? Number.MAX_SAFE_INTEGER : view.rank(groupOf(type, itemId)))
  const lineItems: InvoiceLineItem[] = []
  const ordered = [...groups.values()].sort((a, b) => rankOf(a.type, a.itemId) - rankOf(b.type, b.itemId) || ITEM_ORDER.indexOf(a.type) - ITEM_ORDER.indexOf(b.type))
  // Definisi field dimuat SEKALI per produk visa (bukan per baris — booking bisa memuat ribuan jamaah; tautan publik bisa memicunya tanpa login).
  const fieldsByProduct = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const g of ordered) {
    let label = g.label
    let group: InvoiceLineItem['group']
    if (g.type === 'visa') {
      group = { label: g.label, unit: 'jamaah' }
      const p = pilgrimByVisa.get(g.itemId)
      const productId = p?.visaApplication?.visaProductId
      if (productId && !fieldsByProduct.has(productId)) fieldsByProduct.set(productId, await getManifestFieldRequirements('visa', productId, db))
      const fields = productId ? fieldsByProduct.get(productId)! : []
      const rawName = p ? getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name') : null
      label = `${g.label} — ${typeof rawName === 'string' && rawName ? rawName : 'Jamaah'}`
    }
    const amount = g.amountCents / 100
    const section = view ? (g.type === 'booking' ? 'Penyesuaian' : view.name(groupOf(g.type, g.itemId))) : undefined
    lineItems.push({ label, description: g.detail, qty: g.qty, unitPrice: amount / g.qty, amount, ...(group ? { group } : {}), ...(section ? { section } : {}) })
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
    // Cadangan rekening aktif hanya selama tagihan masih bisa dibayar; dokumen booking lunas/batal/hangus tetap apa adanya.
    banks:         inv ? (booking.status === 'active' && !booking.confirmedAt ? await payableBanks(inv.bankSnapshot as BankSnapshot[], db) : inv.bankSnapshot as BankSnapshot[]) : fallback.banks.map(b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountName, branch: null })),
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
