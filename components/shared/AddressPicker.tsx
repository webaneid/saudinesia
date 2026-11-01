'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { AutocompleteSelect, type AutocompleteOption } from './AutocompleteSelect'
import { COUNTRY_OPTIONS } from '@/lib/ui/countryOptions'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ExternalLink, MapPin, Search } from 'lucide-react'
import { mapsSearchUrl, parseMapsUrl } from '@/lib/address/maps'

export type AddressValue = {
  type: 'domestic' | 'international'
  fullAddress: string
  postalCode: string
  provinceId: string | null
  regencyId: string | null
  districtId: string | null
  villageId: string | null
  countryCode: string | null
  city: string
  stateRegion: string
  /** Tautan Google Maps (hanya dipakai bila `withMap`) — '' = kosong. */
  mapsUrl?: string
}

export const EMPTY_ADDRESS: AddressValue = {
  type: 'domestic', fullAddress: '', postalCode: '',
  provinceId: null, regencyId: null, districtId: null, villageId: null,
  countryCode: null, city: '', stateRegion: '',
}

type WilayahRow = { id: string; name: string }


type Props = {
  value: AddressValue
  onChange: (value: AddressValue) => void
  /** Tampilkan "Lokasi Google Maps" opsional (docs/arsitektur-hotel.md §12.5) — hanya untuk alamat yang lokasinya publik (hotel), bukan rumah jamaah. */
  withMap?: boolean
  /** Kata kunci tombol "Cari di Google Maps" (mis. nama hotel + kota); bawaan = alamat lengkap. */
  mapsQuery?: string
}

// Komponen alamat reusable — 2 tab (Indonesia/Luar Negeri), combobox berjenjang untuk wilayah
// resmi. docs/arsitektur-alamat.md §3.1-§3.2. Murni controlled form (tidak memanggil POST/PUT
// /api/v1/address sendiri) — form pemanggil yang memutuskan kapan menyimpan.
export function AddressPicker({ value, onChange, withMap = false, mapsQuery }: Props) {
  const [provinces, setProvinces] = useState<AutocompleteOption[]>([])
  const [regencies, setRegencies] = useState<AutocompleteOption[]>([])
  const [districts, setDistricts] = useState<AutocompleteOption[]>([])
  const [villages, setVillages] = useState<AutocompleteOption[]>([])
  const [villagesLoading, setVillagesLoading] = useState(false)
  const villageSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/v1/address/wilayah/provinces')
      .then(r => r.json())
      .then(j => setProvinces((j.data as WilayahRow[] ?? []).map(p => ({ id: p.id, label: p.name }))))
  }, [])

  useEffect(() => {
    if (!value.provinceId) { setRegencies([]); return }
    fetch(`/api/v1/address/wilayah/regencies?provinceId=${value.provinceId}`)
      .then(r => r.json())
      .then(j => setRegencies((j.data as WilayahRow[] ?? []).map(r => ({ id: r.id, label: r.name }))))
  }, [value.provinceId])

  useEffect(() => {
    if (!value.regencyId) { setDistricts([]); return }
    fetch(`/api/v1/address/wilayah/districts?regencyId=${value.regencyId}`)
      .then(r => r.json())
      .then(j => setDistricts((j.data as WilayahRow[] ?? []).map(d => ({ id: d.id, label: d.name }))))
  }, [value.regencyId])

  const loadVillages = useCallback((districtId: string, q?: string) => {
    setVillagesLoading(true)
    const params = new URLSearchParams({ districtId, ...(q ? { q } : {}) })
    fetch(`/api/v1/address/wilayah/villages?${params}`)
      .then(r => r.json())
      .then(j => setVillages((j.data as WilayahRow[] ?? []).map(v => ({ id: v.id, label: v.name }))))
      .finally(() => setVillagesLoading(false))
  }, [])

  useEffect(() => {
    if (!value.districtId) { setVillages([]); return }
    loadVillages(value.districtId)
  }, [value.districtId, loadVillages])

  // Kecamatan tertentu bisa punya banyak desa (endpoint dibatasi 200 baris + dukung `q`) —
  // pencarian didorong ke server, bukan filter lokal (docs/arsitektur-alamat.md, pola
  // AutocompleteSelect `onSearch`, komponen reusable ke mana pun butuh mode ini).
  function handleVillageSearch(q: string) {
    if (!value.districtId) return
    if (villageSearchTimer.current) clearTimeout(villageSearchTimer.current)
    villageSearchTimer.current = setTimeout(() => loadVillages(value.districtId!, q), 300)
  }

  function set(patch: Partial<AddressValue>) {
    onChange({ ...value, ...patch })
  }

  function switchTab(type: 'domestic' | 'international') {
    onChange({ ...EMPTY_ADDRESS, type, fullAddress: value.fullAddress, postalCode: value.postalCode, ...(withMap ? { mapsUrl: value.mapsUrl ?? '' } : {}) })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => switchTab('domestic')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            value.type === 'domestic' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:bg-accent'
          }`}
        >
          Alamat Indonesia
        </button>
        <button
          type="button"
          onClick={() => switchTab('international')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            value.type === 'international' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:bg-accent'
          }`}
        >
          Alamat Luar Negeri
        </button>
      </div>

      {value.type === 'domestic' ? (
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Provinsi</p>
            <AutocompleteSelect options={provinces} value={value.provinceId} placeholder="Pilih provinsi"
              onChange={id => set({ provinceId: id, regencyId: null, districtId: null, villageId: null })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Kabupaten/Kota</p>
            <AutocompleteSelect options={regencies} value={value.regencyId} placeholder="Pilih kab/kota" disabled={!value.provinceId}
              onChange={id => set({ regencyId: id, districtId: null, villageId: null })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Kecamatan</p>
            <AutocompleteSelect options={districts} value={value.districtId} placeholder="Pilih kecamatan" disabled={!value.regencyId}
              onChange={id => set({ districtId: id, villageId: null })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Desa/Kelurahan</p>
            <AutocompleteSelect options={villages} value={value.villageId} placeholder="Pilih desa/kelurahan" disabled={!value.districtId}
              loading={villagesLoading} onSearch={handleVillageSearch}
              onChange={id => set({ villageId: id })} />
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Negara</p>
            <AutocompleteSelect options={COUNTRY_OPTIONS} value={value.countryCode} placeholder="Pilih negara"
              onChange={code => set({ countryCode: code })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Kota</p>
            <Input value={value.city} onChange={e => set({ city: e.target.value })} placeholder="Nama kota" />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground mb-1">State/Province/Region</p>
            <Input value={value.stateRegion} onChange={e => set({ stateRegion: e.target.value })} placeholder="Opsional" />
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-1">Alamat Lengkap</p>
        <Textarea rows={2} value={value.fullAddress} onChange={e => set({ fullAddress: e.target.value })}
          placeholder="Nama jalan, nomor rumah, RT/RW, patokan" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Kode Pos</p>
        <Input className="w-40" value={value.postalCode} onChange={e => set({ postalCode: e.target.value })} />
      </div>
      {withMap && <MapsField url={value.mapsUrl ?? ''} query={(mapsQuery ?? '').trim() || value.fullAddress} onChange={mapsUrl => set({ mapsUrl })} />}
    </div>
  )
}

// Lokasi Google Maps TANPA API key: cari lewat Maps URLs publik di tab baru → salin tautan "Bagikan" → tempel. Validasi yang sama dengan server (lib/address/maps.ts).
function MapsField({ url, query, onChange }: { url: string; query: string; onChange: (url: string) => void }) {
  const parsed = url.trim() ? parseMapsUrl(url) : null
  return (
    <div className="space-y-1.5 rounded-md border border-input p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><MapPin className="h-3.5 w-3.5" /> Lokasi Google Maps <span className="font-normal text-muted-foreground">(opsional)</span></p>
      <p className="text-xs text-muted-foreground">Cari tempatnya di Google Maps, tekan &quot;Bagikan&quot; lalu &quot;Salin link&quot;, dan tempel tautannya di sini.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-0 flex-1 basis-64" inputMode="url" aria-label="Tautan Google Maps" placeholder="https://maps.app.goo.gl/…" value={url} onChange={e => onChange(e.target.value)} />
        <a href={mapsSearchUrl(query)} target="_blank" rel="noopener noreferrer" aria-disabled={!query.trim()}
          className={`inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-xs font-medium hover:bg-accent ${query.trim() ? '' : 'pointer-events-none opacity-50'}`}>
          <Search className="h-3.5 w-3.5" /> Cari di Google Maps
        </a>
      </div>
      {parsed && !parsed.ok && <p role="alert" className="text-xs text-destructive">{parsed.message}</p>}
      {parsed?.ok && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <a href={parsed.value.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> Buka tautan
          </a>
          {parsed.value.latitude !== null && <span>Koordinat {parsed.value.latitude}, {parsed.value.longitude}</span>}
        </p>
      )}
    </div>
  )
}
