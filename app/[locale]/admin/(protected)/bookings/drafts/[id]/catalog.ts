import type { BookingDraft } from '@/lib/validators/booking'
import { formatCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'

// Bentuk data katalog pemesanan (lib/booking/catalog.ts) di sisi klien + ringkasan item draf. Draf hanya menyimpan id; label dibaca dari katalog modul.
export type ModuleKey = 'visa' | 'flight' | 'hotel' | 'transport' | 'muthowif' | 'catering' | 'tourPackage' | 'package'
export type DraftItem = BookingDraft['items'][number]

export type VisaOpt = { id: string; name: string; visaType: string; tiers: Array<{ minDays: number; maxDays: number; fee: number }> }
export type FlightOpt = { id: string; label: string; from: string; to: string; seatsLeft: number; price: number }
export type HotelOpt = { id: string; hotelName: string; city: string; roomType: string; capacity: number; from: string; to: string; roomsLeft: number; price: number }
export type TransportOpt = { id: string; pricingId: string; tripId: string; tripName: string; category: string | null; vehicle: string; capacity: number; date: string; seatsLeft: number; price: number }
export type MuthowifOpt = { pricePerPersonDay: number }
export type CateringOpt = { id: string; name: string; prices?: { regular: number; ramadan: number; hajj: number } }
export type TourOpt = { id: string; name: string; price: number; transportMode: string; hotelMode: string; vehicleOptions: Array<{ pricingId: string; name: string }>; hotelOptions: Array<{ id: string; name: string }> }
type Choice = { id: string; name: string; perPerson?: number; price?: number }
export type PackageOpt = {
  id: string; name: string; pricePerPerson: number
  modes: Record<'hotelMakkah' | 'hotelMadinah' | 'transport' | 'muthowif' | 'visa' | 'flight' | 'catering', string>
  options: Record<'hotelMakkah' | 'hotelMadinah' | 'transport' | 'visa' | 'flight' | 'catering', Choice[]>
}

export type Catalog = {
  visa?: VisaOpt[]; flight?: FlightOpt[]; hotel?: HotelOpt[]; transport?: TransportOpt[]; muthowif?: MuthowifOpt
  catering?: CateringOpt[]; tourPackage?: TourOpt[]; package?: PackageOpt[]
}

export const MODULE_LABEL: Record<ModuleKey | DraftItem['itemType'], string> = {
  visa: 'Visa', flight: 'Tiket pesawat', hotel: 'Hotel', transport: 'Transport', muthowif: 'Muthowif', catering: 'Katering', tourPackage: 'Paket Ziarah', package: 'Paket Umroh', haji: 'Haji',
}

export const moduleOf = (item: DraftItem): DraftItem['itemType'] => item.itemType

const d = (iso: string) => formatCalendarDate(iso)

/** Satu baris ringkasan item untuk daftar di editor draf. Produk yang tak lagi ada di katalog (nonaktif/terhapus) ditandai, bukan disembunyikan. */
export function describeItem(item: DraftItem, c: Catalog): { title: string; detail: string } {
  const missing = { title: `${MODULE_LABEL[item.itemType]} (produk tidak tersedia lagi)`, detail: 'Hapus item ini atau pilih ulang' }
  switch (item.itemType) {
    case 'flight': {
      const o = c.flight?.find(x => x.id === item.flightScheduleId)
      return o ? { title: `Tiket ${o.label}`, detail: `${d(item.departureDate)} · ${item.numPassengers} penumpang · ${formatRupiah(o.price)}/orang` } : missing
    }
    case 'hotel': {
      const o = c.hotel?.find(x => x.id === item.hotelRoomScheduleId)
      return o ? { title: `${o.hotelName} — ${o.roomType}`, detail: `${d(item.checkIn)} – ${d(item.checkOut)} · ${item.nights} malam · ${item.numRooms} kamar` } : missing
    }
    case 'transport': {
      const o = c.transport?.find(x => x.id === item.transportQuotaId)
      return o ? { title: `${o.tripName} (${o.vehicle})`, detail: `${d(o.date)} · ${item.numPassengers} penumpang` } : missing
    }
    case 'muthowif':
      return { title: 'Layanan Muthowif', detail: `${d(item.startDate)} – ${d(item.endDate)} · ${item.numDays} hari · ${item.numPeople} orang` }
    case 'catering': {
      const o = c.catering?.find(x => x.id === item.cateringOptionId)
      return o ? { title: `Katering ${o.name}`, detail: `${d(item.startDate)} – ${d(item.endDate)} · ${item.numDays} hari · ${item.numPeople} orang` } : missing
    }
    case 'tourPackage': {
      const o = c.tourPackage?.find(x => x.id === item.tourPackageId)
      return o ? { title: `Paket Ziarah ${o.name}`, detail: `${item.tourDate ? d(item.tourDate) : 'tanggal belum diisi'} · ${item.numPeople} orang` } : missing
    }
    case 'package': {
      const o = c.package?.find(x => x.id === item.packageId)
      return o ? { title: `Paket Umroh ${o.name}`, detail: `${d(item.departureDate)} · ${item.numPeople} orang · ${formatRupiah(o.pricePerPerson)}/orang (dasar)` } : missing
    }
    case 'haji':
      return { title: 'Haji', detail: `${item.numPersons} orang` }
  }
}
