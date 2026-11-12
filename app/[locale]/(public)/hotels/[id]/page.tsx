import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { routing } from '@/i18n/routing'
import { requireCatalog } from '@/lib/catalog/availability'
import { getPageText } from '@/lib/public-content/content'
import { localizedAlternates } from '@/lib/seo/site'
import { plainText } from '@/lib/rich-text/doc'
import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { getProductImages } from '@/lib/media/urls'
import { MapPin, Star, ArrowLeft, CheckCircle, Building2, ExternalLink } from 'lucide-react'
import { parseMapsUrl } from '@/lib/address/maps'
import { formatRupiah, formatDistance } from '@/lib/utils'
import { HOTEL_FACILITIES, type HotelFacilityCode } from '@/lib/constants/hotelFacilities'
import { getTranslations } from 'next-intl/server'
import { safeLocale } from '@/lib/utils/locale'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { sellPrices } from '@/lib/pricing/engine/read'
import { buildListHref, buildPageMeta, parseListParams } from '@/lib/table/pagination'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { Pagination } from '@/components/shared/data-table/Pagination'
import { DATE_SHORT_MONTH, formatCalendarDate } from '@/lib/time'
import { checkoutPath } from '@/lib/checkout/kinds'

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const RATE_PAGE_SIZE = 10

type Period = { id: string; periodStart: Date; periodEnd: Date; schedules: Array<{ roomTypeId: string; totalQuota: number; pendingQuota: number; bookedQuota: number; price: number }> }

function formatShortDate(d: Date, locale: string) {
  return formatCalendarDate(d, DATE_SHORT_MONTH, locale)
}

// Teks lewat getPageText (catalog.hotels.detail), metadata judul = nama hotel, jarak menyebut masjid kotanya (Madinah = Masjid Nabawi), warna
// token brand (bukan palet mentah/admin-*), layanan tanpa harga tak tampil "Rp 0" (audit front-end 2026-11-11, docs/arsitektur-frontend-publik.md §8).
const UUID = /^[0-9a-f-]{36}$/i

export async function generateMetadata({ params }: { params: Props['params'] }): Promise<Metadata> {
  const { locale, id } = await params
  if (!hasLocale(routing.locales, locale) || !UUID.test(id)) return {}
  const hotel = await prisma.hotel.findUnique({ where: { id, isActive: true }, select: { id: true, name: true, description: true } })
  if (!hotel) return {}
  const description = plainText(hotel.description).slice(0, 160)
  return { title: hotel.name, ...(description && { description }), alternates: localizedAlternates(locale, `hotels/${hotel.id}`) }
}

export default async function HotelDetailPage({ params, searchParams }: Props) {
  const { locale, id } = await params
  await requireCatalog('hotels')
  if (!UUID.test(id)) notFound()
  const list = parseListParams(await searchParams, RATE_PAGE_SIZE)
  const [t, tc, tf] = await Promise.all([getPageText(locale, 'hotels', 'detail'), getPageText(locale, 'hotels', 'card'), getTranslations({ locale: safeLocale(locale), namespace: 'shared.hotelFacilities' })])

  // Rate sheet — tampilkan SEMUA periode aktif (bukan cuma yang mencakup hari ini), supaya
  // pengunjung bisa lihat harga ke depan sebelum pilih tanggal, sama seperti rate sheet vendor
  // asli (docs/arsitektur-hotel.md §11 — periode × tipe kamar dalam satu tabel).
  const hotelRaw = await prisma.hotel.findUnique({
    where: { id, isActive: true },
    include: {
      pricePeriods: {
        where: { isActive: true },
        include: { schedules: { where: { isActive: true }, include: { roomType: true } } },
        orderBy: { periodStart: 'asc' },
      },
      services: { where: { isActive: true } },
      address: { select: { mapsUrl: true } }, // hanya tautan lokasi (docs/arsitektur-hotel.md §12.5)
    },
  })
  if (!hotelRaw) notFound()
  // Diperiksa ulang saat tampil (host Google Maps saja) — tautan tersimpan tak dipercaya mentah.
  const mapsLink = hotelRaw.address?.mapsUrl ? parseMapsUrl(hotelRaw.address.mapsUrl) : null
  // Harga jual per jadwal kamar dari titik harga (docs/arsitektur-harga-terpadu.md §15).
  const hotelPrices = await sellPrices('hotel', hotelRaw.pricePeriods.flatMap(p => p.schedules.map(s => s.id)))
  const servicePrices = await sellPrices('hotel_service', hotelRaw.services.map(s => s.id))
  const hotel = { ...hotelRaw, pricePeriods: hotelRaw.pricePeriods.map(p => ({ ...p, schedules: p.schedules.map(s => ({ ...s, price: hotelPrices.get(s.id) ?? 0 })) })) }

  // Kolom tabel = union semua tipe kamar yang pernah dipakai di hotel ini, diurutkan kapasitas.
  const roomTypeMap = new Map<string, { id: string; name: string; defaultCapacity: number }>()
  for (const period of hotel.pricePeriods) {
    for (const s of period.schedules) roomTypeMap.set(s.roomTypeId, s.roomType)
  }
  const roomTypeColumns = [...roomTypeMap.values()].sort((a, b) => a.defaultCapacity - b.defaultCapacity)

  const facilityLabels = (Array.isArray(hotel.facilities) ? hotel.facilities as string[] : [])
    // Kode baku → label bahasa halaman (shared.hotelFacilities; admin memakai label lib). Kode asing tak ditampilkan mentah.
    .filter((code): code is HotelFacilityCode => HOTEL_FACILITIES.some(f => f.code === code))
    .map(code => tf(code))

  // Foto hotel dari layanan media universal: sampul dulu, lalu galeri berurutan (URL presigned 1 jam).
  const imageUrls = ((await getProductImages('hotel', [hotel.id])).get(hotel.id)?.images ?? []).map(i => i.url)
  const cityText = hotel.city === 'makkah' || hotel.city === 'madinah' ? tc(`cities.${hotel.city}`) : hotel.city
  const alt = (n: number) => t('photoAlt', { name: hotel.name, number: n })
  const pricedServices = hotel.services.filter(s => (servicePrices.get(s.id) ?? 0) > 0)

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <Link href={`/${locale}/hotels`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {t('back')}
        </Link>
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-brand-dark">{hotel.name}</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-dark">{cityText}</span>
              {(hotel.stars ?? 0) > 0 && (
                <span className="flex items-center gap-1" aria-label={tc('stars', { count: hotel.stars ?? 0 })}>
                  {Array.from({ length: hotel.stars ?? 0 }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-brand-gold text-brand-gold" aria-hidden />
                  ))}
                </span>
              )}
              {hotel.distanceToHaramM !== null && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {t(hotel.city === 'madinah' ? 'distanceMadinah' : 'distanceMakkah', { distance: formatDistance(hotel.distanceToHaramM) })}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {mapsLink?.ok && (
              <a href={mapsLink.value.url} target="_blank" rel="noopener noreferrer" className="btn-brand-outline"><ExternalLink className="h-4 w-4" aria-hidden /> {t('mapsLink')}</a>
            )}
            {/* Checkout Hotel (docs/arsitektur-booking-engine-v2.md §10.6); hotel tanpa kamar berharga tak dapat dipesan (tak pernah gratis). */}
            {hotel.pricePeriods.some(p => p.schedules.some(x => x.price > 0)) && (
              <Link href={checkoutPath(locale, 'hotel', hotel.id)} className="btn-brand-solid">{t('order')}</Link>
            )}
          </div>
        </div>
      </div>

      {/* Photo gallery */}
      {imageUrls.length > 0 ? (
        <div className={`grid gap-2 rounded-2xl overflow-hidden ${imageUrls.length === 1 ? 'grid-cols-1' : imageUrls.length === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
          {imageUrls.length === 1 && (
            <div className="relative h-80">
              <Image src={imageUrls[0]!} alt={alt(1)} fill className="object-cover" unoptimized />
            </div>
          )}
          {imageUrls.length === 2 && imageUrls.map((url, i) => (
            <div key={i} className="relative h-72">
              <Image src={url} alt={alt(i + 1)} fill className="object-cover" unoptimized />
            </div>
          ))}
          {imageUrls.length >= 3 && (
            <>
              {/* Large left */}
              <div className="relative h-80 row-span-2">
                <Image src={imageUrls[0]!} alt={alt(1)} fill className="object-cover" unoptimized />
              </div>
              {/* Right column: 2 smaller */}
              <div className="grid grid-rows-2 gap-2 h-80">
                {imageUrls.slice(1, 3).map((url, i) => (
                  <div key={i} className="relative">
                    <Image src={url} alt={alt(i + 2)} fill className="object-cover" unoptimized />
                    {/* "+N more" overlay on last visible cell if more exist */}
                    {i === 1 && imageUrls.length > 3 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-brand-dark/60">
                        <span className="text-lg font-semibold text-brand-light">{t('morePhotos', { count: imageUrls.length - 3 })}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="h-56 rounded-2xl border bg-muted flex items-center justify-center">
          <Building2 className="h-12 w-12 text-muted-foreground/30" />
        </div>
      )}

      {/* Description */}
      {hotel.description && (
        <div className="rounded-xl border p-5">
          <h2 className="font-semibold mb-2">{t('about')}</h2>
          <RichTextView value={hotel.description} className="text-muted-foreground" />
        </div>
      )}

      {/* Facilities */}
      {facilityLabels.length > 0 && (
        <div className="rounded-xl border p-5">
          <h2 className="font-semibold mb-3">{t('facilities')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {facilityLabels.map((label) => (
              <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rate sheet — periode × tipe kamar, docs/arsitektur-hotel.md §11 */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">{t('ratesTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('ratesDescription')}</p>
        </div>

        {hotel.pricePeriods.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('ratesEmpty')}</p>
        )}

        {hotel.pricePeriods.length > 0 && (() => {
          // Paginasi per PERIODE (baris rate sheet); kolom = tipe kamar. Tabel bersama: di HP tiap periode menjadi kartu.
          const meta = buildPageMeta(hotel.pricePeriods.length, Math.min(list.page, Math.max(1, Math.ceil(hotel.pricePeriods.length / list.limit))), list.limit)
          const rows: Period[] = hotel.pricePeriods.slice((meta.page - 1) * meta.limit, meta.page * meta.limit)
          const columns: Column<Period>[] = [
            { key: 'period', header: t('ratesPeriod'), mobile: 'title', cell: p => <span className="whitespace-nowrap text-[13px] font-medium">{formatShortDate(p.periodStart, locale)} – {formatShortDate(p.periodEnd, locale)}</span> },
            ...roomTypeColumns.map<Column<Period>>(rt => ({
              key: `rt-${rt.id}`, header: rt.name, align: 'right',
              cell: p => {
                const s = p.schedules.find(x => x.roomTypeId === rt.id)
                const available = s ? s.totalQuota - s.pendingQuota - s.bookedQuota : 0
                return s && s.price > 0
                  ? <span className={available > 0 ? 'text-[13px] font-semibold tabular-nums' : 'text-[13px] tabular-nums text-muted-foreground line-through'}>{formatRupiah(Number(s.price))}</span>
                  : <span className="text-muted-foreground">—</span>
              },
            })),
          ]
          return (
            <DataTable
              columns={columns} rows={rows} getRowId={p => p.id}
              footer={meta.total > RATE_PAGE_SIZE || meta.page > 1 ? <Pagination {...meta} hrefFor={page => buildListHref(`/${locale}/hotels/${hotel.id}`, { page })} /> : undefined}
            />
          )
        })()}
      </div>

      {/* Services */}
      {pricedServices.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">{t('services')}</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {pricedServices.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-brand" aria-hidden />
                  <span className="text-sm">{s.serviceName}</span>
                </div>
                <span className="text-sm font-semibold">{formatRupiah(servicePrices.get(s.id) ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
