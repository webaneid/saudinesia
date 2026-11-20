'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Landmark } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { adminHref } from '@/lib/admin/href'

// Tambah rekening Platform Provider (Fase 13e-1) — hanya akun Platform Provider (API menolak peran lain).
export default function NewProviderAccountPage() {
  const { locale } = useParams() as { locale: string }
  const list = adminHref(locale, `/admin/system/platform-provider/accounts`)
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/system/platform-provider/accounts', id => `${list}/${id}`, 'Rekening gagal disimpan.')
  const [form, setForm] = useState({ bankName: '', accountNumber: '', accountHolder: '' })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { clearError(); setForm(p => ({ ...p, [k]: e.target.value })) }
  const valid = form.bankName.trim().length >= 2 && /^[0-9\s-]{4,48}$/.test(form.accountNumber.trim()) && form.accountHolder.trim().length >= 2

  return (
    <CreatePage icon={Landmark} title="Rekening Baru" backHref={list} backLabel="Rekening Platform Provider"
      description="Rekening penerimaan bagi hasil. Pencairan menyimpan salinan rekening saat dibayar."
      onSubmit={() => submit(form)} saving={saving} canSubmit={valid} error={error} submitLabel="Simpan rekening">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs text-admin-muted">Nama bank</span><input className="admin-inp" maxLength={100} value={form.bankName} onChange={set('bankName')} /></label>
        <label className="block"><span className="mb-1 block text-xs text-admin-muted">Nomor rekening</span><input className="admin-inp" inputMode="numeric" maxLength={48} value={form.accountNumber} onChange={set('accountNumber')} /></label>
        <label className="block"><span className="mb-1 block text-xs text-admin-muted">Atas nama</span><input className="admin-inp" maxLength={120} value={form.accountHolder} onChange={set('accountHolder')} /></label>
      </div>
    </CreatePage>
  )
}
