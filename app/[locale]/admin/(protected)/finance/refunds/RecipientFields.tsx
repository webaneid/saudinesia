'use client'

// Rekening TUJUAN pelanggan (SEC-244, §10.13) — dipakai formulir Buat Refund dan detail refund (ubah/bayar). Kosong semua = belum diisi.
export type RecipientValue = { bank: string; accountNumber: string; accountName: string }
export const EMPTY_RECIPIENT: RecipientValue = { bank: '', accountNumber: '', accountName: '' }

/** null = kosong semua; 'partial' = sebagian terisi (ditolak sebelum dikirim); selain itu objek siap kirim. */
export function recipientPayload(v: RecipientValue): RecipientValue | null | 'partial' {
  const t = { bank: v.bank.trim(), accountNumber: v.accountNumber.trim(), accountName: v.accountName.trim() }
  const filled = [t.bank, t.accountNumber, t.accountName].filter(Boolean).length
  if (filled === 0) return null
  return filled === 3 ? t : 'partial'
}

/** `stacked` = satu kolom (kotak samping sempit di halaman detail). */
export function RecipientFields({ value, onChange, stacked = false }: { value: RecipientValue; onChange: (v: RecipientValue) => void; stacked?: boolean }) {
  const set = (k: keyof RecipientValue) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className={stacked ? 'space-y-3' : 'grid gap-3 md:grid-cols-3'}>
      <label className="block"><span className="mb-1 block text-xs text-admin-muted">Bank tujuan</span><input className="admin-inp" maxLength={80} placeholder="mis. BCA" value={value.bank} onChange={set('bank')} /></label>
      <label className="block"><span className="mb-1 block text-xs text-admin-muted">Nomor rekening</span><input className="admin-inp" inputMode="numeric" maxLength={40} value={value.accountNumber} onChange={set('accountNumber')} /></label>
      <label className="block"><span className="mb-1 block text-xs text-admin-muted">Nama pemilik rekening</span><input className="admin-inp" maxLength={120} value={value.accountName} onChange={set('accountName')} /></label>
    </div>
  )
}
