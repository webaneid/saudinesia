'use client'

import { useEffect } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { Button } from '@/components/admin/ui/Button'
import { formatRupiah } from '@/lib/utils'
import { daysBetween, formatCalendarDate, type CalendarDate } from '@/lib/time'
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
  if (!f.pick) return { error: 'Pilih produk' }
  switch (module) {
    case 'flight':
      if (!f.start) return { error: 'Isi tanggal terbang' }
      if (n < 1) return { error: 'Penumpang minimal 1' }
      return { item: { itemType: 'flight', flightScheduleId: f.pick, departureDate: f.start, numPassengers: n } }
    case 'hotel': {
      const nights = span(f.start, f.end)
      if (nights < 1) return { error: 'Check-out harus setelah check-in' }
      return { item: { itemType: 'hotel', hotelRoomScheduleId: f.pick, checkIn: f.start, checkOut: f.end, nights, numRooms: Math.max(1, num(f.rooms)) } }
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

  const optionsFor = (row: ItemRow) => {
    const base = (() => {
      switch (row.module) {
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
    // Produk lama yang tak lagi ada di katalog (nonaktif / periode lewat) tetap tampil dengan labelnya — bukan kosong.
    return row.f.pick && !base.some(o => o.id === row.f.pick) ? [{ id: row.f.pick, label: row.label ?? 'Produk (tidak tersedia di katalog)', hint: '' }, ...base] : base
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="m-0 text-sm text-admin-muted">Belum ada produk. Visa dipasang per jamaah di kotak Jamaah.</p>}
      {rows.map((row, i) => {
        const { f } = row
        const check = rowToItem(row, catalog)
        const flight = row.module === 'flight' ? catalog.flight?.find(x => x.id === f.pick) : undefined
        const hotel = row.module === 'hotel' ? catalog.hotel?.find(x => x.id === f.pick) : undefined
        const tour = row.module === 'tourPackage' ? catalog.tourPackage?.find(x => x.id === f.pick) : undefined
        const pkg = row.module === 'package' ? catalog.package?.find(x => x.id === f.pick) : undefined
        const tourQuotas = tour && f.start ? (catalog.transport ?? []).filter(q => q.date === f.start && tour.vehicleOptions.some(v => v.pricingId === q.pricingId)) : []
        const people = (label: string) => <Field label={label} className="w-24"><input type="number" min={1} className="admin-inp-xs" aria-label={`${label} baris ${i + 1}`} value={f.people} onChange={e => setF(i, { people: e.target.value })} /></Field>
        const date = (label: string, key: 'start' | 'end', min?: string, max?: string) => (
          <Field label={label} className="w-36"><input type="date" className="admin-inp-xs" aria-label={`${label} baris ${i + 1}`} min={min} max={max} value={f[key]} onChange={e => setF(i, { [key]: e.target.value })} /></Field>
        )
        const total = totals?.[i]
        const unit = unitPrice(row, catalog)
        const serverError = rowError?.index === i ? rowError.message : null
        return (
          <div key={row.key} className={`rounded-lg border bg-white p-2.5 ${serverError ? 'border-admin-danger' : 'border-admin-line'}`}>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Jenis" className="w-36">
                <ChoiceSelect size="sm" ariaLabel={`Jenis produk baris ${i + 1}`} value={row.module} clearable={false} disabled={!!row.ref} placeholder="— pilih —"
                  options={ROW_MODULES.map(m => ({ id: m, label: MODULE_LABEL[m] }))} onChange={v => set(i, { module: v as ModuleKey, f: empty(defaultPeople), label: undefined })} />
              </Field>
              <Field label="Produk" className="min-w-48 flex-1">
                <ChoiceSelect size="sm" ariaLabel={`Produk baris ${i + 1}`} value={f.pick} disabled={!row.module} options={optionsFor(row)}
                  placeholder={row.module ? (optionsFor(row).length ? '— pilih produk —' : 'Memuat / belum ada produk') : 'Pilih jenis dulu'} onChange={v => setF(i, { pick: v })} />
              </Field>
              {row.module === 'flight' && <>{date('Tanggal terbang', 'start', flight?.from, flight?.to)}{people('Penumpang')}</>}
              {row.module === 'hotel' && <>
                {date('Check-in', 'start', hotel?.from, hotel?.to)}{date('Check-out', 'end', f.start || hotel?.from, hotel?.to)}
                <Field label="Kamar" className="w-20"><input type="number" min={1} className="admin-inp-xs" aria-label={`Kamar baris ${i + 1}`} value={f.rooms} onChange={e => setF(i, { rooms: e.target.value })} /></Field>
                <span className="pb-1.5 text-[11px] text-admin-muted">
                  {span(f.start, f.end) > 0 && <>{span(f.start, f.end)} malam</>}
                  {hotel && <span className="block">periode harga {fmt(hotel.from)} – {fmt(hotel.to)}</span>}
                </span>
              </>}
              {row.module === 'transport' && people('Penumpang')}
              {(row.module === 'muthowif' || row.module === 'catering') && <>{date('Mulai', 'start')}{date('Selesai', 'end', f.start)}{people('Orang')}</>}
              {row.module === 'tourPackage' && <>{date('Tanggal tur', 'start')}{people('Orang')}</>}
              {row.module === 'package' && <>{date('Tanggal berangkat', 'start')}{people('Orang')}</>}
              <div className="ml-auto flex items-end gap-3">
                {unit && (
                  <div className="text-right">
                    <span className="block text-[11px] text-admin-muted">Harga</span>
                    <span className="block text-sm tabular-nums text-admin-ink">{formatRupiah(unit.amount)}<span className="text-[11px] text-admin-muted"> {unit.unit}</span></span>
                  </div>
                )}
                <div className="min-w-28 text-right">
                  <span className="block text-[11px] text-admin-muted">Subtotal</span>
                  <span className="block text-sm font-semibold tabular-nums text-admin-ink">
                    {'error' in check ? '—' : computing && total === undefined ? <Loader2 className="ml-auto size-3.5 animate-spin" /> : total !== undefined ? formatRupiah(total) : '—'}
                  </span>
                </div>
                <button type="button" aria-label={`Hapus baris ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded p-1.5 text-admin-muted hover:text-admin-danger"><Trash2 className="size-4" /></button>
              </div>
            </div>

            {/* Baris kedua: pilihan per jenis (jika ada) */}
            {(row.module === 'transport' || tour?.transportMode === 'user_choice' || tour?.hotelMode === 'user_choice' || pkg || customPrice) && (
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
