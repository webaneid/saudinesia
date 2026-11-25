'use client'

import { useMemo } from 'react'
import { AutocompleteSelect } from './AutocompleteSelect'
import { useWilayah } from './useWilayah'
import { PROVINCE_ALIASES } from '@/lib/address/aliases'
import { COUNTRY_OPTIONS } from '@/lib/ui/countryOptions'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ExternalLink, MapPin, RefreshCw, Search } from 'lucide-react'
import { mapsSearchUrl, parseMapsUrl } from '@/lib/address/maps'
import { useTranslations } from 'next-intl'

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

type Props = {
  value: AddressValue
  onChange: (value: AddressValue) => void
  /** Tampilkan "Lokasi Google Maps" opsional (docs/arsitektur-hotel.md §12.5) — hanya untuk alamat yang lokasinya publik (hotel), bukan rumah jamaah. */
  withMap?: boolean
  /** Kata kunci tombol "Cari di Google Maps" (mis. nama hotel + kota); bawaan = alamat lengkap. */
  mapsQuery?: string
  /** Sudah ada alamat tersimpan: mengosongkan Alamat Lengkap = menghapusnya (`addressForBody`), dan pengguna diberi tahu. */
  saved?: boolean
}

// Komponen alamat reusable — 2 tab (Indonesia/Luar Negeri), combobox berjenjang untuk wilayah
// resmi. docs/arsitektur-alamat.md §3.1-§3.2. Murni controlled form (tidak memanggil POST/PUT
// /api/v1/address sendiri) — form pemanggil yang memutuskan kapan menyimpan.
export function AddressPicker({ value, onChange, withMap = false, mapsQuery, saved = false }: Props) {
  const t = useTranslations('shared.address')
  const provinces = useWilayah('provinces')
  const regencies = useWilayah(value.provinceId ? `regencies?provinceId=${encodeURIComponent(value.provinceId)}` : null)
  const districts = useWilayah(value.regencyId ? `districts?regencyId=${encodeURIComponent(value.regencyId)}` : null)
  // Desa dicari lokal: kecamatan terbesar 108 desa (di bawah batas 200 endpoint); pencarian server membuat pilihan terpilih hilang dari daftar.
  const villages = useWilayah(value.districtId ? `villages?districtId=${encodeURIComponent(value.districtId)}` : null)
  const provinceOptions = useMemo(() => provinces.options.map(o => ({ ...o, keywords: PROVINCE_ALIASES[o.id] })), [provinces.options])
  const failed = [provinces, regencies, districts, villages].filter(l => l.status === 'failed')

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
          {t('domestic')}
        </button>
        <button
          type="button"
          onClick={() => switchTab('international')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            value.type === 'international' ? 'bg-primary border-primary text-primary-foreground' : 'border-input text-muted-foreground hover:bg-accent'
          }`}
        >
          {t('international')}
        </button>
      </div>

      {value.type === 'domestic' ? (
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('province')}</p>
            <AutocompleteSelect options={provinceOptions} loading={provinces.status === 'loading'} value={value.provinceId} placeholder={t('pickProvince')}
              onChange={id => set({ provinceId: id, regencyId: null, districtId: null, villageId: null })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('regency')}</p>
            <AutocompleteSelect options={regencies.options} loading={regencies.status === 'loading'} value={value.regencyId} placeholder={t('pickRegency')} disabled={!value.provinceId}
              onChange={id => set({ regencyId: id, districtId: null, villageId: null })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('district')}</p>
            <AutocompleteSelect options={districts.options} loading={districts.status === 'loading'} value={value.districtId} placeholder={t('pickDistrict')} disabled={!value.regencyId}
              onChange={id => set({ districtId: id, villageId: null })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('village')}</p>
            <AutocompleteSelect options={villages.options} value={value.villageId} placeholder={t('pickVillage')} disabled={!value.districtId}
              loading={villages.status === 'loading'}
              onChange={id => set({ villageId: id })} />
          </div>
          {failed.length > 0 && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive md:col-span-2">
              <span>{t('loadFailed')}</span>
              <button type="button" onClick={() => failed.forEach(l => l.retry())} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
                <RefreshCw className="h-3 w-3" aria-hidden /> {t('retry')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('country')}</p>
            <AutocompleteSelect options={COUNTRY_OPTIONS} value={value.countryCode} placeholder={t('pickCountry')}
              onChange={code => set({ countryCode: code })} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('city')}</p>
            <Input value={value.city} onChange={e => set({ city: e.target.value })} placeholder={t('cityPlaceholder')} />
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-muted-foreground mb-1">{t('region')}</p>
            <Input value={value.stateRegion} onChange={e => set({ stateRegion: e.target.value })} placeholder={t('optional')} />
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground mb-1">{t('full')}</p>
        <Textarea rows={2} value={value.fullAddress} onChange={e => set({ fullAddress: e.target.value })}
          placeholder={t('fullPlaceholder')} />
        {saved && !value.fullAddress.trim() && <p className="mt-1 text-xs text-muted-foreground">{t('cleared')}</p>}
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">{t('postal')}</p>
        <Input className="w-40" value={value.postalCode} onChange={e => set({ postalCode: e.target.value })} />
      </div>
      {withMap && <MapsField url={value.mapsUrl ?? ''} query={(mapsQuery ?? '').trim() || value.fullAddress} onChange={mapsUrl => set({ mapsUrl })} />}
    </div>
  )
}

// Lokasi Google Maps TANPA API key: cari lewat Maps URLs publik di tab baru → salin tautan "Bagikan" → tempel. Validasi yang sama dengan server (lib/address/maps.ts).
function MapsField({ url, query, onChange }: { url: string; query: string; onChange: (url: string) => void }) {
  const t = useTranslations('shared.address')
  const te = useTranslations('apiErrors')
  const parsed = url.trim() ? parseMapsUrl(url) : null
  return (
    <div className="space-y-1.5 rounded-md border border-input p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><MapPin className="h-3.5 w-3.5" /> {t('maps')} <span className="font-normal text-muted-foreground">{t('mapsOptional')}</span></p>
      <p className="text-xs text-muted-foreground">{t('mapsHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-0 flex-1 basis-64" inputMode="url" aria-label={t('mapsLink')} placeholder="https://maps.app.goo.gl/…" value={url} onChange={e => onChange(e.target.value)} />
        <a href={mapsSearchUrl(query)} target="_blank" rel="noopener noreferrer" aria-disabled={!query.trim()}
          className={`inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-xs font-medium hover:bg-accent ${query.trim() ? '' : 'pointer-events-none opacity-50'}`}>
          <Search className="h-3.5 w-3.5" /> {t('mapsSearch')}
        </a>
      </div>
      {parsed && !parsed.ok && <p role="alert" className="text-xs text-destructive">{te(parsed.code)}</p>}
      {parsed?.ok && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <a href={parsed.value.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> {t('mapsOpen')}
          </a>
          {parsed.value.latitude !== null && <span>{t('mapsCoords', { lat: String(parsed.value.latitude), lng: String(parsed.value.longitude ?? '') })}</span>}
        </p>
      )}
    </div>
  )
}
