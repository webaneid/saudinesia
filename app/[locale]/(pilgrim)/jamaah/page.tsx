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

// "Jamaah Saya" (docs/arsitektur-jamaah.md §4, Fase 3): kartu jamaah milik akun ini saja, berpaginasi server, cari nama, filter arsip.

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_OPTIONS = [{ value: 'archived', label: 'Arsip' }]

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
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const status = archived ? 'archived' : undefined
  const columns: Column<SavedPilgrimView>[] = [
    {
      key: 'name', header: 'Nama', mobile: 'title',
      cell: p => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Link href={`${base}/${p.id}`} className="text-[13px] font-semibold text-primary hover:underline">{p.fullName}</Link>
          {p.isSelf && <Badge variant="secondary">Saya sendiri</Badge>}
          {p.needsNikCheck && <Badge variant="outline">Periksa NIK</Badge>}
        </span>
      ),
    },
    { key: 'birth', header: 'Tanggal lahir', cell: p => <span className="text-[13px] text-muted-foreground">{p.birthDate ? formatCalendarDate(p.birthDate) : '-'}</span> },
    { key: 'id', header: 'Identitas', hideBelowLg: true, cell: p => <span className="text-[13px] text-muted-foreground">{p.nik ? 'NIK tersimpan' : p.passport ? `Paspor ${p.passport.number}` : 'Belum ada'}</span> },
    { key: 'actions', header: '', actions: true, cell: p => <RowActions><ActionLink kind="edit" href={`${base}/${p.id}`} label={`Ubah data ${p.fullName}`} /></RowActions> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Jamaah Saya</h1>
          <p className="text-sm text-muted-foreground">Data jamaah yang Anda simpan untuk dipakai saat memesan. Hanya Anda yang melihat daftar ini.</p>
        </div>
        <Button asChild><Link href={`${base}/new`}><Plus className="mr-2 h-4 w-4" /> Tambah Jamaah</Link></Button>
      </div>

      <FilterBar active={Boolean(q || status)} resetHref={buildListHref(base, { limit: limitParam })}>
        <SearchForm action={base} q={q} placeholder="Cari nama…" preserve={{ status, limit: limitParam }} />
        <FilterSelect label="Status" allLabel="Aktif" value={status ?? ''} options={STATUS_OPTIONS} nav={{ base, param: 'status', query: { q: q || undefined, limit: limitParam } }} />
      </FilterBar>

      <DataTable
        columns={columns} rows={items} getRowId={p => p.id}
        empty={
          <span className="inline-flex flex-col items-center gap-2 py-6 text-muted-foreground">
            <UsersRound className="h-6 w-6" />
            {q ? 'Tidak ada jamaah dengan nama itu.' : archived ? 'Tidak ada data jamaah di arsip.' : 'Belum ada data jamaah. Tambahkan diri Anda dan keluarga yang akan berangkat.'}
          </span>
        }
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={page => buildListHref(base, { q: q || undefined, status, limit: limitParam, page })} /> : undefined}
      />
    </div>
  )
}
