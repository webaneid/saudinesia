'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Eye, History, Loader2, Package, Pencil, Plus, Tag, Trash2, Users } from 'lucide-react'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { useUnsavedGuard } from '@/components/admin/editor/useUnsavedGuard'
import { Button } from '@/components/admin/ui/Button'
import { Badge } from '@/components/admin/ui/Badge'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { formatRupiah } from '@/lib/utils'
import type { BookingRevisionInput } from '@/lib/validators/booking'
import type { RevisionEditorState } from '@/lib/booking/revise'
import { AddItemModal, type AddResult } from '../../drafts/[id]/AddItemModal'
import { MODULE_LABEL, describeItem, moduleOf, type Catalog, type ModuleKey } from '../../drafts/[id]/catalog'

// Editor REVISI booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b, R1): isi booking sekarang dimuat, beberapa perubahan sekaligus → pratinjau (mesin yang sama,
// di-rollback) → Simpan revisi = SATU revisi invoice + SATU catatan riwayat. Jamaah tampil sebagai "Jamaah ke-N" (data pribadi tetap di form data jamaah).

type Props = { params: Promise<{ locale: string; id: string }> }
type Violation = { missing: string; message: string }
type Item = BookingRevisionInput['items'][number] & { label?: string; detail?: string }
type Pilgrim = BookingRevisionInput['pilgrims'][number] & { position?: number; locked?: boolean; lockReason?: string | null; visaFromPackage?: boolean }
type Change = { kind: string; label: string; detail?: string }
type Preview = {
  lines: Array<{ label: string; description: string; qty: number; unitPrice: number; amount: number }>
  totalBefore: number; totalAfter: number; taxBefore: number; taxAfter: number; grandBefore: number; grandAfter: number; revision: number; changes: Change[]; warnings: Violation[]; notices: string[]
}

const MISSING_MODULE: Record<string, ModuleKey> = { flight: 'flight', hotel: 'hotel', transport: 'transport' }
const CHANGE_LABEL: Record<string, string> = {
  add: 'Ditambah', remove: 'Dihapus', replace: 'Diubah', price: 'Harga khusus', pilgrim_add: 'Jamaah', pilgrim_remove: 'Jamaah dihapus', visa_change: 'Visa', dates: 'Tanggal', total: 'Total',
}

export default function BookingRevisionPage({ params }: Props) {
  const { locale, id } = use(params)
  const router = useRouter()
  const [state, setState] = useState<RevisionEditorState | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [pilgrims, setPilgrims] = useState<Pilgrim[]>([])
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [baseline, setBaseline] = useState('')
  const [catalog, setCatalog] = useState<Catalog>({})
  const loading = useRef(new Set<ModuleKey>())
  const [modal, setModal] = useState(false)
  const [modalModule, setModalModule] = useState<ModuleKey | undefined>(undefined)
  const [priceOpen, setPriceOpen] = useState<number | null>(null)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<{ message: string; violations: Violation[] } | null>(null)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async (m: ModuleKey) => {
    if (loading.current.has(m)) return
    loading.current.add(m)
    const r = await fetch(`/api/v1/admin/bookings/catalog?module=${m}`).then(x => x.json()).catch(() => null)
    if (r?.data !== undefined) setCatalog(c => ({ ...c, [m]: r.data }))
    else loading.current.delete(m)
  }, [])

  useEffect(() => {
    fetch(`/api/v1/admin/bookings/${id}/revision`).then(r => r.json()).then((j: { data?: RevisionEditorState }) => {
      const s = j.data
      if (!s) { setNotFound(true); return }
      const its: Item[] = s.items.map(i => ({ ref: i.ref, item: i.item, customSellIdr: i.customSellIdr, label: i.label, detail: i.detail }))
      const ps: Pilgrim[] = s.pilgrims.map(p => ({
        pilgrimId: p.pilgrimId, visaProductId: p.visaFromPackage ? undefined : p.visaProductId ?? undefined, selectedDurationDays: p.visaFromPackage ? undefined : p.selectedDurationDays ?? undefined,
        position: p.position, locked: p.locked, lockReason: p.lockReason, visaFromPackage: p.visaFromPackage,
      }))
      setState(s); setItems(its); setPilgrims(ps); setInvoiceDate(s.invoiceDate); setDueDate(s.dueDate)
      setBaseline(JSON.stringify({ its, ps, d: [s.invoiceDate, s.dueDate] }))
      void load('visa')
    }).catch(() => setNotFound(true))
  }, [id, load])

  const dirty = !!state && JSON.stringify({ its: items, ps: pilgrims, d: [invoiceDate, dueDate] }) !== baseline
  useUnsavedGuard(dirty && !saving)

  if (notFound) return <p className="p-6 text-sm text-admin-muted">Booking tidak ditemukan atau tidak dapat diedit (hanya booking aktif).</p>
  if (!state) return <div className="flex items-center gap-2 p-6 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat booking…</div>

  const touched = () => { setPreview(null); setError(null) }
  const needReason = state.confirmed || state.hasPayments
  const body = (): BookingRevisionInput => ({
    expectedRevision: state.revision, invoiceDate, dueDate, reason: reason.trim() || undefined,
    items: items.map(({ ref, item, customSellIdr, priceNote }) => ({ ...(ref && { ref }), item, ...(customSellIdr != null && { customSellIdr, priceNote }) })),
    pilgrims: pilgrims.map(({ pilgrimId, visaProductId, selectedDurationDays }) => ({ ...(pilgrimId && { pilgrimId }), ...(visaProductId && { visaProductId, ...(selectedDurationDays && { selectedDurationDays }) }) })),
  })

  async function call(path: string, method: 'POST' | 'PUT') {
    const res = await fetch(`/api/v1/admin/bookings/${id}/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })
    const json = await res.json().catch(() => null)
    return { res, json }
  }
  async function runPreview() {
    setPreviewing(true); setError(null); setPreview(null)
    try {
      const { res, json } = await call('revision/preview', 'POST')
      if (!res.ok) setError({ message: json?.error ?? 'Pratinjau gagal.', violations: json?.meta?.violations ?? [] })
      else setPreview(json.data)
    } catch { setError({ message: 'Tidak dapat menghubungi server.', violations: [] }) } finally { setPreviewing(false) }
  }
  async function save() {
    setSaving(true); setError(null)
    try {
      const { res, json } = await call('revision', 'PUT')
      if (!res.ok) { setError({ message: json?.error ?? 'Revisi gagal disimpan.', violations: json?.meta?.violations ?? [] }); return }
      setBaseline(JSON.stringify({ its: items, ps: pilgrims, d: [invoiceDate, dueDate] }))
      router.push(`/${locale}/admin/bookings/${id}`)
    } catch { setError({ message: 'Tidak dapat menghubungi server.', violations: [] }) } finally { setSaving(false) }
  }

  function onAdd(r: AddResult) {
    touched()
    // Ubah item lama: rujukannya (`ref`) tetap — mesin revisi memperlakukannya sebagai GANTI (kuota lama dilepas, versi baru ditahan); label lama dibuang supaya ringkasan dari katalog.
    if (r.kind === 'item' && editIndex !== null) { setItems(xs => xs.map((x, j) => (j === editIndex ? { ...x, item: r.item, label: undefined, detail: undefined } : x))); setEditIndex(null); return }
    if (r.kind === 'item') { setItems(xs => [...xs, { item: r.item }]); return }
    setPilgrims(ps => [...ps, ...Array.from({ length: r.count }, () => ({ visaProductId: r.visaProductId, ...(r.days ? { selectedDurationDays: r.days } : {}) }))])
  }
  const visaOptions = (catalog.visa ?? []).map(v => ({ id: v.id, label: v.name }))
  const setItem = (i: number, patch: Partial<Item>) => { touched(); setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  const setPilgrim = (i: number, patch: Partial<Pilgrim>) => { touched(); setPilgrims(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x))) }

  const main = (
    <>
      <MetaBox title="Produk" icon={Package} collapsible={false} aside={<Button size="sm" onClick={() => { setEditIndex(null); setModalModule(undefined); setModal(true) }}><Plus className="size-4" /> Tambah produk</Button>}
        description="Menghapus atau mengubah produk melepas kuotanya; produk baru menahan kuota saat revisi disimpan.">
        {items.length === 0 ? <p className="m-0 text-sm text-admin-muted">Tidak ada produk.</p> : (
          <ul className="m-0 list-none divide-y divide-admin-line p-0">
            {items.map((it, i) => {
              const d = it.label ? { title: it.label, detail: it.detail ?? '' } : describeItem(it.item, catalog)
              return (
                <li key={i} className="space-y-2 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-admin-ink">{d.title} {!it.ref && <Badge tone="accent">baru</Badge>} {it.customSellIdr != null && <Badge tone="warning">harga khusus {formatRupiah(it.customSellIdr)}</Badge>}</p>
                      <p className="m-0 text-xs text-admin-muted">{MODULE_LABEL[moduleOf(it.item)]} · {d.detail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" aria-label={`Ubah ${d.title}`} onClick={() => { setEditIndex(i); setModalModule(undefined); setModal(true) }} className="rounded p-1 text-admin-muted hover:text-admin-ink"><Pencil className="size-4" /></button>
                      <button type="button" aria-label={`Harga khusus ${d.title}`} onClick={() => setPriceOpen(priceOpen === i ? null : i)} className="rounded p-1 text-admin-muted hover:text-admin-ink"><Tag className="size-4" /></button>
                      <button type="button" aria-label={`Hapus ${d.title}`} onClick={() => { touched(); setItems(xs => xs.filter((_, j) => j !== i)) }} className="rounded p-1 text-admin-muted hover:text-admin-danger"><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                  {priceOpen === i && (
                    <div className="grid gap-2 rounded-lg bg-admin-canvas p-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                      <input type="number" min={1} className="admin-inp" aria-label="Harga khusus item (Rp)" placeholder="Harga khusus (Rp)" value={it.customSellIdr ?? ''}
                        onChange={e => setItem(i, { customSellIdr: Number(e.target.value) > 0 ? Number(e.target.value) : null })} />
                      <input className="admin-inp" aria-label="Catatan harga khusus" maxLength={300} placeholder="Catatan (wajib bila harga khusus diisi)" value={it.priceNote ?? ''}
                        onChange={e => setItem(i, { priceNote: e.target.value })} />
                      <p className="m-0 text-[11px] text-admin-muted sm:col-span-2">Kosongkan untuk kembali ke harga normal. Modal (HPP) tidak berubah — laporan untung tetap memakai modal asli.</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </MetaBox>

      <MetaBox title="Jamaah" icon={Users} collapsible={false} description="Tambah jamaah kapan saja. Hapus atau ganti visa hanya bila visanya belum diproses dan belum ada dokumen.">
        <ul className="m-0 list-none space-y-2 p-0">
          {pilgrims.map((p, i) => {
            const name = p.pilgrimId ? `Jamaah ke-${p.position}` : 'Jamaah baru'
            const visaLocked = !!p.locked || !!p.visaFromPackage
            return (
              <li key={p.pilgrimId ?? `baru-${i}`} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-x-2 gap-y-1">
                <span className="col-span-3 text-xs font-semibold text-admin-muted">{name}</span>
                {p.visaFromPackage
                  ? <span className="text-xs text-admin-muted">Visa dari paket</span>
                  : <ChoiceSelect ariaLabel={`Visa ${name}`} size="sm" value={p.visaProductId ?? ''} placeholder="— tanpa visa —" options={visaOptions} disabled={visaLocked}
                      onChange={v => setPilgrim(i, v ? { visaProductId: v } : { visaProductId: undefined, selectedDurationDays: undefined })} />}
                <input type="number" min={1} className="admin-inp" aria-label={`Lama tinggal ${name}`} placeholder="hari" disabled={visaLocked || !p.visaProductId} value={p.selectedDurationDays ?? ''}
                  onChange={e => setPilgrim(i, { selectedDurationDays: Number(e.target.value) > 0 ? Math.trunc(Number(e.target.value)) : undefined })} />
                <button type="button" aria-label={`Hapus ${name}`} title={p.lockReason ?? undefined} disabled={!!p.locked || pilgrims.length <= 1}
                  onClick={() => { touched(); setPilgrims(xs => xs.filter((_, j) => j !== i)) }} className="rounded p-1 text-admin-muted hover:text-admin-danger disabled:opacity-40">
                  <Trash2 className="size-4" />
                </button>
                {p.locked && <span className="col-span-3 text-[11px] text-admin-muted">{p.lockReason} — urus lewat modul Visa.</span>}
              </li>
            )
          })}
        </ul>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => { touched(); setPilgrims(ps => [...ps, {}]) }}><Plus className="size-4" /> Tambah jamaah</Button>
      </MetaBox>

      <MetaBox title="Pratinjau revisi" icon={Eye} collapsible={false} aside={<Button size="sm" variant="outline" onClick={runPreview} loading={previewing}>Hitung pratinjau</Button>}
        description="Disimulasikan di server dengan mesin yang sama — angka, kuota, dan aturan visa sama dengan saat disimpan.">
        {error && (
          <div role="alert" className="mb-3 space-y-1 rounded-lg border border-admin-danger/40 bg-admin-danger/5 p-3 text-sm">
            <p className="m-0 flex items-center gap-1.5 font-semibold text-admin-danger"><AlertTriangle className="size-4" /> {error.message}</p>
            {error.violations.length > 0 && (
              <ul className="m-0 list-disc space-y-1 pl-5 text-admin-ink">
                {error.violations.map((v, i) => (
                  <li key={i}>{v.message}{MISSING_MODULE[v.missing] && <> — <button type="button" className="font-semibold text-admin-accent-strong underline" onClick={() => { setEditIndex(null); setModalModule(MISSING_MODULE[v.missing]); setModal(true) }}>tambah {MODULE_LABEL[MISSING_MODULE[v.missing]!].toLowerCase()}</button></>}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview ? (
          <div className="space-y-3 text-sm">
            {preview.notices.map((n, i) => <p key={i} className="m-0 flex items-start gap-1.5 rounded-lg bg-admin-warning/10 p-2 text-xs text-admin-ink"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {n}</p>)}
            <ul className="m-0 list-none space-y-1 p-0" aria-label="Perubahan">
              {preview.changes.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2"><Badge tone="neutral">{CHANGE_LABEL[c.kind] ?? c.kind}</Badge><span className="font-medium text-admin-ink">{c.label}</span>{c.detail && <span className="text-xs text-admin-muted">{c.detail}</span>}</li>
              ))}
            </ul>
            <ul className="m-0 list-none divide-y divide-admin-line border-t border-admin-line p-0" aria-label="Baris invoice sesudah revisi">
              {preview.lines.map((l, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0"><span className="font-medium text-admin-ink">{l.label}</span>{l.description && <span className="block text-xs text-admin-muted">{l.description}</span>}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatRupiah(l.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="space-y-1 border-t border-admin-line-strong pt-2">
              <p className="m-0 flex justify-between text-admin-ink/80"><span>Subtotal</span><span className="tabular-nums">{formatRupiah(preview.totalBefore)} → {formatRupiah(preview.totalAfter)}</span></p>
              <p className="m-0 flex justify-between text-admin-ink/80"><span>Pajak</span><span className="tabular-nums">{formatRupiah(preview.taxBefore)} → {formatRupiah(preview.taxAfter)}</span></p>
              <p className="m-0 flex justify-between font-bold text-admin-ink"><span>Total tagihan</span><span className="tabular-nums">{formatRupiah(preview.grandBefore)} → {formatRupiah(preview.grandAfter)}</span></p>
              <p className="m-0 text-xs text-admin-muted">Disimpan sebagai Revisi ke-{preview.revision}. Pelanggan tidak diberi tahu otomatis.</p>
            </div>
          </div>
        ) : !error && <p className="m-0 text-sm text-admin-muted">Tekan "Hitung pratinjau" untuk melihat perubahan, baris invoice, dan total baru.</p>}
      </MetaBox>
    </>
  )

  const sidebar = (
    <>
      <PublishBox onSave={() => void save()} saving={saving} dirty={dirty} canSave={dirty || reason.trim() !== ''} saveLabel="Simpan revisi"
        meta={<span>Revisi sekarang: <b>ke-{state.revision}</b>{state.confirmed && <> · <Badge tone="ok">dikonfirmasi</Badge></>}{state.hasPayments && <> · <Badge tone="warning">ada pembayaran</Badge></>}</span>}
        options={
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-2 text-sm text-admin-ink">Tanggal invoice
              <input type="date" className="admin-inp w-40" value={invoiceDate} onChange={e => { touched(); setInvoiceDate(e.target.value) }} />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-admin-ink">Jatuh tempo
              <input type="date" className="admin-inp w-40" min={invoiceDate} value={dueDate} onChange={e => { touched(); setDueDate(e.target.value) }} />
            </label>
            <label className="block text-sm text-admin-ink">Alasan revisi{needReason && <span className="text-admin-danger"> *</span>}
              <textarea className="admin-inp mt-1 min-h-20 w-full" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}
                placeholder={needReason ? 'Wajib — booking sudah dikonfirmasi / ada pembayaran' : 'Opsional (internal, tidak tampil di invoice)'} />
            </label>
          </div>
        }
        hint="Satu simpan = satu revisi invoice dan satu catatan di riwayat. Catatan bersifat internal." />
      <div className="kartu space-y-2 p-4 text-[12px] text-admin-muted">
        <p className="m-0 flex items-center gap-1.5 font-semibold text-admin-ink"><History className="size-4" /> Riwayat</p>
        <p className="m-0">Riwayat revisi tampil di halaman detail booking.</p>
      </div>
    </>
  )

  return (
    <>
      <EditorShell backHref={`/${locale}/admin/bookings/${id}`} backLabel="Detail booking" title={<>Edit booking</>} main={main} sidebar={sidebar} />
      <AddItemModal open={modal} onClose={() => { setModal(false); setEditIndex(null) }} catalog={catalog} load={load} defaultPeople={pilgrims.length} initialModule={modalModule}
        initialItem={editIndex !== null ? items[editIndex]?.item : undefined} onAdd={onAdd} />
    </>
  )
}
