'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/admin/ui/Modal'
import { Button } from '@/components/admin/ui/Button'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { formatRupiah } from '@/lib/utils'
import { daysBetween, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { MODULE_LABEL, type Catalog, type DraftItem, type ModuleKey } from './catalog'

// Popup "Tambah produk" (docs/arsitektur-booking-engine-v2.md §10.3): pilih modul → pilih produk modul itu → atur tanggal/jumlah/pilihan. Harga di sini hanya
// petunjuk; angka yang mengikat dihitung server saat pratinjau dan terbit. Visa bukan item booking: visa dipasang ke jamaah (per orang).

export type AddResult = { kind: 'item'; item: DraftItem } | { kind: 'visa'; visaProductId: string; count: number; days?: number }

type Props = {
  open: boolean
  onClose: () => void
  catalog: Catalog
  load: (m: ModuleKey) => Promise<void>
  defaultPeople: number
  /** Modul yang langsung terpilih (mis. dari tautan "tambah tiket pesawat" pada pelanggaran aturan visa). */
  initialModule?: ModuleKey
  onAdd: (r: AddResult) => void
}

const MODULES: ModuleKey[] = ['package', 'visa', 'flight', 'hotel', 'transport', 'muthowif', 'catering', 'tourPackage']
const num = (v: string) => Math.max(0, Math.trunc(Number(v) || 0))
const span = (a: string, b: string) => (a && b ? daysBetween(a as CalendarDate, b as CalendarDate) : 0)
const fmt = (iso: string) => formatCalendarDate(iso)

export function AddItemModal({ open, onClose, catalog, load, defaultPeople, initialModule, onAdd }: Props) {
  const [module, setModule] = useState<ModuleKey | ''>('')
  const [pick, setPick] = useState('')
  const [people, setPeople] = useState(String(defaultPeople))
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [rooms, setRooms] = useState('1')
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (module) void load(module) }, [module, load])
  useEffect(() => { if (open) { setModule(initialModule ?? ''); reset() } }, [open, initialModule]) // eslint-disable-line react-hooks/exhaustive-deps
  function reset() { setPick(''); setStart(''); setEnd(''); setRooms('1'); setExtra({}); setError(null); setPeople(String(defaultPeople)) }

  const n = num(people)
  const setX = (k: string, v: string) => setExtra(e => ({ ...e, [k]: v }))

  function add() {
    setError(null)
    const fail = (m: string) => { setError(m); return undefined }
    if (!module || !pick) return fail('Pilih produk lebih dulu')
    if (n < 1) return fail('Jumlah orang minimal 1')
    let r: AddResult | undefined
    switch (module) {
      case 'visa':
        r = { kind: 'visa', visaProductId: pick, count: n, ...(extra.days ? { days: Math.max(1, num(extra.days)) } : {}) }
        break
      case 'flight':
        if (!start) return fail('Isi tanggal terbang')
        r = { kind: 'item', item: { itemType: 'flight', flightScheduleId: pick, departureDate: start, numPassengers: n } }
        break
      case 'hotel': {
        const nights = span(start, end)
        if (nights < 1) return fail('Tanggal check-out harus setelah check-in')
        r = { kind: 'item', item: { itemType: 'hotel', hotelRoomScheduleId: pick, checkIn: start, checkOut: end, nights, numRooms: Math.max(1, num(rooms)) } }
        break
      }
      case 'transport':
        r = { kind: 'item', item: { itemType: 'transport', transportQuotaId: pick, numPassengers: n, ...(extra.pickup ? { pickupDetail: extra.pickup } : {}), ...(extra.dropoff ? { dropoffDetail: extra.dropoff } : {}) } }
        break
      case 'muthowif':
      case 'catering': {
        const days = span(start, end) + 1
        if (!start || !end || days < 1) return fail('Tanggal selesai tidak boleh sebelum tanggal mulai')
        r = module === 'muthowif'
          ? { kind: 'item', item: { itemType: 'muthowif', startDate: start, endDate: end, numDays: days, numPeople: n } }
          : { kind: 'item', item: { itemType: 'catering', cateringOptionId: pick, startDate: start, endDate: end, numDays: days, numPeople: n } }
        break
      }
      case 'tourPackage': {
        if (!start) return fail('Isi tanggal tur')
        const t = catalog.tourPackage?.find(x => x.id === pick)
        if (t?.transportMode === 'user_choice' && !extra.quota) return fail('Pilih kendaraan untuk tanggal itu')
        r = { kind: 'item', item: {
          itemType: 'tourPackage', tourPackageId: pick, tourDate: start, numPeople: n,
          ...(extra.quota ? { transportQuotaId: extra.quota } : {}),
          ...(extra.hotel ? { chosenHotelRoomScheduleId: extra.hotel, chosenHotelNumRooms: Math.max(1, num(rooms)) } : {}),
        } }
        break
      }
      case 'package': {
        if (!start) return fail('Isi tanggal berangkat')
        const choices = Object.fromEntries(Object.entries({
          hotelMakkahScheduleId: extra.hotelMakkah, hotelMadinahScheduleId: extra.hotelMadinah, transportPricingId: extra.transport,
          visaProductId: extra.visa, flightScheduleId: extra.flight, cateringOptionId: extra.catering,
        }).filter(([, v]) => !!v))
        r = { kind: 'item', item: { itemType: 'package', packageId: pick, departureDate: start, numPeople: n, choices } }
        break
      }
    }
    if (r) { onAdd(r); onClose() }
  }

  const options = (() => {
    switch (module) {
      case 'visa': return (catalog.visa ?? []).map(o => ({ id: o.id, label: o.name, hint: o.tiers[0] ? `mulai ${formatRupiah(Math.min(...o.tiers.map(t => t.fee)))}` : 'belum berharga' }))
      case 'flight': return (catalog.flight ?? []).map(o => ({ id: o.id, label: o.label, hint: `${fmt(o.from)} – ${fmt(o.to)} · sisa ${o.seatsLeft} · ${formatRupiah(o.price)}` }))
      case 'hotel': return (catalog.hotel ?? []).map(o => ({ id: o.id, label: `${o.hotelName} — ${o.roomType}`, hint: `${o.city} · ${fmt(o.from)} – ${fmt(o.to)} · ${formatRupiah(o.price)}/malam` }))
      case 'transport': return (catalog.transport ?? []).map(o => ({ id: o.id, label: `${fmt(o.date)} — ${o.tripName}`, hint: `${o.vehicle} · sisa ${o.seatsLeft} kursi · ${formatRupiah(o.price)}` }))
      case 'muthowif': return [{ id: 'muthowif', label: 'Layanan Muthowif', hint: `${formatRupiah(catalog.muthowif?.pricePerPersonDay ?? 0)}/orang/hari` }]
      case 'catering': return (catalog.catering ?? []).map(o => ({ id: o.id, label: o.name, hint: o.prices ? `${formatRupiah(o.prices.regular)}/orang/hari (reguler)` : '' }))
      case 'tourPackage': return (catalog.tourPackage ?? []).map(o => ({ id: o.id, label: o.name, hint: formatRupiah(o.price) }))
      case 'package': return (catalog.package ?? []).map(o => ({ id: o.id, label: o.name, hint: `${formatRupiah(o.pricePerPerson)}/orang (dasar)` }))
      default: return []
    }
  })()

  const flight = module === 'flight' ? catalog.flight?.find(x => x.id === pick) : undefined
  const hotel = module === 'hotel' ? catalog.hotel?.find(x => x.id === pick) : undefined
  const tour = module === 'tourPackage' ? catalog.tourPackage?.find(x => x.id === pick) : undefined
  const pkg = module === 'package' ? catalog.package?.find(x => x.id === pick) : undefined
  const tourQuotas = tour && start ? (catalog.transport ?? []).filter(q => q.date === start && tour.vehicleOptions.some(v => v.pricingId === q.pricingId)) : []
  useEffect(() => { if (tour?.transportMode === 'user_choice') void load('transport') }, [tour, load])

  const needsPeople = module !== '' && module !== 'hotel'
  const label = (t: string, el: React.ReactNode) => <label className="block space-y-1"><span className="text-xs text-admin-muted">{t}</span>{el}</label>

  return (
    <Modal open={open} title="Tambah produk" onClose={onClose}>
      <div className="space-y-3">
        {label('Modul', <ChoiceSelect ariaLabel="Modul" value={module} onChange={v => { setModule(v as ModuleKey | ''); reset() }} options={MODULES.map(m => ({ id: m, label: MODULE_LABEL[m] }))} placeholder="— pilih modul —" />)}
        {module && label('Produk', <ChoiceSelect ariaLabel="Produk" value={pick} onChange={v => { setPick(v); setError(null) }} options={options} placeholder={options.length ? '— pilih produk —' : 'Memuat / belum ada produk'} />)}

        {module === 'flight' && label(`Tanggal terbang${flight ? ` (${fmt(flight.from)} – ${fmt(flight.to)})` : ''}`, <input type="date" className="admin-inp" min={flight?.from} max={flight?.to} value={start} onChange={e => setStart(e.target.value)} />)}
        {module === 'hotel' && (
          <div className="grid gap-2 sm:grid-cols-3">
            {label('Check-in', <input type="date" className="admin-inp" min={hotel?.from} max={hotel?.to} value={start} onChange={e => setStart(e.target.value)} />)}
            {label('Check-out', <input type="date" className="admin-inp" min={start || hotel?.from} max={hotel?.to} value={end} onChange={e => setEnd(e.target.value)} />)}
            {label('Jumlah kamar', <input type="number" min={1} className="admin-inp" value={rooms} onChange={e => setRooms(e.target.value)} />)}
          </div>
        )}
        {(module === 'muthowif' || module === 'catering') && (
          <div className="grid gap-2 sm:grid-cols-2">
            {label('Mulai', <input type="date" className="admin-inp" value={start} onChange={e => setStart(e.target.value)} />)}
            {label('Selesai', <input type="date" className="admin-inp" min={start} value={end} onChange={e => setEnd(e.target.value)} />)}
          </div>
        )}
        {module === 'transport' && (
          <div className="grid gap-2 sm:grid-cols-2">
            {label('Detail penjemputan (opsional)', <input className="admin-inp" maxLength={300} value={extra.pickup ?? ''} onChange={e => setX('pickup', e.target.value)} />)}
            {label('Detail pengantaran (opsional)', <input className="admin-inp" maxLength={300} value={extra.dropoff ?? ''} onChange={e => setX('dropoff', e.target.value)} />)}
          </div>
        )}
        {module === 'visa' && label('Lama tinggal (hari, opsional — menentukan tier harga)', <input type="number" min={1} className="admin-inp" value={extra.days ?? ''} onChange={e => setX('days', e.target.value)} />)}
        {(module === 'tourPackage' || module === 'package') && label(module === 'package' ? 'Tanggal berangkat' : 'Tanggal tur', <input type="date" className="admin-inp" value={start} onChange={e => setStart(e.target.value)} />)}
        {tour?.transportMode === 'user_choice' && label('Kendaraan (tanggal tur)', <ChoiceSelect ariaLabel="Kendaraan" value={extra.quota ?? ''} onChange={v => setX('quota', v)} options={tourQuotas.map(q => ({ id: q.id, label: q.vehicle, hint: `sisa ${q.seatsLeft} kursi · ${formatRupiah(q.price)}` }))} placeholder={start ? (tourQuotas.length ? '— pilih kendaraan —' : 'Tak ada kendaraan di tanggal ini') : 'Isi tanggal tur dulu'} />)}
        {tour?.hotelMode === 'user_choice' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">{label('Hotel pilihan (opsional)', <ChoiceSelect ariaLabel="Hotel pilihan" value={extra.hotel ?? ''} onChange={v => setX('hotel', v)} options={tour.hotelOptions.map(h => ({ id: h.id, label: h.name }))} placeholder="— tanpa hotel —" />)}</div>
            {label('Kamar', <input type="number" min={1} className="admin-inp" value={rooms} onChange={e => setRooms(e.target.value)} />)}
          </div>
        )}
        {pkg && (['hotelMakkah', 'hotelMadinah', 'flight', 'visa', 'transport', 'catering'] as const).filter(k => pkg.modes[k] === 'user_choice').map(k => (
          <div key={k}>{label(`Pilihan ${({ hotelMakkah: 'Hotel Makkah', hotelMadinah: 'Hotel Madinah', flight: 'Tiket pesawat', visa: 'Visa', transport: 'Kendaraan', catering: 'Katering' })[k]} (opsional)`,
            <ChoiceSelect ariaLabel={`Pilihan ${k}`} value={extra[k] ?? ''} onChange={v => setX(k, v)} placeholder="— tidak dipilih —"
              options={pkg.options[k].map(o => ({ id: o.id, label: o.name, hint: o.perPerson != null ? `${formatRupiah(o.perPerson)}/orang` : o.price != null ? formatRupiah(o.price) : '' }))} />)}</div>
        ))}
        {needsPeople && label(module === 'visa' ? 'Untuk berapa jamaah' : module === 'flight' || module === 'transport' ? 'Jumlah penumpang' : 'Jumlah orang', <input type="number" min={1} className="admin-inp" value={people} onChange={e => setPeople(e.target.value)} />)}

        {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" onClick={add} disabled={!pick}>Tambahkan</Button>
        </div>
      </div>
    </Modal>
  )
}
