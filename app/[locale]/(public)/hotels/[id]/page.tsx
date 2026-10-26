import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { getProductImages } from '@/lib/media/urls'
import { MapPin, Star, ArrowLeft, BedDouble, CheckCircle, Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRupiah, formatDistance } from '@/lib/utils'
import { HOTEL_FACILITIES } from '@/lib/constants/hotelFacilities'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'

type Props = { params: Promise<{ locale: string; id: string }> }

function formatShortDate(d: Date) {
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function HotelDetailPage({ params }: Props) {
  const { locale, id } = await params

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
    },
  })
  if (!hotelRaw) notFound()
  const hotel = hotelRaw

  // Kolom tabel = union semua tipe kamar yang pernah dipakai di hotel ini, diurutkan kapasitas.
  const roomTypeMap = new Map<string, { id: string; name: string; defaultCapacity: number }>()
  for (const period of hotel.pricePeriods) {
    for (const s of period.schedules) roomTypeMap.set(s.roomTypeId, s.roomType)
  }
  const roomTypeColumns = [...roomTypeMap.values()].sort((a, b) => a.defaultCapacity - b.defaultCapacity)

  const facilityLabels = (Array.isArray(hotel.facilities) ? hotel.facilities as string[] : [])
    .map(code => HOTEL_FACILITIES.find(f => f.code === code)?.label ?? code)

  // Foto hotel dari layanan media universal: sampul dulu, lalu galeri berurutan (URL presigned 1 jam).
  const imageUrls = ((await getProductImages('hotel', [hotel.id])).get(hotel.id)?.images ?? []).map(i => i.url)

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <Link href={`/${locale}/hotels`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke daftar hotel
        </Link>
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{hotel.name}</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant={hotel.city === 'makkah' ? 'default' : 'secondary'} className="capitalize">{hotel.city}</Badge>
              <span className="flex items-center gap-1">
                {Array.from({ length: hotel.stars ?? 0 }).map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                ))}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {formatDistance(hotel.distanceToHaramM ?? 0)} dari Masjid Al-Haram
              </span>
            </div>
          </div>
          <Button asChild>
            <Link href={`/${locale}/register`}>Pesan Sekarang</Link>
          </Button>
        </div>
      </div>

      {/* Photo gallery */}
      {imageUrls.length > 0 ? (
        <div className={`grid gap-2 rounded-2xl overflow-hidden ${imageUrls.length === 1 ? 'grid-cols-1' : imageUrls.length === 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
          {imageUrls.length === 1 && (
            <div className="relative h-80">
              <Image src={imageUrls[0]!} alt={`${hotel.name} foto 1`} fill className="object-cover" unoptimized />
            </div>
          )}
          {imageUrls.length === 2 && imageUrls.map((url, i) => (
            <div key={i} className="relative h-72">
              <Image src={url} alt={`${hotel.name} foto ${i + 1}`} fill className="object-cover" unoptimized />
            </div>
          ))}
          {imageUrls.length >= 3 && (
            <>
              {/* Large left */}
              <div className="relative h-80 row-span-2">
                <Image src={imageUrls[0]!} alt={`${hotel.name} foto 1`} fill className="object-cover" unoptimized />
              </div>
              {/* Right column: 2 smaller */}
              <div className="grid grid-rows-2 gap-2 h-80">
                {imageUrls.slice(1, 3).map((url, i) => (
                  <div key={i} className="relative">
                    <Image src={url} alt={`${hotel.name} foto ${i + 2}`} fill className="object-cover" unoptimized />
                    {/* "+N more" overlay on last visible cell if more exist */}
                    {i === 1 && imageUrls.length > 3 && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white font-semibold text-lg">+{imageUrls.length - 3} foto</span>
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
          <h2 className="font-semibold mb-2">Tentang Hotel</h2>
          <RichTextView value={hotel.description} className="text-muted-foreground" />
        </div>
      )}

      {/* Facilities */}
      {facilityLabels.length > 0 && (
        <div className="rounded-xl border p-5">
          <h2 className="font-semibold mb-3">Fasilitas</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {facilityLabels.map((label) => (
              <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rate sheet — periode × tipe kamar, docs/arsitektur-hotel.md §11 */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Harga per Periode</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Harga per malam, per kamar. Pilih tanggal yang sesuai saat memesan.</p>
        </div>

        {hotel.pricePeriods.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada periode harga untuk hotel ini.</p>
        )}

        {hotel.pricePeriods.length > 0 && (
          <>
            {/* Desktop: tabel */}
            <div className="hidden md:block rounded-xl border overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dari</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sampai</th>
                    {roomTypeColumns.map(rt => (
                      <th key={rt.id} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">
                        {rt.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {hotel.pricePeriods.map(period => {
                    const priceByRoomType = new Map(period.schedules.map(s => [s.roomTypeId, s]))
                    return (
                      <tr key={period.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-foreground">{formatShortDate(period.periodStart)}</td>
                        <td className="px-4 py-3 text-foreground">{formatShortDate(period.periodEnd)}</td>
                        {roomTypeColumns.map(rt => {
                          const s = priceByRoomType.get(rt.id)
                          const available = s ? s.totalQuota - s.pendingQuota - s.bookedQuota : 0
                          return (
                            <td key={rt.id} className="px-4 py-3 text-right">
                              {s ? (
                                <span className={available > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground line-through'}>
                                  {formatRupiah(Number(s.price))}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: card per periode */}
            <div className="md:hidden space-y-3">
              {hotel.pricePeriods.map(period => {
                const priceByRoomType = new Map(period.schedules.map(s => [s.roomTypeId, s]))
                return (
                  <div key={period.id} className="rounded-xl border p-4 space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <BedDouble className="h-4 w-4 text-muted-foreground shrink-0" />
                      {formatShortDate(period.periodStart)} – {formatShortDate(period.periodEnd)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                      {roomTypeColumns.map(rt => {
                        const s = priceByRoomType.get(rt.id)
                        const available = s ? s.totalQuota - s.pendingQuota - s.bookedQuota : 0
                        return (
                          <div key={rt.id} className="text-xs">
                            <p className="text-muted-foreground">{rt.name}</p>
                            {s ? (
                              <p className={available > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground line-through'}>
                                {formatRupiah(Number(s.price))}
                              </p>
                            ) : (
                              <p className="text-muted-foreground">—</p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Services */}
      {hotel.services.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Layanan Hotel</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {hotel.services.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm">{s.serviceName}</span>
                </div>
                <span className="text-sm font-semibold">{formatRupiah(Number(s.price))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
