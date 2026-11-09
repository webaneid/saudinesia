import { getPageText } from '@/lib/public-content/content'
import { availableCatalogs } from '@/lib/catalog/availability'
import { HomeSectionHeader } from './HomeSectionHeader'

const STEPS = ['choose', 'data', 'pay', 'verify'] as const

// Sesuai alur nyata. Catatan bawah wajib ada selama checkout pelanggan baru Visa dan Transport (§1.2 rencana): hapus setelah produk lain bisa dipesan sendiri.
// Catatan hanya menyebut layanan yang punya produk (§7): tak satu pun = tanpa catatan.
export async function HomeSteps({ locale }: { locale: string }) {
  const [t, available] = await Promise.all([getPageText(locale, 'home', 'steps'), availableCatalogs()])
  const visa = available.has('visa')
  const transport = available.has('transport')
  const note = visa && transport ? 'availability' : visa ? 'availabilityVisa' : transport ? 'availabilityTransport' : null
  return (
    <section className="space-y-6">
      <HomeSectionHeader title={t('title')} />
      <ol className="grid gap-4 md:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step} className="space-y-2 rounded-2xl border bg-card p-5">
            <span className="inline-grid h-8 w-8 place-items-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
            <p className="font-semibold text-brand-dark">{t(`${step}.title`)}</p>
            <p className="text-sm text-muted-foreground">{t(`${step}.description`)}</p>
          </li>
        ))}
      </ol>
      {note && <p className="text-sm text-muted-foreground">{t(note)}</p>}
    </section>
  )
}
