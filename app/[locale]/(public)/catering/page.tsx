import { prisma } from '@/lib/db'
import { detectSeason } from '@/lib/utils/season'
import { UtensilsCrossed, CheckCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatRupiah } from '@/lib/utils'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'

type Props = { params: Promise<{ locale: string }> }

export default async function CateringPage({ params }: Props) {
  const { locale } = await params
  const season = await detectSeason(new Date())
  const options = await prisma.cateringOption.findMany({ where: { isActive: true } })

  const priceKey = `pricePerPerson${season.charAt(0).toUpperCase() + season.slice(1)}` as
    'pricePerPersonRegular' | 'pricePerPersonRamadan' | 'pricePerPersonHajj'

  const menuLabel: Record<string, string> = { asian: 'Menu Asia', arabic: 'Menu Arab', western: 'Menu Barat' }
  const boardLabel: Record<string, string> = { full_board: 'Full Board (3x makan)', half_board: 'Half Board (2x makan)' }

  const features = ['Halal bersertifikat', 'Disajikan di hotel', 'Chef berpengalaman', 'Menu bervariasi']

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Paket Katering</h1>
        <p className="text-muted-foreground mt-1">Konsumsi halal selama perjalanan · Musim <span className="capitalize font-medium">{season}</span></p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {options.map((o) => (
          <div key={o.id} className="rounded-xl border p-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{o.name}</p>
                <Badge variant="secondary">{menuLabel[o.menuStyle] ?? o.menuStyle}</Badge>
              </div>
              <Badge variant="outline">{boardLabel[o.boardType] ?? o.boardType}</Badge>
              <RichTextView value={o.description} className="text-muted-foreground" />
            </div>
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">Per orang / hari</p>
              <p className="text-xl font-bold text-primary">{formatRupiah(Number(o[priceKey]))}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-muted/50 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Keunggulan Katering Saudinesia</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
