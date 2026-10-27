import { prisma } from '@/lib/db'
import { VisaCheckoutForm } from '@/components/booking/VisaCheckoutForm'
import { visaPriceSummary } from '@/lib/pricing/engine/read'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ productId?: string }>
}

// docs/arsitektur-booking.md §6 Step 6b — checkout pendek Visa-only, terpisah dari wizard
// 7-langkah (§1.5). Layout (pilgrim) sudah menjamin auth guard, tidak perlu cek ulang di sini.
export default async function VisaCheckoutPage({ searchParams }: Props) {
  const { productId } = await searchParams

  const products = await prisma.visaProduct.findMany({
    where: { isActive: true },
    orderBy: [{ country: 'asc' }, { visaType: 'asc' }],
    select: { id: true, name: true, country: true, visaType: true },
  })
  const summary = await visaPriceSummary(products.map(p => p.id))

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Checkout Visa</h1>
        <p className="text-sm text-muted-foreground">Pesan visa saja, tanpa produk lain — isi data jamaah dan lanjut ke pembayaran.</p>
      </div>
      <VisaCheckoutForm
        products={products.map(p => ({ ...p, price: summary.get(p.id)?.from ?? 0 }))}
        preselectedProductId={productId ?? null}
      />
    </div>
  )
}
