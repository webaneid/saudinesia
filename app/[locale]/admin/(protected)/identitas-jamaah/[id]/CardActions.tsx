'use client'

import { useState } from 'react'
import { BadgeCheck, KeyRound, Pin, Unlink } from 'lucide-react'
import { ActionButton } from '@/components/admin/data-table/RowActions'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { useIdentityAction } from './useIdentityAction'

type Props = { identityId: string; cardId: string; name: string; status: 'matched' | 'conflict' | 'unmatched'; confirmed: boolean; hasPassport: boolean }

// Aksi kartu dalam identitas (§4.4): orang yang sama (cocok manual), NIK tidak sesuai (lepas + pesan generik ke pemilik), jadikan data kanonik,
// buka nomor paspor (berjejak).
export function CardActions({ identityId, cardId, name, status, confirmed, hasPassport }: Props) {
  const { ask, dialog } = useConfirm()
  const { busy, notice, send } = useIdentityAction()
  const [passport, setPassport] = useState<string | null>(null)
  const base = `/api/v1/admin/identities/${identityId}`
  const act = async (action: 'confirm' | 'detach' | 'pin', title: string, body: string, label: string, done: string, tone: 'danger' | 'primary' = 'primary') => {
    if (await ask({ title, body, confirmLabel: label, tone })) await send(`${base}/cards/${cardId}`, 'POST', { action }, done)
  }
  return (
    <>
        {status === 'conflict' && !confirmed && (
          <ActionButton icon={BadgeCheck} label={`Orang yang sama: ${name}`} disabled={busy}
            onClick={() => act('confirm', 'Tandai orang yang sama?', 'Perbedaan nama/tanggal lahir dianggap beda penulisan. Tanda ini gugur bila NIK, nama, atau tanggal lahir kartu diubah.', 'Tandai cocok', 'Kartu ditandai cocok.')} />
        )}
        <ActionButton icon={Pin} label={`Jadikan data kanonik: ${name}`} disabled={busy}
          onClick={() => act('pin', 'Jadikan data kartu ini data kanonik?', 'Nama, jenis kelamin, tempat/tanggal lahir, dan kewarganegaraan identitas diganti dengan data kartu ini.', 'Jadikan kanonik', 'Data kanonik diperbarui.')} />
        {hasPassport && (
          <ActionButton icon={KeyRound} label={`Buka nomor paspor: ${name}`} disabled={busy}
            onClick={async () => {
              if (!(await ask({ title: 'Buka nomor paspor utuh?', body: 'Pembukaan dicatat atas nama Anda di jejak identitas ini.', confirmLabel: 'Buka', tone: 'primary' }))) return
              const r = await send(`${base}/reveal`, 'POST', { field: 'passport', cardId }, '', true)
              if (r.ok) setPassport((r.data as { value: string }).value)
            }} />
        )}
        <ActionButton icon={Unlink} tone="danger" label={`Lepas kartu: ${name}`} disabled={busy}
          onClick={() => act('detach', 'Lepas kartu ini (NIK tidak sesuai)?', 'Kartu dilepas dari identitas. Pemilik kartu melihat pesan "Mohon periksa kembali NIK" dan kartu tidak ditautkan ulang sampai NIK diubah.', 'Lepas', 'Kartu dilepas.', 'danger')} />
      {passport && <span className="font-mono text-[12px] text-admin-ink">Paspor: {passport}</span>}
      {notice && <span role={notice.error ? 'alert' : 'status'} className={`text-[12px] ${notice.error ? 'text-admin-danger' : 'text-admin-muted'}`}>{notice.text}</span>}
      {dialog}
    </>
  )
}
