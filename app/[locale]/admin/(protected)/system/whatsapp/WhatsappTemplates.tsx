'use client'

import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Pencil, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { Switch } from '@/components/admin/ui/Switch'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import {
  WA_SAMPLE, WA_TEMPLATE_DEFS, WA_TEMPLATE_MAX, WA_VAR_LABEL, renderTemplate, templateProblem, type WaTemplateKey,
} from '@/lib/whatsapp/templateDefs'

export type WaTemplateView = { key: WaTemplateKey; body: string | null; enabled: boolean; updatedAt: string }

/** Pratinjau format WhatsApp: *tebal* dan _miring_ sebagai elemen React (tanpa HTML mentah). */
function waFormat(text: string): ReactNode[] {
  return text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, i) => {
    if (/^\*[^*\n]+\*$/.test(part)) return <strong key={i}>{part.slice(1, -1)}</strong>
    if (/^_[^_\n]+_$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

async function save(key: WaTemplateKey, payload: { body: string | null; enabled: boolean; expectedUpdatedAt: string }) {
  const r = await fetch(`/api/v1/admin/system/whatsapp/templates/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const j = (await r.json().catch(() => null)) as { success: boolean; data?: WaTemplateView; error?: string } | null
  if (j?.success && j.data) return { ok: true as const, data: j.data }
  return { ok: false as const, error: j?.error ?? `Galat server (HTTP ${r.status})` }
}

function TemplateCard({ initial }: { initial: WaTemplateView }) {
  const def = WA_TEMPLATE_DEFS[initial.key]
  const [tpl, setTpl] = useState(initial)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const { ask, dialog } = useConfirm()

  const current = tpl.body ?? def.defaultBody
  const editing = draft !== null
  const problem = editing ? templateProblem(tpl.key, draft) : null

  async function commit(body: string | null, enabled: boolean): Promise<boolean> {
    setBusy(true); setError(null); setSaved(false)
    const r = await save(tpl.key, { body, enabled, expectedUpdatedAt: tpl.updatedAt })
    setBusy(false)
    if (!r.ok) { setError(r.error); return false }
    setTpl(r.data); setSaved(true)
    return true
  }

  function insert(v: string) {
    const el = area.current
    const token = `{{${v}}}`
    if (!el || draft === null) return
    const start = el.selectionStart ?? draft.length, end = el.selectionEnd ?? draft.length
    const next = `${draft.slice(0, start)}${token}${draft.slice(end)}`
    setDraft(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) })
  }

  async function reset() {
    const yes = await ask({ title: 'Kembalikan teks bawaan?', body: 'Teks kustom template ini diganti teks bawaan.', confirmLabel: 'Ya, kembalikan', tone: 'primary' })
    if (yes && (await commit(null, tpl.enabled))) setDraft(null)
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-sm font-semibold text-admin-ink">{def.label}</h3>
            {tpl.body !== null && <Badge tone="accent">Kustom</Badge>}
            {!tpl.enabled && <Badge tone="warning">WhatsApp mati</Badge>}
          </div>
          <p className="m-0 text-xs text-admin-muted">{def.when}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-admin-muted">
          <span>{tpl.enabled ? 'Aktif' : 'Nonaktif'}</span>
          <Switch checked={tpl.enabled} disabled={busy} label={`Kirim WhatsApp: ${def.label}`} onChange={v => void commit(tpl.body, v)} />
        </div>
      </div>

      {!editing && (
        <>
          <div className="whitespace-pre-wrap rounded-xl border border-admin-line bg-admin-spot p-3 text-sm text-admin-ink">{waFormat(renderTemplate(current, WA_SAMPLE))}</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { setDraft(current); setError(null); setSaved(false) }}><Pencil className="size-4" aria-hidden /> Edit teks</Button>
            {tpl.body !== null && <Button size="sm" variant="ghost" onClick={() => void reset()} disabled={busy}><RotateCcw className="size-4" aria-hidden /> Kembalikan bawaan</Button>}
          </div>
        </>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" aria-label="Sisipkan variabel">
            {def.vars.map(v => (
              <button key={v} type="button" onClick={() => insert(v)} title={WA_VAR_LABEL[v]}
                className="rounded-lg border border-admin-line bg-white px-2 py-1 font-mono text-xs text-admin-ink hover:border-admin-accent hover:text-admin-accent">
                {`{{${v}}}`}{def.required.includes(v) ? ' *' : ''}
              </button>
            ))}
          </div>
          <textarea
            ref={area} value={draft} onChange={e => setDraft(e.target.value)} rows={7} maxLength={WA_TEMPLATE_MAX}
            aria-label={`Teks template ${def.label}`} className="admin-inp w-full font-mono text-sm"
          />
          <p className="m-0 text-xs text-admin-muted">
            Klik variabel untuk menyisipkan (* = wajib). Format WhatsApp: *tebal*, _miring_. Baris yang semua variabelnya kosong tidak ikut terkirim. {draft.length}/{WA_TEMPLATE_MAX}
          </p>
          <div>
            <p className="m-0 mb-1 text-xs font-semibold text-admin-muted">Pratinjau (contoh nilai)</p>
            <div className="whitespace-pre-wrap rounded-xl border border-admin-line bg-admin-spot p-3 text-sm text-admin-ink">{waFormat(renderTemplate(draft, WA_SAMPLE))}</div>
          </div>
          {problem && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{problem}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} disabled={problem !== null} onClick={async () => { if (await commit(draft, tpl.enabled)) setDraft(null) }}>Simpan</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(null) }}>Batal</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(def.defaultBody)}><RotateCcw className="size-4" aria-hidden /> Isi teks bawaan</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{error}</p>}
      {saved && !error && <p role="status" className="m-0 text-xs font-medium text-admin-ok">Tersimpan.</p>}
      {dialog}
    </Card>
  )
}

export function WhatsappTemplates({ templates }: { templates: WaTemplateView[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="m-0 text-base font-semibold text-admin-ink">Template pesan</h2>
        <p className="m-0 text-sm text-admin-muted">Teks notifikasi WhatsApp ke jamaah. Saklar mematikan WhatsApp untuk notifikasi itu saja; email tetap terkirim.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {templates.map(t => <TemplateCard key={t.key} initial={t} />)}
      </div>
    </section>
  )
}
