import { redirect } from 'next/navigation'
import { checkoutPath } from '@/lib/checkout/kinds'
import { safeNextPath } from '@/lib/auth/nextPath'
import { safeLocale } from '@/lib/utils/locale'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ tripId?: string }> }

// Alamat lama checkout Transport (Step 6, 2026-07-25) — tetap hidup untuk tautan di email/markah: dialihkan ke checkout pelanggan baru
// (docs/arsitektur-booking-engine-v2.md §10.5). Id tak sah → katalog Transportasi.
export default async function LegacyTransportCheckout({ params, searchParams }: Props) {
  const locale = safeLocale((await params).locale)
  const target = checkoutPath(locale, 'transport', (await searchParams).tripId ?? '')
  redirect(safeNextPath(target) ?? `/${locale}/transport`)
}
