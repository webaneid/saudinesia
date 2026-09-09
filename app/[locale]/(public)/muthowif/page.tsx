import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { getPresignedUrl } from '@/lib/storage/minio'
import { UserRound, Star, Globe } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRupiah } from '@/lib/utils'

type Props = { params: Promise<{ locale: string }> }

export default async function MuthowifPage({ params }: Props) {
  const { locale } = await params

  const [guidesRaw, servicePrice] = await Promise.all([
    prisma.muthowif.findMany({ where: { isActive: true }, orderBy: { rating: 'desc' } }),
    prisma.muthowifServicePrice.findFirst(),
  ])
  const guides = await Promise.all(guidesRaw.map(async (g) => ({
    ...g, photoUrl: g.photoKey ? await getPresignedUrl(g.photoKey, 3600).catch(() => null) : null,
  })))

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Muthowif (Pembimbing Ibadah)</h1>
        <p className="text-muted-foreground">{guides.length} pembimbing berpengalaman — Saudinesia yang menentukan siapa yang bertugas untuk setiap jamaah.</p>
        {servicePrice && (
          <p className="text-sm font-medium text-primary">
            Harga layanan mulai {formatRupiah(Number(servicePrice.price))}<span className="text-xs font-normal text-muted-foreground">/hari</span>
          </p>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {guides.map((g) => {
          const langs = g.languages as string[]
          return (
            <Link key={g.id} href={`/${locale}/muthowif/${g.id}`}
              className="group rounded-xl border p-5 space-y-4 hover:border-primary hover:shadow-sm transition-all">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 overflow-hidden shrink-0 relative grid place-items-center">
                  {g.photoUrl ? (
                    <Image src={g.photoUrl} alt={g.name} fill className="object-cover" unoptimized />
                  ) : (
                    <UserRound className="h-6 w-6 text-primary" />
                  )}
                </div>
                <div>
                  <p className="font-semibold">{g.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    <span className="text-sm font-medium">{Number(g.rating).toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground">/ 5.0</span>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground line-clamp-3">{g.bio}</p>

              <div className="flex flex-wrap gap-1.5">
                {langs.map((lang) => (
                  <Badge key={lang} variant="outline" className="text-xs">
                    <Globe className="h-3 w-3 mr-1" />{lang}
                  </Badge>
                ))}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
