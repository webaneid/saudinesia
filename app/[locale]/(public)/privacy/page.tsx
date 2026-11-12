import { AlertTriangle } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { getPaymentConfig } from '@/lib/constants/payment'
import { PRIVACY_POLICY_VERSION } from '@/lib/constants/legal'
import { safeLocale } from '@/lib/utils/locale'

type Props = { params: Promise<{ locale: string }> }

// Kategori data pribadi yang dikumpulkan — teksnya di pesan `privacy.categories` (id/en). Menambah kategori = entri di sini + pesan kedua bahasa
// (penjaga kunci id↔en). Isi kebijakan berubah → naikkan PRIVACY_POLICY_VERSION (persetujuan tercatat per versi); menambah terjemahan tidak.
const CATEGORIES = ['identity', 'documents', 'health', 'payment'] as const

export async function generateMetadata({ params }: Props) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'privacy' })
  return { title: tm('metaTitle') }
}

export default async function PrivacyPolicyPage({ params }: Props) {
  const locale = safeLocale((await params).locale)
  const [t, td] = await Promise.all([
    getTranslations({ locale, namespace: 'privacy' }),
    getTranslations({ locale, namespace: 'pilgrimArea.deletion' }),
  ])
  const { businessName, businessWa, businessAddress } = getPaymentConfig()

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('version', { version: PRIVACY_POLICY_VERSION })}</p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden />
        <p className="text-sm text-amber-800">
          <strong>{t('draftTitle')}</strong> {t('draftBody', { company: businessName })}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('collectTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('collectIntro')}</p>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          {CATEGORIES.map(c => <li key={c}>{t(`categories.${c}`)}</li>)}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('purposeTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('purposeBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('storageTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('storageBody')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('rightsTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('rightsBody', { button: td('request') })}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t('contactTitle')}</h2>
        <p className="text-sm text-muted-foreground">
          {businessName}
          {businessAddress ? ` — ${businessAddress}` : ''}
          {businessWa ? ` — ${t('contactWa', { number: businessWa })}` : ''}
        </p>
      </section>
    </div>
  )
}
