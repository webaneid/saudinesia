'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'

type Season = { id: string; name: string; startDate: string; endDate: string }
const LABELS: Record<string, string> = { regular: 'Regular', ramadan: 'Ramadan', hajj: 'Haji' }

export default function SeasonsPage() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/products/seasons`
  const columns = (reload: () => void): Column<Season>[] => [
    {
      key: 'name', header: 'Musim', mobile: 'title',
      cell: s => <Badge tone={s.name === 'hajj' ? 'warning' : s.name === 'ramadan' ? 'accent' : 'neutral'}>{LABELS[s.name] ?? s.name}</Badge>,
    },
    { key: 'start', header: 'Mulai', cell: s => <span className="text-[12px] tabular-nums text-admin-ink/80">{s.startDate.slice(0, 10)}</span> },
    { key: 'end', header: 'Selesai', cell: s => <span className="text-[12px] tabular-nums text-admin-ink/80">{s.endDate.slice(0, 10)}</span> },
    { key: 'actions', header: '', actions: true, cell: s => <CatalogActions editHref={`${base}/${s.id}`} url={`/api/v1/admin/products/seasons/${s.id}`} subject={`musim ${LABELS[s.name] ?? s.name} ${s.startDate.slice(0, 10)}`} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        title="Manajemen Musim"
        description="Musim menentukan tier harga yang berlaku. Tanggal di luar range Ramadan/Haji otomatis dianggap Regular."
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Musim</Link>}
      />
      <CatalogList<Season> endpoint="/api/v1/admin/products/seasons" columns={columns} getRowId={s => s.id} search={false} empty="Belum ada musim." />
    </div>
  )
}
