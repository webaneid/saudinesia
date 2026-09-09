import type { Prisma } from '@prisma/client'
import { getFieldByRole, getManifestFieldRequirements } from '@/lib/manifest/getRequirements'

// docs/arsitektur-booking.md §6 Step 7 — normalisasi SATU TEMPAT dari 7 relasi per-tipe existing
// (Opsi B) jadi bentuk seragam siap-render, dipakai lib/pdf/invoice.tsx. Visa diambil dari
// pilgrims[].visaApplication — BUKAN relasi booking.visa (model BookingVisa TIDAK PERNAH dipakai
// kode manapun, selalu kosong, lihat docs/decisions.md 2026-07-25).
export const invoiceBookingInclude = {
  user: { include: { address: { include: { province: true, regency: true, district: true, village: true } } } },
  hotels: { include: { hotelRoomSchedule: { include: { period: { include: { hotel: true } }, roomType: true } } } },
  transports: { include: { transportQuota: { include: { pricing: { include: { trip: true, vehicle: true } } } } } },
  muthowif: true,
  catering: { include: { cateringOption: true } },
  tourPackages: { include: { tourPackage: true } },
  haji: { include: { hajiProduct: true } },
  pilgrims: { include: { visaApplication: { include: { visaProduct: true } } } },
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

const STATUS_LABEL: Record<string, string> = {
  awaiting_payment: 'UNPAID',
  payment_review:   'MENUNGGU KONFIRMASI',
  confirmed:        'LUNAS',
  active:           'LUNAS',
  completed:        'LUNAS',
  cancelled:        'DIBATALKAN',
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
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

export async function buildInvoiceData(booking: InvoiceBooking): Promise<InvoiceData> {
  const lineItems: InvoiceLineItem[] = []

  for (const h of booking.hotels) {
    lineItems.push({
      label: `${h.hotelRoomSchedule.period.hotel.name} — ${h.hotelRoomSchedule.roomType.name}`,
      description: `${formatDate(h.checkIn)} – ${formatDate(h.checkOut)} · ${h.nights} malam · ${h.numRooms} kamar`,
      qty: h.numRooms,
      unitPrice: Number(h.pricePerNight) * h.nights,
      amount: Number(h.totalPrice),
    })
  }

  for (const t of booking.transports) {
    lineItems.push({
      label: `${t.transportQuota.pricing.trip.name} (${t.transportQuota.pricing.vehicle.name})`,
      description: `${formatDate(t.travelDate)} · ${t.numPassengers} penumpang`,
      qty: t.numPassengers,
      unitPrice: Number(t.unitPrice),
      amount: Number(t.totalPrice),
    })
  }

  for (const m of booking.muthowif) {
    lineItems.push({
      label: 'Layanan Muthowif',
      description: `${formatDate(m.startDate)} – ${formatDate(m.endDate)} · ${m.numDays} hari · ${m.numPeople} orang`,
      qty: m.numPeople,
      unitPrice: Number(m.totalPrice) / m.numPeople,
      amount: Number(m.totalPrice),
    })
  }

  for (const c of booking.catering) {
    lineItems.push({
      label: c.cateringOption.name,
      description: `${formatDate(c.startDate)} – ${formatDate(c.endDate)} · ${c.numDays} hari · ${c.numPeople} orang`,
      qty: c.numPeople,
      unitPrice: Number(c.totalPrice) / c.numPeople,
      amount: Number(c.totalPrice),
    })
  }

  for (const tp of booking.tourPackages) {
    lineItems.push({
      label: tp.tourPackage.name,
      description: `${formatDate(tp.tourDate)} · ${tp.numPeople} orang`,
      qty: tp.numPeople,
      unitPrice: Number(tp.totalPrice) / tp.numPeople,
      amount: Number(tp.totalPrice),
    })
  }

  for (const h of booking.haji) {
    lineItems.push({
      label: h.hajiProduct.name,
      description: `${h.numPersons} orang`,
      qty: h.numPersons,
      unitPrice: Number(h.totalPrice) / h.numPersons,
      amount: Number(h.totalPrice),
    })
  }

  for (const p of booking.pilgrims) {
    const va = p.visaApplication
    if (!va || va.sellPriceSnapshot == null) continue
    const fields = va.visaProductId ? await getManifestFieldRequirements('visa', va.visaProductId) : []
    const rawName = getFieldByRole(fields, p.fieldValues as Record<string, unknown>, 'display_name')
    const displayName = typeof rawName === 'string' && rawName ? rawName : 'Jamaah'
    const productName = va.visaProduct?.name ?? va.visaType
    const label = /visa/i.test(productName) ? productName : `Visa ${productName}`
    lineItems.push({
      label: `${label} — ${displayName}`,
      description: va.selectedDurationDays ? `${va.selectedDurationDays} hari` : '',
      qty: 1,
      unitPrice: Number(va.sellPriceSnapshot),
      amount: Number(va.sellPriceSnapshot),
    })
  }

  const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0)
  const totalAmount = Number(booking.totalAmount)
  const confirmedPayment = booking.payments.find(p => p.status === 'confirmed')
  const balanceDue = confirmedPayment ? 0 : totalAmount

  return {
    invoiceNumber: `INV-${booking.bookingCode}`,
    invoiceDate:   formatDate(booking.createdAt),
    dueDate:       booking.paymentDeadline ? formatDate(booking.paymentDeadline) : null,
    paidDate:      confirmedPayment?.confirmedAt ? formatDate(confirmedPayment.confirmedAt) : null,
    statusLabel:   STATUS_LABEL[booking.status] ?? booking.status,
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
