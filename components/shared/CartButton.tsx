'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ShoppingCart } from 'lucide-react'
import { readCart, serverCart, subscribeCart } from '@/lib/checkout/cartStore'

// Ikon keranjang di header (docs/arsitektur-booking-engine-v2.md §10.7) — jumlah entri dibaca dari perangkat (server = 0, lalu diisi saat hidrasi).
export function CartButton({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const count = useSyncExternalStore(subscribeCart, () => readCart().entries.length, () => serverCart().entries.length)
  return (
    <Link href={`/${locale}/keranjang`} aria-label={count > 0 ? t('cartCount', { count }) : t('cart')}
      className="relative grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      <ShoppingCart className="h-5 w-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-xs font-bold leading-none text-white" aria-hidden>{count}</span>
      )}
    </Link>
  )
}
