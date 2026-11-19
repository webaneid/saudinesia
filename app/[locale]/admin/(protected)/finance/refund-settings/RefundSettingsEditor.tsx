'use client'

import { useState } from 'react'
import { Scale, ShieldCheck } from 'lucide-react'
import type { RefundApprovalMode } from '@prisma/client'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { useUnsavedGuard } from '@/components/admin/editor/useUnsavedGuard'
import { FormField } from '@/components/admin/ui/FormField'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { APPROVAL_MODE_LABEL, FORCE_MAJEURE_LABEL } from '@/lib/refunds/labels'
import type { RefundSettingsDto } from '@/lib/refunds/settings'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'

const MODES = Object.keys(APPROVAL_MODE_LABEL) as RefundApprovalMode[]
const isMode = (v: string): v is RefundApprovalMode => (MODES as string[]).includes(v)

// Tabel kebijakan pembatalan ditampilkan apa adanya (lib/utils/cancellationPolicy.ts) — sumbernya tetap kode.
const POLICY = [['Lebih dari 60 hari sebelum berangkat', '100%'], ['30–60 hari', '50%'], ['Kurang dari 30 hari', '0%']] as const

export function RefundSettingsEditor({ initial }: { initial: RefundSettingsDto }) {
  const [loaded, setLoaded] = useState(initial)
  const [mode, setMode] = useState<RefundApprovalMode>(initial.approvalMode)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = mode !== loaded.approvalMode
  useUnsavedGuard(dirty)

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/v1/admin/finance/refund-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalMode: mode, expectedUpdatedAt: loaded.updatedAt }),
      })
      const j = await res.json().catch(() => null) as { success?: boolean; data?: RefundSettingsDto; error?: string } | null
      if (!res.ok || !j?.success || !j.data) { setError(j?.error ?? 'Gagal menyimpan'); return }
      setLoaded(j.data); setMode(j.data.approvalMode); setSaved(true)
    } catch { setError('Gagal menyimpan — periksa koneksi') } finally { setSaving(false) }
  }

  return (
    <EditorShell
      backHref="/admin/finance/refunds" backLabel="Refund"
      title={<h1 className="m-0 text-2xl font-bold text-admin-ink">Kebijakan Refund</h1>}
      banner={error ? <p role="alert" className="m-0 rounded-xl border border-admin-danger/30 bg-admin-danger/5 px-3 py-2 text-sm font-medium text-admin-danger">{error}</p> : undefined}
      main={
        <>
          <MetaBox title="Persetujuan superadmin" icon={ShieldCheck} description="Kapan refund PEMBATALAN wajib disetujui superadmin. Refund kelebihan bayar tidak terkena aturan ini.">
            <FormField label="Wajib superadmin bila" htmlFor="refund-approval-mode">
              <ChoiceSelect clearable={false} options={MODES.map(m => ({ id: m, label: APPROVAL_MODE_LABEL[m].label }))} value={mode} onChange={v => { if (isMode(v)) { setMode(v); setSaved(false) } }} ariaLabel="Aturan persetujuan superadmin" />
            </FormField>
            <p className="m-0 mt-2 text-sm text-admin-muted">{APPROVAL_MODE_LABEL[mode].hint}</p>
          </MetaBox>
          <MetaBox title="Kebijakan pembatalan" icon={Scale} description="Saran refund saat booking dibatalkan, dihitung dari uang yang sudah masuk. Refund di atas kebijakan wajib ditandai force-majeure.">
            <ul className="m-0 list-none space-y-1.5 p-0 text-sm">
              {POLICY.map(([when, pct]) => (
                <li key={when} className="flex items-center justify-between gap-3 rounded-lg border border-admin-line px-3 py-2"><span>{when}</span><span className="font-semibold text-admin-ink">{pct}</span></li>
              ))}
            </ul>
            <p className="m-0 mt-3 text-sm text-admin-muted">Kategori force-majeure: {Object.values(FORCE_MAJEURE_LABEL).join(' · ')}.</p>
          </MetaBox>
        </>
      }
      sidebar={
        <PublishBox
          onSave={save} saving={saving} dirty={dirty} saved={saved && !dirty} canSave={dirty} saveLabel="Simpan kebijakan"
          meta={<>Terakhir diubah {formatInstant(loaded.updatedAt, DATETIME_MEDIUM)}</>}
        />
      }
    />
  )
}
