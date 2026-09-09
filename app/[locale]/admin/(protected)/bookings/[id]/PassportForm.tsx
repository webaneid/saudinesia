'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'

interface PassportFormProps {
  pilgrimId: string
  initial: { passportNumber: string; passportExpiry: string; nationality: string; dateOfBirth: string }
}

export function PassportForm({ pilgrimId, initial }: PassportFormProps) {
  const [data,    setData]    = useState(initial)
  const [loading, setLoading] = useState(false)
  const [saved,   setSaved]   = useState(false)

  function set(k: keyof typeof data) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setData(p => ({ ...p, [k]: e.target.value })); setSaved(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    const res  = await fetch(`/api/v1/admin/pilgrims/${pilgrimId}/passport`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (json.success) setSaved(true)
    setLoading(false)
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <div>
        <p className="text-[10.5px] text-slate-500 mb-1 font-medium">No. Paspor</p>
        <input className="admin-inp-xs" value={data.passportNumber} onChange={set('passportNumber')} placeholder="A1234567" />
      </div>
      <div>
        <p className="text-[10.5px] text-slate-500 mb-1 font-medium">Exp. Paspor</p>
        <input type="date" className="admin-inp-xs" value={data.passportExpiry} onChange={set('passportExpiry')} />
      </div>
      <div>
        <p className="text-[10.5px] text-slate-500 mb-1 font-medium">Tanggal Lahir</p>
        <input type="date" className="admin-inp-xs" value={data.dateOfBirth} onChange={set('dateOfBirth')} />
      </div>
      <div className="flex items-end">
        <button onClick={handleSave} disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-ink hover:bg-ink2 text-[11px] font-medium text-white disabled:opacity-50 w-full justify-center transition-colors">
          <Save className="h-3 w-3" />
          {saved ? 'Tersimpan ✓' : loading ? '...' : 'Simpan'}
        </button>
      </div>
    </div>
  )
}
