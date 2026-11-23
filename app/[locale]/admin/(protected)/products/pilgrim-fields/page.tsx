'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Plus, ClipboardList } from 'lucide-react'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import type { Column } from '@/components/admin/data-table/DataTable'
import { CatalogActions, CatalogList } from '@/components/admin/data-table/CatalogList'
import { FIELD_TYPE_LABEL, type ManifestFieldType } from '@/lib/manifest/fieldDefs'
import type { PilgrimFieldRow } from '@/components/admin/pilgrim-data/pilgrimFieldForm'
import { adminHref } from '@/lib/admin/href'

// Produk → Data Jamaah (docs/arsitektur-data-jamaah.md §3.1, D2): SATU daftar kolom data jamaah untuk semua produk — pola sama Jenis Dokumen.

export default function PilgrimFieldsPage() {
  const { locale } = useParams() as { locale: string }
  const base = adminHref(locale, `/admin/products/pilgrim-fields`)
  const columns = (reload: () => void): Column<PilgrimFieldRow>[] => [
    {
      key: 'label', header: 'Kolom', mobile: 'title',
      cell: f => <Link href={`${base}/${f.id}`} className="font-semibold hover:text-admin-accent-strong">{f.label}</Link>,
    },
    { key: 'key', header: 'Kode', hideBelowLg: true, cell: f => <code className="rounded bg-admin-spot px-1.5 py-0.5 text-xs text-admin-ink">{f.key}</code> },
    { key: 'type', header: 'Tipe', cell: f => <span className="whitespace-nowrap text-xs text-admin-muted">{FIELD_TYPE_LABEL[f.fieldType as ManifestFieldType] ?? f.fieldType}</span> },
    { key: 'required', header: 'Sifat', cell: f => <span className="whitespace-nowrap text-xs text-admin-muted">{f.required ? 'Wajib' : 'Opsional'}</span> },
    { key: 'status', header: 'Status', cell: f => <span className="inline-flex gap-1"><Badge tone={f.isActive ? 'ok' : 'neutral'}>{f.isActive ? 'Aktif' : 'Nonaktif'}</Badge>{f.isSystem && <Badge tone="neutral">Bawaan</Badge>}</span> },
    {
      key: 'actions', header: '', actions: true,
      cell: f => f.role === 'display_name'
        ? <CatalogActions editHref={`${base}/${f.id}`} subject={`kolom ${f.label}`} onDone={reload} />
        : <CatalogActions editHref={`${base}/${f.id}`} url={`/api/v1/admin/products/pilgrim-fields/${f.id}`} subject={`kolom ${f.label}`} active={f.isActive} onDone={reload} />,
    },
  ]
  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardList}
        title="Data Jamaah"
        description="Daftar kolom data jamaah untuk semua produk. Kolom aktif diminta dari jamaah pada produk yang menyalakan “minta data jamaah”. Kolom bawaan hanya bisa dinonaktifkan."
        actions={<Link href={`${base}/new`} className="admin-btn"><Plus className="h-4 w-4" /> Tambah</Link>}
      />
      <CatalogList<PilgrimFieldRow> endpoint="/api/v1/admin/products/pilgrim-fields" columns={columns} getRowId={f => f.id} status isActive={f => f.isActive} searchPlaceholder="Cari label / kode…" empty="Belum ada kolom data jamaah." />
    </div>
  )
}
