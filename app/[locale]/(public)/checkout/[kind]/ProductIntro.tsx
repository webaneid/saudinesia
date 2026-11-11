import { useTranslations } from 'next-intl'
import { Building2, Clock, Globe2, Landmark, MapPin, Moon, Plane, Star, UsersRound, UtensilsCrossed } from 'lucide-react'
import type { CheckoutProduct } from '@/lib/checkout/options'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'

/** Kunci DB katering yang punya terjemahan (`checkout.intro.menu.*` / `board.*`); kunci lain tampil apa adanya. */
const MENU = ['asian', 'arabic', 'western'] as const
const BOARD = ['full_board', 'half_board'] as const
const known = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v)
const MEDIA_TYPE = { package: 'package', visa: 'visa', haji: 'haji', hotel: 'hotel', tour: 'tour_package', catering: 'catering' } as const

// Kartu produk di atas formulir checkout: foto, nama, fakta singkat, harga mulai (petunjuk — angka yang mengikat ada di ringkasan dari server).
export function ProductIntro({ product }: { product: CheckoutProduct }) {
  const t = useTranslations('checkout')
  const facts: Array<{ icon: typeof Clock; text: string }> = []
  let from = 0
  let unit = ''
  switch (product.kind) {
    case 'package':
      if (product.nights > 0) facts.push({ icon: Moon, text: t('intro.nights', { nights: product.nights }) })
      if (product.includedFlight) facts.push({ icon: Plane, text: product.includedFlight.label ?? t('common.flightFallback') })
      from = product.pricePerPerson; unit = t('intro.unit.person')
      break
    case 'visa':
      facts.push({ icon: Globe2, text: `${product.country} · ${product.visaType}` }, { icon: Clock, text: t('intro.process', { days: product.processDays }) })
      from = product.tiers.length ? Math.min(...product.tiers.map(x => x.fee)) : 0; unit = t('intro.unit.person')
      break
    case 'transport':
      facts.push({ icon: MapPin, text: `${product.origin} → ${product.destination}` })
      from = product.slots.length ? Math.min(...product.slots.map(s => s.price)) : 0; unit = t('intro.unit.vehicle')
      break
    case 'haji':
      facts.push({ icon: Clock, text: t('intro.haji', { type: product.hajiType, year: product.year }) })
      from = product.price; unit = t('intro.unit.person')
      break
    case 'hotel':
      facts.push({ icon: Building2, text: product.city.charAt(0).toUpperCase() + product.city.slice(1) })
      if (product.stars) facts.push({ icon: Star, text: t('intro.stars', { stars: product.stars }) })
      from = product.schedules.length ? Math.min(...product.schedules.map(x => x.price)) : 0; unit = t('intro.unit.roomNight')
      break
    case 'tour':
      if (product.sites.length) facts.push({ icon: Landmark, text: t('intro.sites', { count: product.sites.length }) })
      if (product.includedVehicle) facts.push({ icon: MapPin, text: product.includedVehicle })
      from = product.price; unit = t('intro.unit.package')
      break
    case 'muthowif':
      facts.push({ icon: UsersRound, text: t('intro.guide') })
      from = product.pricePerPersonDay; unit = t('intro.unit.personDay')
      break
    case 'catering': {
      facts.push({ icon: UtensilsCrossed, text: `${known(MENU, product.menuStyle) ? t(`intro.menu.${product.menuStyle}`) : product.menuStyle} · ${known(BOARD, product.boardType) ? t(`intro.board.${product.boardType}`) : product.boardType}` })
      const priced = [product.prices.regular, product.prices.ramadan, product.prices.hajj].filter(n => n > 0)
      from = priced.length ? Math.min(...priced) : 0; unit = t('intro.unit.personDay')
      break
    }
    case 'flight':
      facts.push({ icon: Plane, text: product.schedule.airline ?? t('common.flightFallback') })
      from = product.schedule.price; unit = t('intro.unit.passenger')
      break
  }
  // Foto hanya untuk jenis yang punya foto produk (registry media); transport/muthowif/tiket tanpa foto di sini.
  const media = product.kind in MEDIA_TYPE && 'cover' in product ? { type: MEDIA_TYPE[product.kind as keyof typeof MEDIA_TYPE], cover: product.cover } : null

  return (
    <div className="checkout-panel flex flex-col gap-5 sm:flex-row">
      {media && (
        <div className="overflow-hidden rounded-xl sm:w-56 sm:shrink-0">
          <ProductImage src={media.cover?.src} alt={media.cover?.alt} fallbackAlt={product.name} type={media.type} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <span className="catalog-chip">{t(`kinds.${product.kind}`)}</span>
        <h1 className="text-2xl font-extrabold leading-tight text-brand-dark">{product.name}</h1>
        {facts.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {facts.map(f => <li key={f.text} className="flex items-center gap-1.5"><f.icon className="h-4 w-4 text-brand" aria-hidden /> {f.text}</li>)}
          </ul>
        )}
        <RichTextView value={product.description} className="text-sm text-muted-foreground" />
        {from > 0 && <p className="text-sm">{t('intro.from')} <span className="text-lg font-bold text-brand">{formatRupiah(from)}</span> <span className="text-muted-foreground">{unit}</span></p>}
      </div>
    </div>
  )
}
