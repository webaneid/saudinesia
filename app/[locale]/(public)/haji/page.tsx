import { ProductImage } from '@/components/shared/ProductImage'
import { getFeaturedCards } from '@/lib/media/urls'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { Star, Calendar, Users, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/utils'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { hajiAvailable, hajiPriced } from '@/lib/haji/catalog'
import { sellPrices } from '@/lib/pricing/engine/read'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'

type Props = { params: Promise<{ locale: string }> }

const HAJI_TYPE_LABEL: Record<string, string> = {
  furoda:  'Furoda (Musyarifah)',
  khusus:  'Haji Khusus',
  reguler: 'Haji Reguler',
  plus:    'Haji Plus',
}

const HAJI_TYPE_COLOR: Record<string, string> = {
  furoda:  'bg-amber-100 text-amber-800',
  khusus:  'bg-blue-100 text-blue-800',
  reguler: 'bg-green-100 text-green-800',
  plus:    'bg-purple-100 text-purple-800',
}

export default async function HajiCatalogPage({ params }: Props) {
  const { locale } = await params
  const products = await prisma.hajiProduct.findMany({
    where: { isActive: true },
    orderBy: [{ hajiType: 'asc' }, { year: 'asc' }],
  })

  const covers = await getFeaturedCards('haji', products.map(p => p.id))
  const prices = await sellPrices('haji', products.map(p => p.id))

  const byType = products.reduce<Record<string, typeof products>>((acc, p) => {
    (acc[p.hajiType] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Star className="h-8 w-8 text-amber-500 fill-amber-500" />
          Paket Ibadah Haji
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Saudinesia menyediakan berbagai paket haji sesuai kebutuhan — dari Haji Furoda tanpa antrean
          hingga Haji Reguler. Semua diurus lengkap dengan akomodasi, transportasi, dan pendampingan.
        </p>
      </div>

      {products.length === 0 && (
        <div className="rounded-xl border border-dashed p-16 text-center text-muted-foreground">
          <Star className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Paket haji akan segera tersedia.</p>
        </div>
      )}

      {Object.entries(byType).map(([type, items]) => (
        <div key={type} className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">{HAJI_TYPE_LABEL[type] ?? type}</h2>
            <div className={`text-xs font-semibold px-3 py-1 rounded-full ${HAJI_TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-700'}`}>
              {items.length} paket
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(p => {
              const sisa = hajiAvailable(p)
              const includes = p.includes as string[]
              return (
                <div key={p.id} className="overflow-hidden rounded-xl border bg-card hover:border-primary hover:shadow-sm transition-all">
                  <ProductImage src={covers.get(p.id)?.src} alt={covers.get(p.id)?.alt} fallbackAlt={p.name} type="haji" />
                  <div className="p-5 space-y-4">
                  <div className="space-y-1">
                    <p className="font-semibold leading-tight">{p.name}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${HAJI_TYPE_COLOR[p.hajiType] ?? 'bg-gray-100'}`}>
                        {HAJI_TYPE_LABEL[p.hajiType]}
                      </span>
                      <span className="text-xs text-muted-foreground">Tahun {p.year}</span>
                    </div>
                  </div>

                  <RichTextView value={p.description} className="text-muted-foreground" />

                  {p.departureDate && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatCalendarDate(p.departureDate, DATE_LONG)}
                      {p.durationDays && <span>· {p.durationDays} hari</span>}
                    </div>
                  )}

                  {includes.length > 0 && (
                    <ul className="space-y-1">
                      {includes.slice(0, 4).map((item, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <span className="text-green-500 mt-0.5">✓</span> {item}
                        </li>
                      ))}
                      {includes.length > 4 && (
                        <li className="text-xs text-muted-foreground">+{includes.length - 4} lainnya...</li>
                      )}
                    </ul>
                  )}

                  <div className="pt-2 border-t space-y-3">
                    <div>
                      {hajiPriced(prices.get(p.id) ?? 0) ? (
                        <>
                          <p className="text-xs text-muted-foreground">Mulai dari</p>
                          <p className="text-xl font-bold text-primary">
                            {formatRupiah(prices.get(p.id) ?? 0)}
                            <span className="text-xs font-normal text-muted-foreground"> /orang</span>
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-medium text-muted-foreground">Harga belum ditetapkan</p>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span className={sisa < 10 ? 'text-red-500 font-medium' : ''}>
                          {sisa} kursi tersedia
                        </span>
                      </div>
                      <Button asChild size="sm">
                        <Link href={`/${locale}/register`}>
                          Daftar <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
