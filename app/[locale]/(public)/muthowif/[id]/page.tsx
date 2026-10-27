import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/db'
import { getFeaturedUrls } from '@/lib/media/urls'
import { UserRound, Star, Globe, Users, ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/utils'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'
import { getMuthowifServicePrice } from '@/lib/pricing/engine/read'

type Props = { params: Promise<{ locale: string; id: string }> }

export default async function MuthowifDetailPage({ params }: Props) {
  const { locale, id } = await params

  const [guide, servicePrice] = await Promise.all([
    prisma.muthowif.findUnique({ where: { id, isActive: true } }),
    getMuthowifServicePrice(),
  ])
  if (!guide) notFound()

  const langs = guide.languages as string[]
  const photoUrl = (await getFeaturedUrls('muthowif', [guide.id])).get(guide.id) ?? null

  return (
    <div className="max-w-2xl space-y-8">
      <Link href={`/${locale}/muthowif`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke daftar muthowif
      </Link>

      <div className="rounded-xl border p-6 space-y-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-primary/10 overflow-hidden shrink-0 relative grid place-items-center">
            {photoUrl ? (
              <Image src={photoUrl} alt={guide.name} fill className="object-cover" unoptimized />
            ) : (
              <UserRound className="h-8 w-8 text-primary" />
            )}
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{guide.name}</h1>
            <div className="flex items-center gap-1.5">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span className="font-semibold">{Number(guide.rating).toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">/ 5.0</span>
            </div>
          </div>
        </div>

        <RichTextView value={guide.bio} className="text-base text-muted-foreground" />

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/50 p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Globe className="h-3.5 w-3.5" /> Bahasa
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {langs.map((l) => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)}
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Kapasitas harian
            </div>
            <p className="font-bold text-lg">{guide.dailyCapacity} jamaah</p>
          </div>
        </div>

        <div className="pt-4 border-t flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Harga layanan muthowif per hari</p>
            {servicePrice && (
              <p className="text-2xl font-bold text-primary">{formatRupiah(servicePrice.price)}</p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Tim kami yang menentukan pembimbing bertugas — tidak selalu {guide.name}.</p>
          </div>
          <Button asChild>
            <Link href={`/${locale}/register`}>Pesan Layanan Muthowif</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
