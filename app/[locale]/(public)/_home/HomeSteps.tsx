import { getPageText } from '@/lib/public-content/content'
import { HomeSectionHeader } from './HomeSectionHeader'

const STEPS = ['choose', 'data', 'pay', 'verify'] as const

// Sesuai alur nyata. Catatan bawah wajib ada selama checkout pelanggan baru Visa dan Transport (§1.2 rencana): hapus setelah produk lain bisa dipesan sendiri.
export async function HomeSteps({ locale }: { locale: string }) {
  const t = await getPageText(locale, 'home', 'steps')
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
      <p className="text-sm text-muted-foreground">{t('availability')}</p>
    </section>
  )
}
