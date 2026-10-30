import type { LucideIcon } from 'lucide-react'
import { Receipt, Building2, Bus, KeyRound, Landmark, MapPin, Package, Star, UserRound, UtensilsCrossed } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MediaProductType } from '@/lib/media/owners'

// Tampilan foto produk universal untuk katalog publik (docs/arsitektur-media.md F3): satu komponen, satu perilaku. Tanpa foto → placeholder
// berikon per tipe produk, sehingga kartu tak pernah "bolong" dan tata letak tak bergeser saat foto baru diunggah. Server Component murni;
// URL berasal dari `getFeaturedCards`/`getProductImages` (presigned, bucket tetap private).
const ICONS: Record<MediaProductType, LucideIcon> = {
  hotel: Building2, tour_package: Landmark, vehicle: Bus, haji: Star, package: Package, catering: UtensilsCrossed, visa: KeyRound, muthowif: UserRound, tourism_site: MapPin, invoice_settings: Receipt,
}

type Props = {
  src?: string | null
  /** Teks alternatif dari admin; bila kosong dipakai `fallbackAlt` (mis. nama produk). */
  alt?: string | null
  fallbackAlt: string
  type: MediaProductType
  /** `video` (16:9) untuk kartu lebar, `square` untuk avatar/kartu kecil. */
  ratio?: 'video' | 'square'
  className?: string
}

export function ProductImage({ src, alt, fallbackAlt, type, ratio = 'video', className }: Props) {
  const Icon = ICONS[type]
  return (
    <div className={cn('relative w-full overflow-hidden bg-muted', ratio === 'video' ? 'aspect-video' : 'aspect-square', className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO (bucket private); sudah dikecilkan saat unggah (kartu ≤640 px)
        <img src={src} alt={alt || fallbackAlt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-muted to-muted/50" aria-hidden>
          <Icon className="h-10 w-10 text-muted-foreground/30" />
        </div>
      )}
    </div>
  )
}
