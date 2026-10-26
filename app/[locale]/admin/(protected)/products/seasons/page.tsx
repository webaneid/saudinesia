'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Badge } from '@/components/admin/ui/Badge'

type Season = { id: string; name: string; startDate: string; endDate: string }
const LABELS: Record<string, string> = { regular: 'Regular', ramadan: 'Ramadan', hajj: 'Haji' }

export default function SeasonsPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const { locale } = useParams() as { locale: string }
  const [loading, setLoading] = useState(true)

  async function load() { const r = await fetch('/api/v1/admin/products/seasons'); const j = await r.json(); setSeasons(j.data ?? []); setLoading(false) }
  useEffect(() => { load() }, [])

  async function handleDelete(id: string) {
    if (!confirm('Hapus musim ini?')) return
    await fetch(`/api/v1/admin/products/seasons/${id}`, { method: 'DELETE' })
    await load()
  }

  const columns: Column<Season>[] = [
    {
      key: 'name', header: 'Musim', mobile: 'title',
      cell: s => <Badge tone={s.name === 'hajj' ? 'warning' : s.name === 'ramadan' ? 'accent' : 'neutral'}>{LABELS[s.name] ?? s.name}</Badge>,
    },
    { key: 'start', header: 'Mulai', cell: s => <span className="text-[12px] tabular-nums text-admin-ink/80">{s.startDate.slice(0, 10)}</span> },
    { key: 'end', header: 'Selesai', cell: s => <span className="text-[12px] tabular-nums text-admin-ink/80">{s.endDate.slice(0, 10)}</span> },
    {
      key: 'actions', header: '', align: 'right',
      cell: s => (
        <div className="flex items-center justify-end gap-3">
          <Link href={`/${locale}/admin/products/seasons/${s.id}`} className="inline-flex items-center gap-1 text-[12px] text-admin-muted transition-colors hover:text-admin-ink"><Pencil className="h-3.5 w-3.5" /> Edit</Link>
          <button onClick={() => handleDelete(s.id)} aria-label="Hapus musim" className="text-admin-muted/70 transition-colors hover:text-admin-danger">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Manajemen Musim"
        description="Musim menentukan tier harga yang berlaku. Tanggal di luar range Ramadan/Haji otomatis dianggap Regular."
        actions={<Link href={`/${locale}/admin/products/seasons/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah Musim</Link>}
      />

      <DataTable columns={columns} rows={seasons} getRowId={s => s.id} loading={loading} empty="Belum ada musim." />
    </div>
  )
}
