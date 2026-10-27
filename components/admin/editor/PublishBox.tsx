'use client'

import type { ReactNode } from 'react'
import { Loader2, Save } from 'lucide-react'
import { Switch } from '@/components/admin/ui/Switch'
import { Badge } from '@/components/admin/ui/Badge'
import { MetaBox } from './MetaBox'

type Props = {
  /** Status aktif entitas (katalog/pilihan baru). */
  active: boolean
  onActiveChange: (active: boolean) => void
  /** Opsi tambahan di bawah status (mis. "Tampilkan di halaman utama"). */
  options?: ReactNode
  /** Baris informasi kecil (mis. "Dibuat 12 Okt 2026"). */
  meta?: ReactNode
  /** Kalimat penjelas apa yang disimpan tombol ini (kejujuran perilaku: kotak komponen tersimpan langsung). */
  hint?: ReactNode
  onSave: () => void | Promise<void>
  saving: boolean
  /** Ada perubahan yang belum disimpan. */
  dirty: boolean
  /** Baru saja berhasil disimpan (indikator sementara). */
  saved: boolean
  canSave: boolean
  saveLabel?: string
}

/** Kotak "Terbitkan" ala WordPress: status, opsi, info, dan tombol Simpan dengan penanda perubahan belum disimpan. */
export function PublishBox({ active, onActiveChange, options, meta, hint, onSave, saving, dirty, saved, canSave, saveLabel = 'Simpan perubahan' }: Props) {
  return (
    <MetaBox title="Terbitkan" collapsible={false}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-admin-ink">Status</span>
        <span className="flex items-center gap-2">
          <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Aktif' : 'Nonaktif'}</Badge>
          <Switch checked={active} onChange={onActiveChange} label="Aktif" />
        </span>
      </div>
      {options && <div className="space-y-2 border-t border-admin-line pt-3">{options}</div>}
      {meta && <div className="text-[11px] text-admin-muted">{meta}</div>}
      {hint && <p className="m-0 text-[11px] text-admin-muted">{hint}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-admin-line pt-3">
        <span role="status" className="text-[11px] font-medium text-admin-muted">
          {saved ? 'Tersimpan ✓' : dirty ? 'Ada perubahan belum disimpan' : ''}
        </span>
        <button type="button" onClick={() => void onSave()} disabled={saving || !canSave || !dirty} className="admin-btn disabled:opacity-50">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? 'Menyimpan…' : saveLabel}
        </button>
      </div>
    </MetaBox>
  )
}
