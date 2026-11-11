import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus, UsersRound } from 'lucide-react'
import { safeLocale } from '@/lib/utils/locale'
import { getSession } from '@/lib/auth/session'
import { listSavedPilgrims, type SavedPilgrimView } from '@/lib/pilgrims/service'
import { buildListHref, parseListParams } from '@/lib/table/pagination'
import { formatCalendarDate } from '@/lib/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { FilterBar } from '@/components/shared/data-table/FilterBar'
import { FilterSelect } from '@/components/shared/data-table/FilterSelect'
import { Pagination } from '@/components/shared/data-table/Pagination'
import { ActionLink, RowActions } from '@/components/shared/data-table/RowActions'
import { SearchForm } from '@/components/shared/data-table/SearchForm'
import { getTranslations } from 'next-intl/server'

// "Jamaah Saya" (docs/arsitektur-jamaah.md §4, Fase 3): kartu jamaah milik akun ini saja, berpaginasi server, cari nama, filter arsip.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Pick<Props, 'params'>) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'pilgrimArea.jamaah' })
  return { title: tm('metaTitle') }
}

export default async function SavedPilgrimsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const sp = await searchParams
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)
  if (session.role !== 'pilgrim') redirect(`/${safeLocale(locale)}/dashboard`)

  const list = parseListParams(sp, 20)
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : ''
  const archived = sp.status === 'archived'
  const result = await listSavedPilgrims({ userId: session.userId, role: session.role }, session.userId, { ...list, ...(q ? { q } : {}), archived })
  const { items, meta } = result ?? { items: [], meta: { page: 1, limit: list.limit, total: 0, totalPages: 1 } }

  const base = `/${locale}/jamaah`
  const lang = safeLocale(locale)
  const t = await getTranslations({ locale: lang, namespace: 'pilgrimArea.jamaah' })
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const status = archived ? 'archived' : undefined
  const columns: Column<SavedPilgrimView>[] = [
    {
      key: 'name', header: t('name'), mobile: 'title',
      cell: p => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link href={`${base}/${p.id}`} className="text-[13px] font-semibold text-primary hover:underline">{p.fullName}</Link>
          {p.isSelf && <Badge variant="secondary">{t('self')}</Badge>}
          {p.needsNikCheck && <Badge variant="outline">{t('checkNik')}</Badge>}
        </span>
      ),
    },
    { key: 'birth', header: t('birth'), cell: p => <span className="text-[13px] text-muted-foreground">{p.birthDate ? formatCalendarDate(p.birthDate, undefined, lang) : '-'}</span> },
    { key: 'id', header: t('identity'), hideBelowLg: true, cell: p => <span className="text-[13px] text-muted-foreground">{p.nik ? t('nikSaved') : p.passport ? t('passport', { number: p.passport.number }) : t('none')}</span> },
    { key: 'actions', header: '', actions: true, cell: p => <RowActions><ActionLink kind="edit" href={`${base}/${p.id}`} label={t('edit', { name: p.fullName })} /></RowActions> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <Button asChild><Link href={`${base}/new`}><Plus className="mr-2 h-4 w-4" /> {t('add')}</Link></Button>
      </div>

      <FilterBar active={Boolean(q || status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm action={base} q={q} placeholder={t('search')} preserve={{ status, limit: limitParam }} />
        <FilterSelect label={t('status')} allLabel={t('active')} value={status ?? ''} options={[{ value: 'archived', label: t('archived') }]} nav={{ base, param: 'status', query: { q: q || undefined, limit: limitParam } }} />
      </FilterBar>

      <DataTable
        columns={columns} rows={items} getRowId={p => p.id}
        empty={
          <span className="inline-flex flex-col items-center gap-2 py-6 text-muted-foreground">
            <UsersRound className="h-6 w-6" />
            {q ? t('emptySearch') : archived ? t('emptyArchive') : t('empty')}
          </span>
        }
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => buildListHref(base, { q: q || undefined, status, limit: limitParam, page })} /> : undefined}
      />
    </div>
  )
}
