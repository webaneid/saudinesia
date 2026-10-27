import { ProductImage } from '@/components/shared/ProductImage'
import { getFeaturedCards } from '@/lib/media/urls'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { KeyRound, Clock, FileText, ArrowRight, Globe, ShieldCheck, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatRupiah } from '@/lib/utils'
import { getDocumentRequirements } from '@/lib/documents/getRequirements'
import { RichTextView } from '@/components/shared/rich-text/RichTextView'

type Props = { params: Promise<{ locale: string }> }

export default async function VisaCatalogPage({ params }: Props) {
  const { locale } = await params
  const products = await prisma.visaProduct.findMany({
    where: { isActive: true },
    orderBy: [{ country: 'asc' }, { visaType: 'asc' }],
  })

  // docs/arsitektur-dokumen.md §4 — getDocumentRequirements() menggantikan
  // parseRequirements(visaProduct.requirements)
  const requirementsByProduct = new Map<string, Awaited<ReturnType<typeof getDocumentRequirements>>>()
  for (const p of products) {
    requirementsByProduct.set(p.id, await getDocumentRequirements('visa', p.id))
  }

  const covers = await getFeaturedCards('visa', products.map(p => p.id))

  // Group by country
  const grouped = products.reduce<Record<string, typeof products>>((acc, p) => {
    const key = p.country || 'Saudi Arabia'
    acc[key] = acc[key] ?? []
    acc[key].push(p)
    return acc
  }, {})

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <KeyRound className="h-8 w-8 text-teal-600" />
          Layanan Visa
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Saudinesia membantu pengurusan berbagai jenis visa — dari visa umroh, visitor, bisnis, hingga kerja.
          Proses cepat, dokumen lengkap, hasil terpercaya.
        </p>
      </div>

      {products.length === 0 && (
        <div className="rounded-xl border border-dashed p-16 text-center text-muted-foreground">
          <KeyRound className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Informasi layanan visa akan segera tersedia.</p>
        </div>
      )}

      {Object.entries(grouped).map(([country, items]) => (
        <div key={country} className="space-y-4">
          {/* Country header */}
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
            <Globe className="h-4 w-4 text-teal-600" />
            <span>{country}</span>
            <div className="flex-1 h-px bg-border ml-2" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {items.map(v => {
              const requirements = requirementsByProduct.get(v.id) ?? []
              const required  = requirements.filter(r => r.required)
              const optional  = requirements.filter(r => !r.required)
              // "Mulai dari" kalau ada >=2 harga berbeda di antara tier durasi — docs/arsitektur-harga.md §17.5
              const fees = (v.durationFeeRules as unknown as { fee: number }[]).map(r => r.fee)
              const priceIsRange = new Set(fees).size >= 2

              return (
                <div
                  key={v.id}
                  className="overflow-hidden rounded-xl border bg-card hover:border-teal-400 hover:shadow-sm transition-all"
                >
                  <ProductImage src={covers.get(v.id)?.src} alt={covers.get(v.id)?.alt} fallbackAlt={v.name} type="visa" />
                  <div className="p-5 space-y-4">
                  {/* Title + type badge + price */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <p className="font-semibold text-foreground">{v.name}</p>
                      <span className="inline-block text-xs font-medium px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100">
                        {v.visaType}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-teal-700">
                        {priceIsRange && <span className="text-sm font-medium text-muted-foreground">Mulai dari </span>}
                        {formatRupiah(Number(v.price))}
                      </p>
                      <p className="text-xs text-muted-foreground">{v.priceLabel ?? 'per orang'}</p>
                    </div>
                  </div>

                  {/* Description */}
                  <RichTextView value={v.description} className="text-muted-foreground" />

                  {/* Process time */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5 text-teal-500" />
                    Estimasi proses:{' '}
                    <span className="font-semibold text-foreground">{v.processDays} hari kerja</span>
                  </div>

                  {/* Requirements */}
                  {requirements.length > 0 && (
                    <div className="space-y-2.5 pt-1 border-t border-border">
                      <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                        <FileText className="h-3.5 w-3.5 text-teal-500" />
                        Persyaratan Dokumen
                      </p>

                      {required.length > 0 && (
                        <ul className="space-y-1.5">
                          {required.map((req, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <ShieldCheck className="h-3.5 w-3.5 text-teal-500 mt-0.5 shrink-0" />
                              <span>
                                <span className="font-medium text-foreground">{req.label}</span>
                                {req.description && (
                                  <span className="text-muted-foreground"> — {req.description}</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {optional.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground font-medium">Opsional / Kondisional:</p>
                          <ul className="space-y-1">
                            {optional.map((req, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                <span>
                                  <span className="font-medium">{req.label}</span>
                                  {req.description && <span> — {req.description}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Old string[] fallback — if requirements is still plain strings */}
                  {requirements.length === 0 && Array.isArray(v.requirements) && (v.requirements as unknown[]).length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-border">
                      <p className="text-xs font-semibold flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" /> Persyaratan Dokumen
                      </p>
                      <ul className="space-y-1">
                        {(v.requirements as unknown as string[]).map((req, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                            <span className="text-teal-500 mt-0.5">•</span> {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border">
                    <Button asChild className="w-full" size="sm">
                      <Link href={`/${locale}/bookings/checkout/visa?productId=${v.id}`}>
                        Ajukan Sekarang <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
