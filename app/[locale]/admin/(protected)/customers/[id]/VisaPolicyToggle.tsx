'use client'

import { useState } from 'react'
import { Switch } from '@/components/admin/ui/Switch'

// Pelonggaran aturan visa per pelanggan (docs/arsitektur-booking-engine-v2.md D5): pelanggaran `requiredComponents` visa menjadi peringatan, booking boleh lanjut.
// Disimpan langsung; perubahannya tercatat di jejak audit. Hasil server ditampilkan apa adanya; gagal → saklar kembali ke nilai sebelumnya.
export function VisaPolicyToggle({ customerId, initial }: { customerId: string; initial: boolean }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  async function change(next: boolean) {
    setBusy(true); setNotice(null); setValue(next)
    try {
      const res = await fetch(`/api/v1/admin/customers/${customerId}/policy`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowVisaWithoutBundle: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setValue(!next); setNotice({ text: json?.error ?? 'Perubahan gagal disimpan.', error: true }); return }
      setNotice({ text: 'Tersimpan.', error: false })
    } catch {
      setValue(!next); setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
    } finally { setBusy(false) }
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="m-0 text-sm font-semibold text-admin-ink">Boleh pesan visa tanpa pesawat dan hotel</p>
        <p className="m-0 text-xs text-admin-muted">Aturan wajib pada produk visa hanya menjadi peringatan untuk pelanggan ini.</p>
        {notice && <p role={notice.error ? 'alert' : 'status'} className={`m-0 mt-1 text-[12px] font-medium ${notice.error ? 'text-admin-danger' : 'text-admin-ok'}`}>{notice.text}</p>}
      </div>
      <Switch checked={value} onChange={change} disabled={busy} label="Boleh pesan visa tanpa pesawat dan hotel" />
    </div>
  )
}
