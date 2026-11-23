'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, FileBadge } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { documentIcon } from '@/lib/documents/icons'
import type { DocumentTypeRow } from '@/components/admin/documents/documentTypeForm'
import { adminHref } from '@/lib/admin/href'

export default function DocumentTypesPage() {
  const { locale } = useParams() as { locale: string }
  const base = adminHref(locale, `/admin/products/document-types`)
  const columns = (reload: () => void): Column<DocumentTypeRow>[] => [
    {
      key: 'label', header: 'Jenis Dokumen', mobile: 'title',
      cell: t => {
        const Icon = documentIcon(t.icon)
        return (
          <Link href={`${base}/${t.id}`} className="flex min-w-0 items-center gap-2.5 hover:text-admin-accent-strong">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-admin-accent/12 text-admin-accent-strong"><Icon className="size-3.5" aria-hidden /></span>
            <span className="font-semibold">{t.label}</span>
          </Link>
        )
      },
    },
    { key: 'key', header: 'Kode', hideBelowLg: true, cell: t => <code className="rounded bg-admin-spot px-1.5 py-0.5 text-xs text-admin-ink">{t.key}</code> },
    {
      key: 'kind', header: 'Sifat',
      cell: t => (
        <span className="block text-xs text-admin-muted">
          <span className="whitespace-nowrap">{t.reusable ? 'Milik jamaah' : 'Per perjalanan'}</span>
          {(t.hasExpiry || t.allowMultiple) && <span className="block">{[t.hasExpiry && 'masa berlaku', t.allowMultiple && 'banyak berkas'].filter(Boolean).join(' · ')}</span>}
        </span>
      ),
    },
    { key: 'used', header: 'Berkas terunggah', align: 'right', cell: t => <span className="tabular-nums text-xs text-admin-muted">{t._count?.documents ?? 0}</span> },
    { key: 'status', header: 'Status', cell: t => <span className="inline-flex gap-1"><Badge tone={t.isActive ? 'ok' : 'neutral'}>{t.isActive ? 'Aktif' : 'Nonaktif'}</Badge>{t.isSystem && <Badge tone="neutral">Bawaan</Badge>}</span> },
    { key: 'actions', header: '', actions: true, cell: t => <CatalogActions editHref={`${base}/${t.id}`} url={`/api/v1/admin/products/document-types/${t.id}`} subject={`jenis dokumen ${t.label}`} active={t.isActive} onDone={reload} /> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={FileBadge}
        title="Jenis Dokumen"
        description="Katalog dokumen yang bisa diunggah per jamaah (paspor, KTP, dll.). Jenis bawaan hanya bisa dinonaktifkan."
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>}
      />
      <CatalogList<DocumentTypeRow> endpoint="/api/v1/admin/products/document-types" columns={columns} getRowId={t => t.id} status isActive={t => t.isActive} searchPlaceholder="Cari label / kunci…" empty="Belum ada jenis dokumen." />
    </div>
  )
}
