import { ProductImage } from '@/components/shared/ProductImage'
import { getFeaturedCards } from '@/lib/media/urls'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { Package, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRupiah } from '@/lib/utils'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { withSellPrice } from '@/lib/pricing/engine/read'

type Props = { params: Promise<{ locale: string }> }

export default async function PackagesCatalogPage({ params }: Props) {
  const { locale } = await params
  const packages = await withSellPrice('package', await prisma.package.findMany({
    where: { isActive: true },
    orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
  }))
  const covers = await getFeaturedCards('package', packages.map(p => p.id))
  const hasAddOns = (p: (typeof packages)[number]) =>
    [p.hotelMakkahMode, p.hotelMadinahMode, p.transportMode, p.muthowifMode, p.visaMode, p.flightMode, p.cateringMode]
      .includes('user_choice')

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          Paket Lengkap
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Paket all-in-one yang mencakup semua kebutuhan perjalanan Anda — hotel, transport,
          muthowif, katering, dan lebih banyak lagi dalam satu harga terjangkau.
        </p>
      </div>

      {packages.length === 0 && (
        <div className="rounded-xl border border-dashed p-16 text-center text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Paket lengkap akan segera tersedia.</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {packages.map(pkg => {
          const highlights = pkg.highlights as string[]
          return (
            <div key={pkg.id} className={`overflow-hidden rounded-xl border bg-card hover:shadow-sm transition-all ${pkg.isFeatured ? 'border-primary ring-1 ring-primary' : 'hover:border-primary'}`}>
              <ProductImage src={covers.get(pkg.id)?.src} alt={covers.get(pkg.id)?.alt} fallbackAlt={pkg.name} type="package" />
              <div className="p-5 space-y-4">
              {pkg.isFeatured && (
                <Badge variant="default" className="text-xs">Pilihan Terbaik</Badge>
              )}
              <div className="space-y-1">
                <p className="font-semibold text-lg leading-tight">{pkg.name}</p>
                <RichTextView value={pkg.description} className="text-muted-foreground" />
              </div>

              {highlights.length > 0 && (
                <ul className="space-y-1.5">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="pt-3 border-t space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Harga mulai</p>
                  <p className="text-2xl font-bold text-primary">
                    {formatRupiah(Number(pkg.price))}
                    {pkg.priceLabel && <span className="text-sm font-normal text-muted-foreground"> /{pkg.priceLabel}</span>}
                  </p>
                  {hasAddOns(pkg) && (
                    <p className="text-xs text-muted-foreground mt-0.5">+ komponen tambahan sesuai pilihan Anda saat booking</p>
                  )}
                </div>
                <Button asChild className="w-full">
                  <Link href={`/${locale}/register`}>
                    Pesan Paket Ini <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
