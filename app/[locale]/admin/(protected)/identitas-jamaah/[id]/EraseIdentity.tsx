'use client'

import { useRouter } from 'next/navigation'
import { DeleteBox } from '@/components/admin/editor/DeleteBox'
import { useIdentityAction } from './useIdentityAction'

// Hapus identitas atas permintaan subjek data (§4.4): hanya bila tak pernah dipakai booking — server menolak dengan pesan bila pernah.
export function EraseIdentity({ locale, identityId, usedByBookings }: { locale: string; identityId: string; usedByBookings: boolean }) {
  const router = useRouter()
  const { busy, notice, send } = useIdentityAction()
  return (
    <div className="space-y-1.5">
      <DeleteBox
        label="Hapus identitas" deleting={busy}
        confirmText={usedByBookings
          ? 'Identitas ini pernah dipakai booking — penghapusan akan ditolak sampai prosedur retensi diputuskan.'
          : 'NIK tersegel, data kanonik, alias, dan jejak identitas ini dihapus. Kartu milik akun pelanggan tetap ada (dilepas dari identitas).'}
        onDelete={async () => {
          const r = await send(`/api/v1/admin/identities/${identityId}`, 'DELETE', undefined, '', false)
          if (r.ok) router.push(`/${locale}/admin/identitas-jamaah`)
        }}
      />
      {notice?.error && <p role="alert" className="m-0 text-[12px] text-admin-danger">{notice.text}</p>}
    </div>
  )
}
