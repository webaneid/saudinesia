import { notFound, redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { getSavedPilgrim } from '@/lib/pilgrims/service'
import { cardIdSchema } from '@/lib/pilgrims/http'
import { SavedPilgrimEditor } from '../SavedPilgrimEditor'
import { WARNING_TEXT } from '@/components/shared/pilgrims/warningText'
import type { PilgrimWarning } from '@/lib/pilgrims/service'
import { getTranslations } from 'next-intl/server'

type Props = { params: Promise<{ locale: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

// Judul generik: nama jamaah (data pribadi) tidak ditaruh di judul tab/riwayat browser.
export async function generateMetadata({ params }: Pick<Props, 'params'>) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'pilgrimArea.editor' })
  return { title: tm('editMetaTitle') }
}

// Kartu akun lain / tak ada → 404 yang sama (kepemilikan dicek di layanan, pemilik = sesi).
export default async function EditSavedPilgrimPage({ params, searchParams }: Props) {
  const { locale, id } = await params
  const sp = await searchParams
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)
  if (session.role !== 'pilgrim') redirect(`/${safeLocale(locale)}/dashboard`)
  const cardId = cardIdSchema.safeParse(id)
  if (!cardId.success) notFound()
  const card = await getSavedPilgrim({ userId: session.userId, role: session.role }, session.userId, cardId.data)
  if (!card) notFound()
  // Sesudah "Tambah": ?saved=1 / ?w=<kode peringatan> — kode disaring daftar putih (URL bisa ditulis tangan).
  const warnings = [...new Set(typeof sp.w === 'string' ? sp.w.split(',') : [])].filter((w): w is PilgrimWarning => Object.hasOwn(WARNING_TEXT, w)) // daftar putih kode (teksnya diterjemahkan di editor)
  const created = sp.saved === '1' || warnings.length > 0
  return <SavedPilgrimEditor locale={safeLocale(locale)} card={card} initialWarnings={warnings} created={created} />
}
