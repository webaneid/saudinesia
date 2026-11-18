import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { ActionLink, RowActions } from '@/components/admin/data-table/RowActions'
import { listProviderAccounts, type ProviderBankAccount } from '@/lib/revenue-share/accounts'

// Rekening penerimaan Platform Provider (Fase 13e-1, docs/arsitektur-bagi-hasil.md §5e). Superadmin melihat (klien mentransfer ke sini); hanya akun
// Platform Provider yang menambah/mengubah/menghapus (dijaga API). Master data kecil (≤ 100 rekening).
export default async function ProviderAccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  const rows = await listProviderAccounts()
  const base = `/${locale}/admin/system/platform-provider/accounts`
  const columns: Column<ProviderBankAccount>[] = [
    { key: 'bank', header: 'Bank', mobile: 'title', cell: r => <span className="text-[13px] font-medium text-admin-ink">{r.bankName}</span> },
    { key: 'num', header: 'Nomor', cell: r => <span className="text-[12px] tabular-nums">{r.accountNumber}</span> },
    { key: 'holder', header: 'Atas nama', cell: r => <span className="text-[12px]">{r.accountHolder}</span> },
    { key: 'st', header: 'Status', cell: r => <Badge tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'actions', header: '', actions: true, cell: r => <RowActions><ActionLink kind={session.isPlatformProvider ? 'edit' : 'view'} href={`${base}/${r.id}`} label={`Buka rekening ${r.bankName} ${r.accountNumber}`} /></RowActions> },
  ]
  return (
    <div className="space-y-5">
      <PageHeader title="Rekening Platform Provider" description="Rekening tujuan pencairan bagi hasil. Hanya akun Platform Provider yang dapat menambah atau mengubah rekening."
        actions={session.isPlatformProvider ? <Link href={`${base}/new`} className="admin-btn"><Plus className="size-4" /> Tambah Rekening</Link> : undefined} />
      <DataTable columns={columns} rows={rows} getRowId={r => r.id} empty="Belum ada rekening Platform Provider." />
    </div>
  )
}
