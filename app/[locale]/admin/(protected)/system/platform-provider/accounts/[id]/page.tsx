'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Landmark } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'

type Account = { id: string; bankName: string; accountNumber: string; accountHolder: string; isActive: boolean; payoutCount: number; canEdit: boolean }

// Ubah rekening Platform Provider (Fase 13e-1). Superadmin klien hanya melihat; simpan/hapus hanya akun Platform Provider (dijaga API).
export default function EditProviderAccountPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/system/platform-provider/accounts`
  const e = useEditEntity<Account>(`/api/v1/admin/system/platform-provider/accounts/${id}`, list)
  const [form, setForm] = useState<{ bankName: string; accountNumber: string; accountHolder: string; isActive: boolean } | null>(null)
  useEffect(() => { if (e.item) setForm({ bankName: e.item.bankName, accountNumber: e.item.accountNumber, accountHolder: e.item.accountHolder, isActive: e.item.isActive }) }, [e.item])

  if (e.missing) return <p className="text-sm text-admin-muted">Rekening tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form || !e.item) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>
  const canEdit = e.item.canEdit
  const set = (k: 'bankName' | 'accountNumber' | 'accountHolder') => (ev: React.ChangeEvent<HTMLInputElement>) => { e.clearMessages(); setForm(p => p && ({ ...p, [k]: ev.target.value })) }
  const valid = form.bankName.trim().length >= 2 && /^[0-9\s-]{4,48}$/.test(form.accountNumber.trim()) && form.accountHolder.trim().length >= 2

  return (
    <EditPage icon={Landmark} title={canEdit ? 'Ubah Rekening' : 'Rekening Platform Provider'} backHref={list} backLabel="Rekening Platform Provider"
      description={e.item.payoutCount > 0 ? `Dipakai ${e.item.payoutCount} pencairan — pencairan menyimpan salinan rekening saat dibayar, jadi perubahan di sini tak mengubah riwayat.` : 'Rekening penerimaan bagi hasil.'}
      onSubmit={() => e.save(form)} saving={e.saving} canSubmit={canEdit && valid} error={e.error} notice={e.notice}
      active={form.isActive} onActiveChange={canEdit ? v => { e.clearMessages(); setForm(p => p && ({ ...p, isActive: v })) } : undefined}
      remove={canEdit ? { confirmText: e.item.payoutCount > 0 ? 'Rekening sudah dipakai pencairan — akan dinonaktifkan. Lanjutkan?' : 'Hapus rekening ini secara permanen?', onDelete: e.remove, deleting: e.deleting } : undefined}>
      <fieldset disabled={!canEdit} className="m-0 grid gap-3 border-0 p-0 md:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs text-admin-muted">Nama bank</span><input className="admin-inp" maxLength={100} value={form.bankName} onChange={set('bankName')} /></label>
        <label className="block"><span className="mb-1 block text-xs text-admin-muted">Nomor rekening</span><input className="admin-inp" inputMode="numeric" maxLength={48} value={form.accountNumber} onChange={set('accountNumber')} /></label>
        <label className="block"><span className="mb-1 block text-xs text-admin-muted">Atas nama</span><input className="admin-inp" maxLength={120} value={form.accountHolder} onChange={set('accountHolder')} /></label>
      </fieldset>
      {!canEdit && <p className="m-0 mt-3 text-[12px] text-admin-muted">Hanya akun Platform Provider yang dapat mengubah atau menghapus rekening ini.</p>}
    </EditPage>
  )
}
