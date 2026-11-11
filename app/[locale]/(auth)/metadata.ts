import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { safeLocale } from '@/lib/utils/locale'

type AuthPage = 'login' | 'register' | 'complete' | 'google' | 'forgot' | 'reset' | 'contactData'

/** Judul tab halaman auth dalam bahasa halaman. `extra` untuk halaman bertoken (`referrer: 'no-referrer'`). */
export async function authMetadata(params: Promise<{ locale: string }>, page: AuthPage, extra: Metadata = {}): Promise<Metadata> {
  const t = await getTranslations({ locale: safeLocale((await params).locale), namespace: `authPages.${page}` })
  return { title: t('metaTitle'), ...extra }
}
