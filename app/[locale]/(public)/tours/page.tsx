import { prisma } from '@/lib/db'
import { getPresignedUrl } from '@/lib/storage/minio'
import { MapPin } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import Link from 'next/link'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'

type Props = { params: Promise<{ locale: string }> }

export default async function ToursPage({ params }: Props) {
  const { locale } = await params
  const packages = await prisma.tourPackage.findMany({
    where: { isActive: true },
    include: {
      transportTrip: { select: { origin: true, destination: true } },
      sites: { include: { tourismSite: true }, orderBy: { order: 'asc' } },
    },
    orderBy: { price: 'asc' },
  })

  const cityLabel: Record<string, string> = { makkah: 'Makkah', madinah: 'Madinah', jeddah: 'Jeddah' }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Paket Wisata Ziarah</h1>
        <p className="text-muted-foreground mt-1">Kunjungi situs bersejarah Islam bersama kendaraan &amp; rute yang sudah diatur</p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {await Promise.all(packages.map(async (p) => {
          const sitesWithPhoto = await Promise.all(p.sites.map(async (s) => ({
            ...s.tourismSite,
            photoUrl: s.tourismSite.photoKey ? await getPresignedUrl(s.tourismSite.photoKey, 3600).catch(() => null) : null,
          })))

          return (
            <div key={p.id} className="rounded-xl border p-5 space-y-4">
              <h3 className="font-semibold">{p.name}</h3>
              <RichTextView value={p.description} className="text-muted-foreground" />

              {p.transportMode === 'user_choice' && p.transportTrip && (
                <div className="flex items-center gap-1.5 text-xs text-teal-700 bg-teal-50 rounded px-2 py-1 w-fit">
                  <MapPin className="h-3.5 w-3.5" />
                  {p.transportTrip.origin} → {p.transportTrip.destination}
                </div>
              )}

              {sitesWithPhoto.length > 0 && (
                <div className="space-y-1.5">
                  {sitesWithPhoto.map(s => (
                    <div key={s.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      {s.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.photoUrl} alt={s.name} className="h-8 w-8 rounded object-cover shrink-0" />
                      )}
                      <span>{s.name}{s.city ? ` — ${cityLabel[s.city] ?? s.city}` : ''}</span>
                      {s.gmapsUrl && (
                        <a href={s.gmapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">Peta</a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-3 border-t flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Mulai dari</p>
                  <p className="text-xl font-bold text-primary">{formatRupiah(Number(p.price))}</p>
                  {(p.transportMode === 'user_choice' || p.hotelMode === 'user_choice') && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      + {[p.transportMode === 'user_choice' && 'kendaraan', p.hotelMode === 'user_choice' && 'hotel'].filter(Boolean).join(' & ')} sesuai pilihan
                    </p>
                  )}
                </div>
                <Link href={`/${locale}/register`}
                  className="text-sm font-medium text-primary hover:underline">
                  Tambah ke paket →
                </Link>
              </div>
            </div>
          )
        }))}
      </div>
    </div>
  )
}
