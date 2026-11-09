import { redirect } from 'next/navigation'
import { checkoutPath } from '@/lib/checkout/kinds'
import { safeNextPath } from '@/lib/auth/nextPath'
import { safeLocale } from '@/lib/utils/locale'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ productId?: string }> }

// Alamat lama checkout Visa (Step 6, 2026-07-25) — tetap hidup untuk tautan di email/markah: dialihkan ke checkout pelanggan baru
// (docs/arsitektur-booking-engine-v2.md §10.5). Id tak sah → katalog Visa.
export default async function LegacyVisaCheckout({ params, searchParams }: Props) {
  const locale = safeLocale((await params).locale)
  const target = checkoutPath(locale, 'visa', (await searchParams).productId ?? '')
  redirect(safeNextPath(target) ?? `/${locale}/visa`)
}
