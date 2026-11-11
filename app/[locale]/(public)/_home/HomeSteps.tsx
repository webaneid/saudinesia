import { getPageText } from '@/lib/public-content/content'
import { HomeSectionHeader } from './HomeSectionHeader'

const STEPS = ['choose', 'data', 'pay', 'verify'] as const

// Sesuai alur nyata. Catatan "baru Visa dan Transport yang bisa dipesan online" (§1.2) DIHAPUS 2026-11-11: sejak Fase 11a–11c semua layanan
// berharga bisa dipesan lewat checkout (docs/arsitektur-frontend-publik.md §8).
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
    </section>
  )
}
