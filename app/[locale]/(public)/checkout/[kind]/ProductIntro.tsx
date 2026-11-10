import { Building2, Clock, Globe2, Landmark, MapPin, Moon, Plane, Star, UsersRound, UtensilsCrossed } from 'lucide-react'
import type { CheckoutProduct } from '@/lib/checkout/options'
import { formatRupiah } from '@/lib/utils'
import { ProductImage } from '@/components/shared/ProductImage'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'

const TYPE_LABEL = { package: 'Paket Umroh', visa: 'Visa', transport: 'Transportasi', haji: 'Haji', hotel: 'Hotel', tour: 'Paket Ziarah', muthowif: 'Muthowif', catering: 'Katering', flight: 'Tiket Pesawat' } as const
/** Kunci DB katering → label (sama dengan katalog Katering). */
const MENU: Record<string, string> = { asian: 'Menu Asia', arabic: 'Menu Arab', western: 'Menu Barat' }
const BOARD: Record<string, string> = { full_board: 'Tiga kali makan', half_board: 'Dua kali makan' }
const MEDIA_TYPE = { package: 'package', visa: 'visa', haji: 'haji', hotel: 'hotel', tour: 'tour_package', catering: 'catering' } as const

// Kartu produk di atas formulir checkout: foto, nama, fakta singkat, harga mulai (petunjuk — angka yang mengikat ada di ringkasan dari server).
export function ProductIntro({ product }: { product: CheckoutProduct }) {
  const facts: Array<{ icon: typeof Clock; text: string }> = []
  let from = 0
  let unit = ''
  switch (product.kind) {
    case 'package':
      if (product.nights > 0) facts.push({ icon: Moon, text: `${product.nights} malam` })
      if (product.includedFlight) facts.push({ icon: Plane, text: product.includedFlight.label })
      from = product.pricePerPerson; unit = '/orang'
      break
    case 'visa':
      facts.push({ icon: Globe2, text: `${product.country} · ${product.visaType}` }, { icon: Clock, text: `Proses ± ${product.processDays} hari` })
      from = product.tiers.length ? Math.min(...product.tiers.map(t => t.fee)) : 0; unit = '/orang'
      break
    case 'transport':
      facts.push({ icon: MapPin, text: `${product.origin} → ${product.destination}` })
      from = product.slots.length ? Math.min(...product.slots.map(s => s.price)) : 0; unit = '/kendaraan'
      break
    case 'haji':
      facts.push({ icon: Clock, text: `Haji ${product.hajiType} ${product.year}` })
      from = product.price; unit = '/orang'
      break
    case 'hotel':
      facts.push({ icon: Building2, text: product.city.charAt(0).toUpperCase() + product.city.slice(1) })
      if (product.stars) facts.push({ icon: Star, text: `Bintang ${product.stars}` })
      from = product.schedules.length ? Math.min(...product.schedules.map(x => x.price)) : 0; unit = '/kamar/malam'
      break
    case 'tour':
      if (product.sites.length) facts.push({ icon: Landmark, text: `${product.sites.length} situs` })
      if (product.includedVehicle) facts.push({ icon: MapPin, text: product.includedVehicle })
      from = product.price; unit = '/paket'
      break
    case 'muthowif':
      facts.push({ icon: UsersRound, text: 'Pembimbing ditentukan tim kami' })
      from = product.pricePerPersonDay; unit = '/orang/hari'
      break
    case 'catering': {
      facts.push({ icon: UtensilsCrossed, text: `${MENU[product.menuStyle] ?? product.menuStyle} · ${BOARD[product.boardType] ?? product.boardType}` })
      const priced = [product.prices.regular, product.prices.ramadan, product.prices.hajj].filter(n => n > 0)
      from = priced.length ? Math.min(...priced) : 0; unit = '/orang/hari'
      break
    }
    case 'flight':
      facts.push({ icon: Plane, text: product.schedule.airline ?? 'Tiket pesawat' })
      from = product.schedule.price; unit = '/penumpang'
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
        <span className="catalog-chip">{TYPE_LABEL[product.kind]}</span>
        <h1 className="text-2xl font-extrabold leading-tight text-brand-dark">{product.name}</h1>
        {facts.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {facts.map(f => <li key={f.text} className="flex items-center gap-1.5"><f.icon className="h-4 w-4 text-brand" aria-hidden /> {f.text}</li>)}
          </ul>
        )}
        <RichTextView value={product.description} className="text-sm text-muted-foreground" />
        {from > 0 && <p className="text-sm">Mulai <span className="text-lg font-bold text-brand">{formatRupiah(from)}</span> <span className="text-muted-foreground">{unit}</span></p>}
      </div>
    </div>
  )
}
