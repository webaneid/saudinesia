'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Eye, Loader2, Package, Pencil, Plus, Send, Trash2, Users } from 'lucide-react'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { DeleteBox } from '@/components/admin/editor/DeleteBox'
import { useUnsavedGuard } from '@/components/admin/editor/useUnsavedGuard'
import { Button } from '@/components/admin/ui/Button'
import { Badge } from '@/components/admin/ui/Badge'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { formatRupiah } from '@/lib/utils'
import type { TaxLine } from '@/lib/invoice/tax'
import type { BookingDraft } from '@/lib/validators/booking'
import { AddItemModal, type AddResult } from './AddItemModal'
import { MODULE_LABEL, describeItem, moduleOf, type Catalog, type ModuleKey } from './catalog'

// Editor draf booking admin (docs/arsitektur-booking-engine-v2.md §10.3, D3): draf tersimpan di database (dapat dilanjutkan), pratinjau = simulasi terbit
// di server (angka mengikat, aturan visa, galat kuota), Terbitkan = kuota ditahan + harga dibekukan, lalu ke detail booking untuk mengisi data jamaah.

type Props = { params: Promise<{ locale: string; id: string }> }
type Violation = { visaName: string; missing: string; severity: 'error' | 'warning'; message: string }
type Preview = { lines: Array<{ label: string; description: string; qty: number; unitPrice: number; amount: number }>; total: number; tax: TaxLine[]; taxAdded: number; grandTotal: number; dueDays: number; warnings: Violation[] }
type Loaded = { id: string; bookingCode: string; updatedAt: string; draft: BookingDraft; defaultDueDays: number; user: { id: string; fullName: string; email: string; allowVisaWithoutBundle: boolean } }

const MISSING_MODULE: Record<string, ModuleKey> = { flight: 'flight', hotel: 'hotel', transport: 'transport' }

export default function DraftEditorPage({ params }: Props) {
  const { locale, id } = use(params)
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const [snapshot, setSnapshot] = useState('')
  const [catalog, setCatalog] = useState<Catalog>({})
  const loading = useRef(new Set<ModuleKey>())
  const [modal, setModal] = useState(false)
  const [modalModule, setModalModule] = useState<ModuleKey | undefined>(undefined)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const openModal = (m?: ModuleKey) => { setEditIndex(null); setModalModule(m); setModal(true) }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [problem, setProblem] = useState<{ message: string; violations: Violation[] } | null>(null)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async (m: ModuleKey) => {
    if (loading.current.has(m)) return
    loading.current.add(m)
    const r = await fetch(`/api/v1/admin/bookings/catalog?module=${m}`).then(x => x.json()).catch(() => null)
    if (r?.data !== undefined) setCatalog(c => ({ ...c, [m]: r.data }))
    else loading.current.delete(m)
  }, [])

  useEffect(() => {
    fetch(`/api/v1/admin/bookings/drafts/${id}`).then(r => r.json()).then((j: { data?: Loaded }) => {
      if (!j.data) { setNotFound(true); return }
      setLoaded(j.data); setDraft(j.data.draft); setSnapshot(JSON.stringify(j.data.draft))
      void load('visa')
      for (const it of j.data.draft.items) { const m = moduleOf(it); if (m !== 'haji') void load(m) }
    }).catch(() => setNotFound(true))
  }, [id, load])

  const dirty = !!draft && JSON.stringify(draft) !== snapshot
  useUnsavedGuard(dirty)

  if (notFound) return <p className="p-6 text-sm text-admin-muted">Draf tidak ditemukan — mungkin sudah diterbitkan atau dihapus.</p>
  if (!loaded || !draft) return <div className="flex items-center gap-2 p-6 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat draf…</div>

  const change = (next: BookingDraft) => { setDraft(next); setSaved(false); setPreview(null); setProblem(null) }
  const people = draft.pilgrims.length
  const setPeople = (n: number) => {
    const count = Math.max(1, Math.min(2000, n))
    change({ ...draft, pilgrims: count > people ? [...draft.pilgrims, ...Array.from({ length: count - people }, () => ({}))] : draft.pilgrims.slice(0, count) })
  }

  function onAdd(r: AddResult) {
    if (r.kind === 'item' && editIndex !== null) { change({ ...draft!, items: draft!.items.map((x, j) => (j === editIndex ? r.item : x)) }); setEditIndex(null); return }
    if (r.kind === 'item') { change({ ...draft!, items: [...draft!.items, r.item] }); return }
    // Visa per jamaah: isi jamaah yang belum punya visa lebih dulu, tambah jamaah bila kurang.
    const pilgrims = [...draft!.pilgrims]
    let left = r.count
    for (let i = 0; i < pilgrims.length && left > 0; i++) if (!pilgrims[i]!.visaProductId) { pilgrims[i] = { visaProductId: r.visaProductId, ...(r.days ? { selectedDurationDays: r.days } : {}) }; left-- }
    while (left-- > 0) pilgrims.push({ visaProductId: r.visaProductId, ...(r.days ? { selectedDurationDays: r.days } : {}) })
    change({ ...draft!, pilgrims })
  }

  /** Simpan; berhasil → versi tersimpan (`updatedAt`) untuk dikirim saat terbit, gagal → null. */
  async function save(): Promise<string | null> {
    setSaving(true); setProblem(null)
    try {
      const res = await fetch(`/api/v1/admin/bookings/drafts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft, expectedUpdatedAt: loaded!.updatedAt }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setProblem({ message: json?.error ?? 'Draf gagal disimpan.', violations: [] }); return null }
      setLoaded(l => (l ? { ...l, updatedAt: json.data.updatedAt } : l)); setSnapshot(JSON.stringify(draft)); setSaved(true)
      return json.data.updatedAt as string
    } catch {
      setProblem({ message: 'Tidak dapat menghubungi server.', violations: [] }); return null
    } finally { setSaving(false) }
  }

  async function runPreview() {
    if (dirty && !(await save())) return
    setPreviewing(true); setProblem(null); setPreview(null)
    try {
      const res = await fetch(`/api/v1/admin/bookings/drafts/${id}/preview`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) setProblem({ message: json?.error ?? 'Pratinjau gagal.', violations: json?.meta?.violations ?? [] })
      else setPreview(json.data)
    } catch {
      setProblem({ message: 'Tidak dapat menghubungi server.', violations: [] })
    } finally { setPreviewing(false) }
  }

  async function publish() {
    // Terbit terikat ke versi yang terlihat di tab ini: bila tab lain menyimpan isi berbeda sesudahnya, server menolak (409) alih-alih menerbitkan isi itu.
    const version = dirty ? await save() : loaded!.updatedAt
    if (!version) return
    setPublishing(true); setProblem(null)
    try {
      const body = { expectedUpdatedAt: version, ...(draft!.dueDays !== undefined && { dueDays: draft!.dueDays }) }
      const res = await fetch(`/api/v1/admin/bookings/drafts/${id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setProblem({ message: json?.error ?? 'Booking gagal diterbitkan.', violations: json?.meta?.violations ?? [] }); return }
      setSnapshot(JSON.stringify(draft))
      router.push(`/${locale}/admin/bookings/${id}`)
    } catch {
      setProblem({ message: 'Tidak dapat menghubungi server.', violations: [] })
    } finally { setPublishing(false) }
  }

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/admin/bookings/drafts/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setProblem({ message: json?.error ?? 'Draf gagal dihapus.', violations: [] }); return }
      setSnapshot(JSON.stringify(draft))
      router.push(`/${locale}/admin/bookings`)
    } finally { setDeleting(false) }
  }

  const visaOptions = (catalog.visa ?? []).map(v => ({ id: v.id, label: v.name }))
  const hasProducts = draft.items.length > 0 || draft.pilgrims.some(p => p.visaProductId)

  const main = (
    <>
      <MetaBox title="Produk" icon={Package} collapsible={false} aside={<Button size="sm" onClick={() => openModal()}><Plus className="size-4" /> Tambah produk</Button>}>
        {draft.items.length === 0
          ? <p className="m-0 text-sm text-admin-muted">Belum ada produk. Visa dipasang per jamaah di kotak Jamaah.</p>
          : (
            <ul className="m-0 list-none divide-y divide-admin-line p-0">
              {draft.items.map((it, i) => {
                const d = describeItem(it, catalog)
                return (
                  <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-admin-ink">{d.title}</p>
                      <p className="m-0 text-xs text-admin-muted">{MODULE_LABEL[moduleOf(it)]} · {d.detail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" aria-label={`Ubah ${d.title}`} onClick={() => { setEditIndex(i); setModal(true) }} className="rounded p-1 text-admin-muted hover:text-admin-ink">
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" aria-label={`Hapus ${d.title}`} onClick={() => change({ ...draft, items: draft.items.filter((_, j) => j !== i) })} className="rounded p-1 text-admin-muted hover:text-admin-danger">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </MetaBox>

      <MetaBox title="Jamaah" icon={Users} collapsible={false} description="Jumlah orang dan visa per orang. Data jamaah (nama, paspor, …) diisi setelah booking terbit.">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-admin-ink">
            Jumlah jamaah
            <input type="number" min={1} max={2000} className="admin-inp w-24" value={people} onChange={e => setPeople(Number(e.target.value) || 1)} />
          </label>
          <ul className="m-0 list-none space-y-2 p-0">
            {draft.pilgrims.map((p, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 sm:grid-cols-[5rem_minmax(0,1fr)_5rem]">
                <span className="col-span-2 text-xs font-semibold text-admin-muted sm:col-span-1">Jamaah {i + 1}</span>
                <ChoiceSelect ariaLabel={`Visa jamaah ${i + 1}`} size="sm" value={p.visaProductId ?? ''} placeholder="— tanpa visa —" options={visaOptions}
                  onChange={v => change({ ...draft, pilgrims: draft.pilgrims.map((x, j) => (j === i ? (v ? { ...x, visaProductId: v } : {}) : x)) })} />
                <input type="number" min={1} className="admin-inp" aria-label={`Lama tinggal jamaah ${i + 1}`} placeholder="hari" disabled={!p.visaProductId} value={p.selectedDurationDays ?? ''}
                  onChange={e => change({ ...draft, pilgrims: draft.pilgrims.map((x, j) => (j === i ? { ...x, selectedDurationDays: Number(e.target.value) > 0 ? Math.trunc(Number(e.target.value)) : undefined } : x)) })} />
              </li>
            ))}
          </ul>
        </div>
      </MetaBox>

      <MetaBox title="Pratinjau invoice" icon={Eye} collapsible={false} aside={<Button size="sm" variant="outline" onClick={runPreview} loading={previewing} disabled={!hasProducts}>Hitung pratinjau</Button>}
        description="Disimulasikan di server dengan aturan, harga, dan kuota saat ini — angka sama dengan saat diterbitkan.">
        {problem && (
          <div role="alert" className="mb-3 space-y-1 rounded-lg border border-admin-danger/40 bg-admin-danger/5 p-3 text-sm">
            <p className="m-0 flex items-center gap-1.5 font-semibold text-admin-danger"><AlertTriangle className="size-4" /> {problem.message}</p>
            {problem.violations.length > 0 && (
              <ul className="m-0 list-disc space-y-1 pl-5 text-admin-ink">
                {problem.violations.map((v, i) => (
                  <li key={i}>{v.message}{MISSING_MODULE[v.missing] && <> — <button type="button" className="font-semibold text-admin-accent-strong underline" onClick={() => openModal(MISSING_MODULE[v.missing])}>tambah {MODULE_LABEL[MISSING_MODULE[v.missing]!].toLowerCase()}</button></>}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview ? (
          <div className="space-y-2">
            {preview.warnings.length > 0 && (
              <p className="m-0 rounded-lg bg-admin-warning/10 p-2 text-xs text-admin-ink">Dilonggarkan untuk pelanggan ini: {preview.warnings.map(w => w.message).join('; ')}</p>
            )}
            <ul className="m-0 list-none divide-y divide-admin-line p-0 text-sm" aria-label="Baris invoice">
              {preview.lines.map((l, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0"><span className="font-medium text-admin-ink">{l.label}</span>{l.description && <span className="block text-xs text-admin-muted">{l.description}</span>}</span>
                  <span className="shrink-0 text-right"><span className="block font-semibold tabular-nums">{formatRupiah(l.amount)}</span><span className="block text-xs text-admin-muted tabular-nums">{l.qty} × {formatRupiah(l.unitPrice)}</span></span>
                </li>
              ))}
            </ul>
            {preview.tax.length > 0 && (
              <div className="space-y-1 border-t border-admin-line pt-2 text-sm text-admin-ink/80">
                <p className="m-0 flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatRupiah(preview.total)}</span></p>
                {preview.tax.map((t, i) => (
                  <p key={i} className="m-0 flex justify-between"><span>{t.name} {t.ratePercent}%{t.mode === 'included' ? ' (termasuk)' : ''}</span><span className="tabular-nums">{formatRupiah(t.amountIdr)}</span></p>
                ))}
              </div>
            )}
            <p className="m-0 flex justify-between border-t border-admin-line-strong pt-2 font-bold text-admin-ink"><span>Total tagihan</span><span className="text-base font-extrabold tabular-nums">{formatRupiah(preview.grandTotal)}</span></p>
            <p className="m-0 text-xs text-admin-muted">Nomor invoice dan pajak dibekukan saat diterbitkan.</p>
          </div>
        ) : !problem && <p className="m-0 text-sm text-admin-muted">Tekan "Hitung pratinjau" untuk melihat baris invoice dan total.</p>}
      </MetaBox>
    </>
  )

  const sidebar = (
    <>
      <PublishBox onSave={() => void save()} saving={saving} dirty={dirty} saved={saved && !dirty} canSave={dirty} saveLabel="Simpan draf"
        meta={<span>Pemesan: <b>{loaded.user.fullName}</b>{loaded.user.allowVisaWithoutBundle && <> · <Badge tone="warning">aturan visa dilonggarkan</Badge></>}</span>}
        options={
          <label className="flex items-center justify-between gap-2 text-sm text-admin-ink">
            Jatuh tempo (hari)
            <input type="number" min={0} max={365} className="admin-inp w-20" value={draft.dueDays ?? loaded.defaultDueDays}
              onChange={e => change({ ...draft, dueDays: Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))) })} />
          </label>
        }
        hint="Draf belum menahan kuota dan belum terlihat pelanggan. Terbitkan untuk menahan kuota dan membekukan harga." />
      <div className="kartu space-y-2 p-4">
        <Button className="w-full" onClick={publish} loading={publishing} disabled={!hasProducts}><Send className="size-4" /> Terbitkan booking</Button>
        <p className="m-0 text-[11px] text-admin-muted">Pelanggan belum diberi tahu otomatis (menyusul bersama invoice publik). Data jamaah diisi di halaman berikutnya.</p>
      </div>
      <DeleteBox confirmText={<>Hapus draf <b>{loaded.bookingCode}</b>? Draf belum punya kuota atau pembayaran — penghapusan permanen.</>} onDelete={remove} deleting={deleting} label="Hapus draf" />
    </>
  )

  return (
    <>
      <EditorShell backHref={`/${locale}/admin/bookings`} backLabel="Daftar Booking" title={<>Draf {loaded.bookingCode}</>} main={main} sidebar={sidebar} />
      <AddItemModal open={modal} onClose={() => { setModal(false); setEditIndex(null) }} catalog={catalog} load={load} defaultPeople={people} initialModule={modalModule}
        initialItem={editIndex !== null ? draft.items[editIndex] : undefined} onAdd={onAdd} />
    </>
  )
}
