'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { useIdentityAction } from './useIdentityAction'

// Buka NIK utuh — dikonfirmasi, tercatat di jejak identitas (K4). Nilai hanya di memori komponen; disembunyikan lagi dengan satu klik.
export function RevealNik({ identityId, masked }: { identityId: string; masked: string }) {
  const { ask, dialog } = useConfirm()
  const { busy, notice, send } = useIdentityAction()
  const [value, setValue] = useState<string | null>(null)
  async function reveal() {
    if (!(await ask({ title: 'Buka NIK utuh?', body: 'Pembukaan NIK dicatat atas nama Anda di jejak identitas ini.', confirmLabel: 'Buka NIK', tone: 'primary' }))) return
    const r = await send(`/api/v1/admin/identities/${identityId}/reveal`, 'POST', { field: 'nik' }, '', true)
    if (r.ok) setValue((r.data as { value: string }).value)
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-admin-ink">{value ?? masked}</span>
        {value
          ? <button type="button" onClick={() => setValue(null)} className="admin-btn-sm inline-flex items-center gap-1 border border-admin-line bg-white"><EyeOff className="size-3.5" /> Sembunyikan</button>
          : <button type="button" disabled={busy} onClick={reveal} className="admin-btn-sm inline-flex items-center gap-1 border border-admin-line bg-white disabled:opacity-50"><Eye className="size-3.5" /> Buka</button>}
      </div>
      {notice?.error && <p role="alert" className="m-0 text-[12px] text-admin-danger">{notice.text}</p>}
      {dialog}
    </div>
  )
}
