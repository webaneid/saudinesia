'use client'

import { useEffect } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { Button } from '@/components/admin/ui/Button'
import { formatRupiah } from '@/lib/utils'
import { daysBetween, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { hotelsOf, noPeriodMessage, resolveHotelSchedule, roomsOf } from '@/lib/booking/hotelPick'
import { MODULE_LABEL, type Catalog, type DraftItem, type ModuleKey } from './catalog'

// Editor BARIS produk (docs/arsitektur-booking-engine-v2.md §10.4, arahan pemilik 2026-11-01 — gaya baris invoice): satu baris per item, semua kolom langsung dapat diubah,
// subtotal baris & total dihitung SERVER (pratinjau otomatis oleh induk). Dipakai form draf dan editor revisi. Harga satuan tidak diketik; di revisi ada kolom harga khusus (R4).

export type RowFields = { pick: string; start: string; end: string; people: string; rooms: string; extra: Record<string, string> }
export type ItemRow = {
  key: string
  module: ModuleKey | ''
  f: RowFields
  /** Revisi: baris item lama (rujukan ke baris booking) + label tersimpan (untuk produk yang tak lagi ada di katalog). */
  ref?: { itemType: 'hotel' | 'transport' | 'muthowif' | 'catering' | 'tourPackage' | 'flight' | 'package'; itemId: string }
  label?: string
  customSellIdr?: number | null
  priceNote?: string
}

export const ROW_MODULES: ModuleKey[] = ['package', 'flight', 'hotel', 'transport', 'muthowif', 'catering', 'tourPackage']
const num = (v: string) => Math.max(0, Math.trunc(Number(v) || 0))
const span = (a: string, b: string) => (a && b ? daysBetween(a as CalendarDate, b as CalendarDate) : 0)
const fmt = (iso: string) => formatCalendarDate(iso)
let seq = 0
export const newRowKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`
const empty = (people: number): RowFields => ({ pick: '', start: '', end: '', people: String(people), rooms: '1', extra: {} })

/**
 * Baris hotel (docs/arsitektur-hotel.md §12.6): admin memilih Hotel → Tipe kamar (`extra.hotel`/`extra.room`), PERIODE harga dipilih otomatis dari tanggal
 * (`f.pick` = jadwal kamar hasil `resolveHotelSchedule`). Baris dari draf/booking hanya menyimpan jadwal → pilihan diturunkan dari katalog.
 */
function hotelSel(row: ItemRow, catalog: Catalog): { hotel: string; room: string } {
  const o = row.f.pick ? catalog.hotel?.find(x => x.id === row.f.pick) : undefined
  return { hotel: row.f.extra.hotel ?? o?.hotelId ?? '', room: row.f.extra.room ?? o?.roomTypeId ?? '' }
}
/** Baris hotel lama yang jadwalnya tak lagi di katalog (nonaktif / periode lewat) dan belum diubah: dikirim apa adanya, server yang memutuskan. */
const hotelLegacy = (row: ItemRow, catalog: Catalog) => !!row.f.pick && !hotelSel(row, catalog).hotel

export function newRow(people: number, module: ModuleKey | '' = ''): ItemRow {
  return { key: newRowKey(), module, f: empty(people) }
}

/** Baris dari item yang sudah ada (draf tersimpan / isi booking saat revisi). */
export function rowFromItem(it: DraftItem, extra: Partial<ItemRow> = {}): ItemRow {
  const r = (module: ModuleKey, pick: string, o: Partial<RowFields> = {}): ItemRow => ({
    key: newRowKey(), module, ...extra,
    f: { pick, start: o.start ?? '', end: o.end ?? '', people: o.people ?? '1', rooms: o.rooms ?? '1', extra: Object.fromEntries(Object.entries(o.extra ?? {}).filter(([, v]) => !!v)) },
  })
  switch (it.itemType) {
    case 'flight': return r('flight', it.flightScheduleId, { people: String(it.numPassengers), start: it.departureDate })
    case 'hotel': return r('hotel', it.hotelRoomScheduleId, { start: it.checkIn, end: it.checkOut, rooms: String(it.numRooms) })
    case 'transport': return r('transport', it.transportQuotaId, { people: String(it.numPassengers), extra: { pickup: it.pickupDetail ?? '', dropoff: it.dropoffDetail ?? '' } })
    case 'muthowif': return r('muthowif', 'muthowif', { people: String(it.numPeople), start: it.startDate, end: it.endDate })
    case 'catering': return r('catering', it.cateringOptionId, { people: String(it.numPeople), start: it.startDate, end: it.endDate })
    case 'tourPackage': return r('tourPackage', it.tourPackageId, { people: String(it.numPeople), start: it.tourDate ?? '', rooms: String(it.chosenHotelNumRooms ?? 1), extra: { quota: it.transportQuotaId ?? '', hotel: it.chosenHotelRoomScheduleId ?? '' } })
    case 'package': return r('package', it.packageId, { people: String(it.numPeople), start: it.departureDate, extra: {
      hotelMakkah: it.choices.hotelMakkahScheduleId ?? '', hotelMadinah: it.choices.hotelMadinahScheduleId ?? '', transport: it.choices.transportPricingId ?? '',
      visa: it.choices.visaProductId ?? '', flight: it.choices.flightScheduleId ?? '', catering: it.choices.cateringOptionId ?? '',
    } })
    case 'haji': return { key: newRowKey(), module: '', f: empty(1), ...extra } // tak dapat diedit lewat form admin
  }
}

/** Baris → item masukan pesan; `error` = alasan baris belum lengkap (ditampilkan di baris, menahan simpan/terbit). */
export function rowToItem(row: ItemRow, catalog: Catalog): { item: DraftItem } | { error: string } {
  const { module, f } = row
  const n = num(f.people)
  if (!module) return { error: 'Pilih jenis produk' }
  if (!f.pick && module !== 'hotel') return { error: 'Pilih produk' }
  switch (module) {
    case 'flight':
      if (!f.start) return { error: 'Isi tanggal terbang' }
      if (n < 1) return { error: 'Penumpang minimal 1' }
      return { item: { itemType: 'flight', flightScheduleId: f.pick, departureDate: f.start, numPassengers: n } }
    case 'hotel': {
      const nights = span(f.start, f.end)
      const rooms = Math.max(1, num(f.rooms))
      if (hotelLegacy(row, catalog)) {
        if (nights < 1) return { error: 'Check-out harus setelah check-in' }
        return { item: { itemType: 'hotel', hotelRoomScheduleId: f.pick, checkIn: f.start, checkOut: f.end, nights, numRooms: rooms } }
      }
      const sel = hotelSel(row, catalog)
      if (!sel.hotel) return { error: 'Pilih hotel' }
      if (!sel.room) return { error: 'Pilih tipe kamar' }
      if (!f.start || !f.end) return { error: 'Isi tanggal check-in dan check-out' }
      if (nights < 1) return { error: 'Check-out harus setelah check-in' }
      const res = resolveHotelSchedule(catalog.hotel ?? [], sel.hotel, sel.room, f.start, f.end)
      if (!res.ok) return { error: noPeriodMessage(res.periods) }
      return { item: { itemType: 'hotel', hotelRoomScheduleId: res.schedule.id, checkIn: f.start, checkOut: f.end, nights, numRooms: rooms } }
    }
    case 'transport':
      if (n < 1) return { error: 'Penumpang minimal 1' }
      return { item: { itemType: 'transport', transportQuotaId: f.pick, numPassengers: n, ...(f.extra.pickup ? { pickupDetail: f.extra.pickup } : {}), ...(f.extra.dropoff ? { dropoffDetail: f.extra.dropoff } : {}) } }
    case 'muthowif':
    case 'catering': {
      const days = span(f.start, f.end) + 1
      if (!f.start || !f.end || days < 1) return { error: 'Tanggal selesai tidak boleh sebelum tanggal mulai' }
      if (n < 1) return { error: 'Jumlah orang minimal 1' }
      return module === 'muthowif'
        ? { item: { itemType: 'muthowif', startDate: f.start, endDate: f.end, numDays: days, numPeople: n } }
        : { item: { itemType: 'catering', cateringOptionId: f.pick, startDate: f.start, endDate: f.end, numDays: days, numPeople: n } }
    }
    case 'tourPackage': {
      if (!f.start) return { error: 'Isi tanggal tur' }
      if (n < 1) return { error: 'Jumlah orang minimal 1' }
      const t = catalog.tourPackage?.find(x => x.id === f.pick)
      if (t?.transportMode === 'user_choice' && !f.extra.quota) return { error: 'Pilih kendaraan untuk tanggal itu' }
      return { item: {
        itemType: 'tourPackage', tourPackageId: f.pick, tourDate: f.start, numPeople: n,
        ...(f.extra.quota ? { transportQuotaId: f.extra.quota } : {}),
        ...(f.extra.hotel ? { chosenHotelRoomScheduleId: f.extra.hotel, chosenHotelNumRooms: Math.max(1, num(f.rooms)) } : {}),
      } }
    }
    case 'package': {
      if (!f.start) return { error: 'Isi tanggal berangkat' }
      if (n < 1) return { error: 'Jumlah orang minimal 1' }
      const choices = Object.fromEntries(Object.entries({
        hotelMakkahScheduleId: f.extra.hotelMakkah, hotelMadinahScheduleId: f.extra.hotelMadinah, transportPricingId: f.extra.transport,
        visaProductId: f.extra.visa, flightScheduleId: f.extra.flight, cateringOptionId: f.extra.catering,
      }).filter(([, v]) => !!v))
      return { item: { itemType: 'package', packageId: f.pick, departureDate: f.start, numPeople: n, choices } }
    }
    case 'visa':
      return { error: 'Visa dipasang per jamaah di kotak Jamaah' }
  }
}

type Props = {
  rows: ItemRow[]
  onChange: (rows: ItemRow[]) => void
  catalog: Catalog
  load: (m: ModuleKey) => Promise<void>
  defaultPeople: number
  /** Subtotal baris dari pratinjau server (urut baris); `undefined` = belum dihitung. */
  totals?: (number | undefined)[]
  computing?: boolean
  /** Editor revisi: kolom harga khusus + catatan (R4). */
  customPrice?: boolean
  /** Galat server yang menunjuk satu baris (`meta.itemIndex`): mis. tanggal di luar periode harga, kuota kurang. */
  rowError?: { index: number; message: string }
}

/** Harga jual satuan dari katalog (server) — tampil langsung, tanpa menunggu pratinjau. Subtotal tetap dari server (harga tak dihitung di klien). */
function unitPrice(row: ItemRow, catalog: Catalog): { amount: number; unit: string } | null {
  const id = row.f.pick
  if (!id) return null
  switch (row.module) {
    case 'flight': { const o = catalog.flight?.find(x => x.id === id); return o ? { amount: o.price, unit: '/penumpang' } : null }
    case 'hotel': { const o = catalog.hotel?.find(x => x.id === id); return o ? { amount: o.price, unit: '/kamar/malam' } : null }
    case 'transport': { const o = catalog.transport?.find(x => x.id === id); return o ? { amount: o.price, unit: '/kendaraan' } : null }
    case 'muthowif': return catalog.muthowif ? { amount: catalog.muthowif.pricePerPersonDay, unit: '/orang/hari' } : null
    case 'catering': { const o = catalog.catering?.find(x => x.id === id); return o?.prices ? { amount: o.prices.regular, unit: '/orang/hari (reguler)' } : null }
    case 'tourPackage': { const o = catalog.tourPackage?.find(x => x.id === id); return o ? { amount: o.price, unit: '(dasar)' } : null }
    case 'package': { const o = catalog.package?.find(x => x.id === id); return o ? { amount: o.pricePerPerson, unit: '/orang (dasar)' } : null }
    default: return null
  }
}

/** Kolom baris (≥ xl; editor berada di kolom kiri yang sempit): Produk · Tanggal · Jumlah · Harga · Subtotal · hapus. Di HP bertumpuk dua kolom. */
const GRID = 'xl:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_1.75rem]'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block space-y-0.5 ${className}`}><span className="block text-[11px] text-admin-muted">{label}</span>{children}</label>
}

export function ItemRows({ rows, onChange, catalog, load, defaultPeople, totals, computing, customPrice, rowError }: Props) {
  const modulesInUse = [...new Set(rows.map(r => r.module).filter((m): m is ModuleKey => m !== ''))]
  useEffect(() => { for (const m of modulesInUse) void load(m) }, [modulesInUse.join(','), load]) // eslint-disable-line react-hooks/exhaustive-deps
  const needsTransport = rows.some(r => r.module === 'tourPackage' && catalog.tourPackage?.find(t => t.id === r.f.pick)?.transportMode === 'user_choice')
  useEffect(() => { if (needsTransport) void load('transport') }, [needsTransport, load])

  const set = (i: number, patch: Partial<ItemRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setF = (i: number, patch: Partial<RowFields>) => onChange(rows.map((r, j) => (j === i ? { ...r, f: { ...r.f, ...patch } } : r)))
  const setX = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, f: { ...r.f, extra: { ...r.f.extra, [k]: v } } } : r)))
  // Hotel: setiap perubahan hotel/kamar/tanggal memilih ulang periode (jadwal) secara otomatis; baris lama tanpa pilihan dibiarkan apa adanya.
  const setHotel = (i: number, patch: { hotel?: string; room?: string; start?: string; end?: string }) => onChange(rows.map((r, j) => {
    if (j !== i) return r
    const cur = hotelSel(r, catalog)
    const hotel = patch.hotel ?? cur.hotel, room = patch.room ?? cur.room
    const start = patch.start ?? r.f.start, end = patch.end ?? r.f.end
    const res = resolveHotelSchedule(catalog.hotel ?? [], hotel, room, start, end)
    const pick = res.ok ? res.schedule.id : hotel || room ? '' : r.f.pick
    return { ...r, f: { ...r.f, start, end, pick, extra: { ...r.f.extra, hotel, room } } }
  }))

  const optionsFor = (row: ItemRow) => {
    const base = (() => {
      switch (row.module) {
        case 'flight': return (catalog.flight ?? []).map(o => ({ id: o.id, label: o.label, hint: `${fmt(o.from)} – ${fmt(o.to)} · sisa ${o.seatsLeft} · ${formatRupiah(o.price)}` }))
        case 'transport': return (catalog.transport ?? []).map(o => ({ id: o.id, label: `${fmt(o.date)} — ${o.tripName}`, hint: `${o.vehicle} · sisa ${o.seatsLeft} kursi · ${formatRupiah(o.price)}` }))
        case 'muthowif': return [{ id: 'muthowif', label: 'Layanan Muthowif', hint: `${formatRupiah(catalog.muthowif?.pricePerPersonDay ?? 0)}/orang/hari` }]
        case 'catering': return (catalog.catering ?? []).map(o => ({ id: o.id, label: o.name, hint: o.prices ? `${formatRupiah(o.prices.regular)}/orang/hari (reguler)` : '' }))
        case 'tourPackage': return (catalog.tourPackage ?? []).map(o => ({ id: o.id, label: o.name, hint: formatRupiah(o.price) }))
        case 'package': return (catalog.package ?? []).map(o => ({ id: o.id, label: o.name, hint: `${formatRupiah(o.pricePerPerson)}/orang (dasar)` }))
        default: return []
      }
    })()
    // Produk lama yang tak lagi ada di katalog (nonaktif / periode lewat) tetap tampil dengan labelnya — bukan kosong.
    return row.f.pick && !base.some(o => o.id === row.f.pick) ? [{ id: row.f.pick, label: row.label ?? 'Produk (tidak tersedia di katalog)', hint: '' }, ...base] : base
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="m-0 text-sm text-admin-muted">Belum ada produk. Visa dipasang per jamaah di kotak Jamaah.</p>}
      {rows.length > 0 && (
        <div aria-hidden className={`hidden gap-x-3 px-2.5 text-[11px] font-medium uppercase tracking-wide text-admin-muted xl:grid ${GRID}`}>
          <span>Produk</span><span>Tanggal</span><span>Jumlah</span><span className="text-right">Harga jual</span><span className="text-right">Subtotal</span><span />
        </div>
      )}
      {rows.map((row, i) => {
        const { f } = row
        const check = rowToItem(row, catalog)
        const flight = row.module === 'flight' ? catalog.flight?.find(x => x.id === f.pick) : undefined
        const hotel = row.module === 'hotel' ? catalog.hotel?.find(x => x.id === f.pick) : undefined
        const transport = row.module === 'transport' ? catalog.transport?.find(x => x.id === f.pick) : undefined
        const tour = row.module === 'tourPackage' ? catalog.tourPackage?.find(x => x.id === f.pick) : undefined
        const pkg = row.module === 'package' ? catalog.package?.find(x => x.id === f.pick) : undefined
        const tourQuotas = tour && f.start ? (catalog.transport ?? []).filter(q => q.date === f.start && tour.vehicleOptions.some(v => v.pricingId === q.pricingId)) : []
        const date = (label: string, key: 'start' | 'end', min?: string, max?: string) => (
          <label className="flex items-center gap-2"><span className="w-14 shrink-0 whitespace-nowrap text-[11px] text-admin-muted">{label}</span><input type="date" className="admin-inp-xs min-w-0 flex-1" aria-label={`${label} baris ${i + 1}`} min={min} max={max} value={f[key]} onChange={e => (row.module === 'hotel' ? setHotel(i, { [key]: e.target.value }) : setF(i, { [key]: e.target.value }))} /></label>
        )
        const hsel = row.module === 'hotel' ? hotelSel(row, catalog) : null
        const legacyHotel = row.module === 'hotel' && hotelLegacy(row, catalog)
        const count = (label: string, key: 'people' | 'rooms') => (
          <Field label={label}><input type="number" min={1} className="admin-inp-xs" aria-label={`${label} baris ${i + 1}`} value={f[key]} onChange={e => setF(i, { [key]: e.target.value })} /></Field>
        )
        const total = totals?.[i]
        const unit = unitPrice(row, catalog)
        const serverError = rowError?.index === i ? rowError.message : null
        const nights = span(f.start, f.end)
        const days = f.start && f.end ? span(f.start, f.end) + 1 : 0
        return (
          <div key={row.key} className={`rounded-lg border bg-white p-2.5 ${serverError ? 'border-admin-danger' : 'border-admin-line'}`}>
            <div className={`grid grid-cols-2 gap-x-3 gap-y-2 xl:items-start ${GRID}`}>
              {/* 1. Produk: jenis + produk */}
              <div className="col-span-2 space-y-1.5 xl:col-span-1">
                <ChoiceSelect size="sm" ariaLabel={`Jenis produk baris ${i + 1}`} value={row.module} clearable={false} disabled={!!row.ref} placeholder="— pilih jenis —"
                  options={ROW_MODULES.map(m => ({ id: m, label: MODULE_LABEL[m] }))} onChange={v => set(i, { module: v as ModuleKey, f: empty(defaultPeople), label: undefined })} />
                {hsel ? <>
                  <ChoiceSelect size="sm" ariaLabel={`Hotel baris ${i + 1}`} value={hsel.hotel} clearable={false}
                    options={hotelsOf(catalog.hotel ?? []).map(h => ({ id: h.id, label: h.name, hint: [h.city, h.stars ? `bintang ${h.stars}` : ''].filter(Boolean).join(' · ') }))}
                    placeholder={!catalog.hotel ? 'Memuat…' : legacyHotel ? (row.label ?? 'Hotel (tidak tersedia di katalog)') : catalog.hotel.length ? '— pilih hotel —' : 'Belum ada hotel berharga'}
                    onChange={v => setHotel(i, { hotel: v, room: '' })} />
                  <ChoiceSelect size="sm" ariaLabel={`Tipe kamar baris ${i + 1}`} value={hsel.room} clearable={false} disabled={!hsel.hotel}
                    options={roomsOf(catalog.hotel ?? [], hsel.hotel).map(r => ({ id: r.id, label: r.name, hint: `isi ${r.capacity} · ${r.minPrice === r.maxPrice ? formatRupiah(r.minPrice) : `${formatRupiah(r.minPrice)} – ${formatRupiah(r.maxPrice)}`}/malam` }))}
                    placeholder={hsel.hotel ? '— pilih tipe kamar —' : 'Pilih hotel dulu'} onChange={v => setHotel(i, { room: v })} />
                </> : (
                  <ChoiceSelect size="sm" ariaLabel={`Produk baris ${i + 1}`} value={f.pick} disabled={!row.module} options={optionsFor(row)}
                    placeholder={row.module ? (optionsFor(row).length ? '— pilih produk —' : 'Memuat / belum ada produk') : 'Pilih jenis dulu'} onChange={v => setF(i, { pick: v })} />
                )}
              </div>

              {/* 2. Tanggal: menyesuaikan jenis produk */}
              <div className="col-span-2 space-y-1.5 xl:col-span-1">
                {row.module === 'flight' && date('Berangkat', 'start', flight?.from, flight?.to)}
                {row.module === 'hotel' && <>
                  {date('Check-in', 'start')}{date('Check-out', 'end', f.start || undefined)}
                  <p className="m-0 text-[11px] text-admin-muted">
                    {nights > 0 && <>{nights} malam</>}{nights > 0 && hotel && ' · '}{hotel && <>periode harga {fmt(hotel.from)} – {fmt(hotel.to)} (otomatis)</>}
                  </p>
                </>}
                {(row.module === 'muthowif' || row.module === 'catering') && <>
                  {date('Mulai', 'start')}{date('Selesai', 'end', f.start)}
                  {days > 0 && <p className="m-0 text-[11px] text-admin-muted">{days} hari</p>}
                </>}
                {row.module === 'tourPackage' && date('Tanggal tur', 'start')}
                {row.module === 'package' && date('Berangkat', 'start')}
                {row.module === 'transport' && <p className="m-0 flex items-center gap-2 py-1 text-sm"><span className="w-14 shrink-0 whitespace-nowrap text-[11px] text-admin-muted">Tanggal</span>{transport ? fmt(transport.date) : '—'}</p>}
              </div>

              {/* 3. Jumlah */}
              <div className="space-y-1.5">
                {row.module === 'hotel' ? count('Kamar', 'rooms')
                  : row.module === 'flight' || row.module === 'transport' ? count('Penumpang', 'people')
                  : row.module ? count('Orang', 'people') : null}
              </div>

              {/* 4. Harga satuan (katalog, harga jual) */}
              <div className="text-right">
                <span className="block text-[11px] text-admin-muted xl:hidden">Harga jual</span>
                {unit ? <>
                  <span className="block text-sm tabular-nums text-admin-ink">{formatRupiah(unit.amount)}</span>
                  <span className="block text-[11px] text-admin-muted">{unit.unit}</span>
                </> : <span className="block text-sm text-admin-muted">—</span>}
              </div>

              {/* 5. Subtotal (server) */}
              <div className="text-right">
                <span className="block text-[11px] text-admin-muted xl:hidden">Subtotal</span>
                <span className="block text-sm font-semibold tabular-nums text-admin-ink">
                  {'error' in check || serverError ? '—' : computing && total === undefined ? <Loader2 className="ml-auto size-3.5 animate-spin" /> : total !== undefined ? formatRupiah(total) : '—'}
                </span>
              </div>
              <div className="flex justify-end">
                <button type="button" aria-label={`Hapus baris ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded p-1 text-admin-muted hover:text-admin-danger"><Trash2 className="size-4" /></button>
              </div>
            </div>

            {/* Baris kedua: pilihan per jenis (jika ada) */}
            {(row.module === 'transport' || tour?.transportMode === 'user_choice' || tour?.hotelMode === 'user_choice' || (pkg && Object.values(pkg.modes).includes('user_choice')) || customPrice) && (
              <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-admin-line pt-2">
                {row.module === 'transport' && <>
                  <Field label="Detail penjemputan" className="min-w-40 flex-1"><input className="admin-inp-xs" maxLength={300} value={f.extra.pickup ?? ''} onChange={e => setX(i, 'pickup', e.target.value)} /></Field>
                  <Field label="Detail pengantaran" className="min-w-40 flex-1"><input className="admin-inp-xs" maxLength={300} value={f.extra.dropoff ?? ''} onChange={e => setX(i, 'dropoff', e.target.value)} /></Field>
                </>}
                {tour?.transportMode === 'user_choice' && (
                  <Field label="Kendaraan (tanggal tur)" className="min-w-48 flex-1">
                    <ChoiceSelect size="sm" ariaLabel={`Kendaraan baris ${i + 1}`} value={f.extra.quota ?? ''} onChange={v => setX(i, 'quota', v)}
                      options={tourQuotas.map(q => ({ id: q.id, label: q.vehicle, hint: `sisa ${q.seatsLeft} kursi · ${formatRupiah(q.price)}` }))}
                      placeholder={f.start ? (tourQuotas.length ? '— pilih kendaraan —' : 'Tak ada kendaraan di tanggal ini') : 'Isi tanggal tur dulu'} />
                  </Field>
                )}
                {tour?.hotelMode === 'user_choice' && <>
                  <Field label="Hotel pilihan (opsional)" className="min-w-48 flex-1"><ChoiceSelect size="sm" ariaLabel={`Hotel pilihan baris ${i + 1}`} value={f.extra.hotel ?? ''} onChange={v => setX(i, 'hotel', v)} options={tour.hotelOptions.map(h => ({ id: h.id, label: h.name }))} placeholder="— tanpa hotel —" /></Field>
                  <Field label="Kamar" className="w-20"><input type="number" min={1} className="admin-inp-xs" value={f.rooms} onChange={e => setF(i, { rooms: e.target.value })} /></Field>
                </>}
                {pkg && (['hotelMakkah', 'hotelMadinah', 'flight', 'visa', 'transport', 'catering'] as const).filter(k => pkg.modes[k] === 'user_choice').map(k => (
                  <Field key={k} label={`Pilihan ${({ hotelMakkah: 'Hotel Makkah', hotelMadinah: 'Hotel Madinah', flight: 'Tiket', visa: 'Visa', transport: 'Kendaraan', catering: 'Katering' })[k]}`} className="min-w-44 flex-1">
                    <ChoiceSelect size="sm" ariaLabel={`Pilihan ${k} baris ${i + 1}`} value={f.extra[k] ?? ''} onChange={v => setX(i, k, v)} placeholder="— tidak dipilih —"
                      options={pkg.options[k].map(o => ({ id: o.id, label: o.name, hint: o.perPerson != null ? `${formatRupiah(o.perPerson)}/orang` : o.price != null ? formatRupiah(o.price) : '' }))} />
                  </Field>
                ))}
                {customPrice && <>
                  <Field label="Harga khusus (opsional)" className="w-40"><input type="number" min={1} className="admin-inp-xs" aria-label={`Harga khusus baris ${i + 1}`} value={row.customSellIdr ?? ''} onChange={e => set(i, { customSellIdr: Number(e.target.value) > 0 ? Number(e.target.value) : null })} /></Field>
                  {row.customSellIdr != null && <Field label="Catatan harga khusus (wajib bila diubah)" className="min-w-48 flex-1"><input className="admin-inp-xs" aria-label={`Catatan harga khusus baris ${i + 1}`} maxLength={300} value={row.priceNote ?? ''} onChange={e => set(i, { priceNote: e.target.value })} /></Field>}
                </>}
              </div>
            )}
            {'error' in check && row.module && <p className="m-0 mt-1.5 text-[11px] text-admin-warning">{check.error}</p>}
            {serverError && !('error' in check) && <p role="alert" className="m-0 mt-1.5 text-xs font-medium text-admin-danger">{serverError}</p>}
          </div>
        )
      })}
      <Button size="sm" variant="outline" onClick={() => onChange([...rows, newRow(defaultPeople)])}><Plus className="size-4" /> Tambah baris</Button>
    </div>
  )
}
