'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Eye, History, Loader2, Package, Plus, Trash2, Users } from 'lucide-react'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { useUnsavedGuard } from '@/components/admin/editor/useUnsavedGuard'
import { Button } from '@/components/admin/ui/Button'
import { Badge } from '@/components/admin/ui/Badge'
import { formatRupiah } from '@/lib/utils'
import type { BookingRevisionInput } from '@/lib/validators/booking'
import type { RevisionEditorState } from '@/lib/booking/revise'
import type { Catalog, ModuleKey } from '../../drafts/[id]/catalog'
import { ItemRows, rowForMissing, rowFromItem, rowToItem, type ItemRow } from '../../drafts/[id]/ItemRows'
import { applyVisaRows, lockedMembers, syncVisaCounts, visaRowTotal, visaRowsFromSlots } from '../../drafts/[id]/visaRows'

// Editor REVISI booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b, R1): isi booking sekarang dimuat, beberapa perubahan sekaligus → pratinjau (mesin yang sama,
// di-rollback) → Simpan revisi = SATU revisi invoice + SATU catatan riwayat. Jamaah tampil sebagai "Jamaah ke-N" (data pribadi tetap di form data jamaah).

type Props = { params: Promise<{ locale: string; id: string }> }
type Violation = { missing: string; message: string }
/** Slot jamaah revisi; `row` = baris Visa pemiliknya (../../drafts/[id]/visaRows.ts), `visaPriceIdr` = harga visa tersimpan (subtotal sebelum pratinjau). */
type Pilgrim = BookingRevisionInput['pilgrims'][number] & { position?: number; locked?: boolean; lockReason?: string | null; visaFromPackage?: boolean; row?: string; visaPriceIdr?: number }
type Change = { kind: string; label: string; detail?: string }
type Preview = {
  lines: Array<{ label: string; description: string; qty: number; unitPrice: number; amount: number }>
  totalBefore: number; totalAfter: number; taxBefore: number; taxAfter: number; grandBefore: number; grandAfter: number; revision: number; changes: Change[]; notices: string[]; itemTotals: number[]; pilgrimVisaTotals: number[]
}

const PREVIEW_DELAY_MS = 800
/** Sidik isi editor (tanpa kunci baris acak) — penanda belum-disimpan. */
const fingerprint = (rows: ItemRow[], ps: Pilgrim[], invoiceDate: string, dueDate: string) =>
  JSON.stringify({ r: rows.map(r => [r.ref?.itemId ?? null, r.module, r.f, r.customSellIdr ?? null, r.priceNote ?? '']), p: ps.map(p => [p.pilgrimId ?? null, p.visaProductId ?? null, p.selectedDurationDays ?? null]), d: [invoiceDate, dueDate] })
const CHANGE_LABEL: Record<string, string> = {
  add: 'Ditambah', remove: 'Dihapus', replace: 'Diubah', price: 'Harga khusus', pilgrim_add: 'Jamaah', pilgrim_remove: 'Jamaah dihapus', visa_change: 'Visa', dates: 'Tanggal', total: 'Total',
}

export default function BookingRevisionPage({ params }: Props) {
  const { locale, id } = use(params)
  const router = useRouter()
  const [state, setState] = useState<RevisionEditorState | null>(null)
  const [rows, setRows] = useState<ItemRow[]>([])
  const [pilgrims, setPilgrims] = useState<Pilgrim[]>([])
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [reason, setReason] = useState('')
  const [baseline, setBaseline] = useState('')
  const [catalog, setCatalog] = useState<Catalog>({})
  const loading = useRef(new Set<ModuleKey>())
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<{ message: string; violations: Violation[]; itemIndex?: number; itemTotals?: (number | null)[] } | null>(null)
  const [notFound, setNotFound] = useState(false)
  const previewSeq = useRef(0)

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
      const rs = s.items.map(i => rowFromItem(i.item, { ref: i.ref, label: i.label, customSellIdr: i.customSellIdr }))
      const ps: Pilgrim[] = s.pilgrims.map(p => ({
        pilgrimId: p.pilgrimId, visaProductId: p.visaFromPackage ? undefined : p.visaProductId ?? undefined, selectedDurationDays: p.visaFromPackage ? undefined : p.selectedDurationDays ?? undefined,
        position: p.position, locked: p.locked, lockReason: p.lockReason, visaFromPackage: p.visaFromPackage, visaPriceIdr: p.visaPriceIdr,
      }))
      const v = visaRowsFromSlots(ps)
      const all = [...v.rows, ...rs]
      setState(s); setRows(all); setPilgrims(v.slots); setInvoiceDate(s.invoiceDate); setDueDate(s.dueDate)
      setBaseline(fingerprint(all, v.slots, s.invoiceDate, s.dueDate))
      void load('visa')
    }).catch(() => setNotFound(true))
  }, [id, load])

  const checked = useMemo(() => rows.map(r => rowToItem(r, catalog)), [rows, catalog])
  const incomplete = checked.findIndex(c => 'error' in c)
  const dirty = !!state && fingerprint(rows, pilgrims, invoiceDate, dueDate) !== baseline
  const body = useMemo((): BookingRevisionInput | null => {
    if (!state || incomplete >= 0) return null
    return {
      expectedRevision: state.revision, invoiceDate, dueDate, reason: reason.trim() || undefined,
      items: rows.flatMap((r, i) => { const c = checked[i]!; return 'item' in c ? [{ ...(r.ref && { ref: r.ref }), item: c.item, ...(r.customSellIdr != null && { customSellIdr: r.customSellIdr, priceNote: r.priceNote }) }] : [] }), // baris Visa → `pilgrims`
      pilgrims: pilgrims.map(({ pilgrimId, visaProductId, selectedDurationDays }) => ({ ...(pilgrimId && { pilgrimId }), ...(visaProductId && { visaProductId, ...(selectedDurationDays && { selectedDurationDays }) }) })),
    }
  }, [state, incomplete, invoiceDate, dueDate, reason, rows, checked, pilgrims])
  const previewJson = body && dirty ? JSON.stringify({ ...body, reason: undefined }) : ''
  useUnsavedGuard(dirty && !saving)

  // Pratinjau otomatis ±0,8 dtk setelah berhenti mengubah (hanya bila ada perubahan dan semua baris lengkap); respons usang diabaikan.
  useEffect(() => {
    if (!previewJson) { setPreview(null); return }
    const seq = ++previewSeq.current
    const t = setTimeout(async () => {
      setPreviewing(true)
      try {
        const res = await fetch(`/api/v1/admin/bookings/${id}/revision/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: previewJson })
        const json = await res.json().catch(() => null)
        if (seq !== previewSeq.current) return
        if (!res.ok) { setPreview(null); setError({ message: json?.error ?? 'Pratinjau gagal.', violations: json?.meta?.violations ?? [], itemIndex: json?.meta?.itemIndex, itemTotals: json?.meta?.itemTotals }) }
        else { setPreview(json.data); setError(null) }
      } catch {
        if (seq === previewSeq.current) setError({ message: 'Tidak dapat menghubungi server.', violations: [] })
      } finally { if (seq === previewSeq.current) setPreviewing(false) }
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(t)
  }, [previewJson, id])

  if (notFound) return <p className="p-6 text-sm text-admin-muted">Booking tidak ditemukan atau tidak dapat diedit (hanya booking aktif).</p>
  if (!state) return <div className="flex items-center gap-2 p-6 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat booking…</div>

  const needReason = state.confirmed || state.hasPayments

  async function save() {
    if (incomplete >= 0 || !body) { setError({ message: `Baris produk ke-${incomplete + 1} belum lengkap — lengkapi atau hapus barisnya.`, violations: [] }); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/bookings/${id}/revision`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError({ message: json?.error ?? 'Revisi gagal disimpan.', violations: json?.meta?.violations ?? [], itemIndex: json?.meta?.itemIndex }); return }
      setBaseline(fingerprint(rows, pilgrims, invoiceDate, dueDate))
      router.push(`/${locale}/admin/bookings/${id}`)
    } catch { setError({ message: 'Tidak dapat menghubungi server.', violations: [] }) } finally { setSaving(false) }
  }

  const changeRows = (r: ItemRow[]) => { const next = applyVisaRows(pilgrims, r, () => ({})); setPilgrims(next); setRows(syncVisaCounts(r, next)) }
  const removePilgrim = (i: number) => { const next = pilgrims.filter((_, j) => j !== i); setPilgrims(next); setRows(rs => syncVisaCounts(rs, next)) }
  const visaName = (id?: string) => catalog.visa?.find(v => v.id === id)?.name ?? 'Visa'
  const visaLocks = Object.fromEntries(rows.filter(r => r.module === 'visa').map(r => [r.key, lockedMembers(pilgrims, r.key)]))
  const freeSlots = pilgrims.filter(p => !p.row && !p.visaProductId && !p.visaFromPackage && !p.locked).length
  // Subtotal per baris: item = urutan item yang dikirim; baris Visa = Σ visa anggotanya (pratinjau server bila ada perubahan, harga tersimpan bila belum).
  const itemRowIndex: number[] = []
  const rowTotals = checked.map((c, i) => {
    if ('visa' in c) return dirty ? visaRowTotal(pilgrims, rows[i]!.key, preview?.pilgrimVisaTotals) : visaRowTotal(pilgrims, rows[i]!.key, pilgrims.map(p => p.visaPriceIdr ?? 0))
    if (!('item' in c)) return undefined
    const k = itemRowIndex.push(i) - 1
    return dirty ? (preview?.itemTotals[k] ?? error?.itemTotals?.[k] ?? undefined) : state.items[k]?.priceIdr
  })
  const errorRow = error?.itemIndex !== undefined ? itemRowIndex[error.itemIndex] : undefined

  const main = (
    <>
      <MetaBox title="Produk" icon={Package} collapsible={false}
        description="Ubah langsung di baris. Mengubah/menghapus produk melepas kuotanya; produk baru ditahan (pending) saat revisi disimpan.">
        <ItemRows rows={rows} onChange={changeRows} catalog={catalog} load={load} defaultPeople={pilgrims.length} defaultVisaPeople={freeSlots} visaLocks={visaLocks} totals={rowTotals} computing={previewing} customPrice
          rowError={errorRow !== undefined && error ? { index: errorRow, message: error.message } : undefined} />
      </MetaBox>

      <MetaBox title="Jamaah" icon={Users} collapsible={false} description="Tambah jamaah kapan saja. Visa diatur di baris Visa (Produk); jamaah yang visanya sudah diproses atau memakai data tersimpan tidak bisa dihapus.">
        <ul className="m-0 list-none space-y-2 p-0">
          {pilgrims.map((p, i) => {
            const name = p.pilgrimId ? `Jamaah ke-${p.position}` : 'Jamaah baru'
            const visa = p.visaFromPackage ? 'Visa dari paket' : p.visaProductId ? `${visaName(p.visaProductId)}${p.selectedDurationDays ? ` · ${p.selectedDurationDays} hari` : ''}` : 'Tanpa visa'
            return (
              <li key={p.pilgrimId ?? `baru-${i}`} className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-x-2 gap-y-0.5">
                <span className="min-w-0"><span className="block text-xs font-semibold text-admin-ink">{name}</span><span className="block text-xs text-admin-muted">{visa}</span></span>
                <button type="button" aria-label={`Hapus ${name}`} title={p.lockReason ?? undefined} disabled={!!p.locked || pilgrims.length <= 1}
                  onClick={() => removePilgrim(i)} className="rounded p-1 text-admin-muted hover:text-admin-danger disabled:opacity-40">
                  <Trash2 className="size-4" />
                </button>
                {p.locked && <span className="col-span-2 text-[11px] text-admin-muted">{p.lockReason} — urus lewat modul Visa.</span>}
              </li>
            )
          })}
        </ul>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setPilgrims(ps => [...ps, {}])}><Plus className="size-4" /> Tambah jamaah</Button>
      </MetaBox>

      <MetaBox title="Ringkasan revisi" icon={Eye} collapsible={false} aside={previewing ? <span className="flex items-center gap-1 text-xs text-admin-muted"><Loader2 className="size-3.5 animate-spin" /> menghitung…</span> : undefined}
        description="Dihitung server otomatis dengan mesin yang sama — angka, kuota, dan aturan visa sama dengan saat disimpan.">
        {error && (
          <div role="alert" className="mb-3 space-y-1 rounded-lg border border-admin-danger/40 bg-admin-danger/5 p-3 text-sm">
            <p className="m-0 flex items-center gap-1.5 font-semibold text-admin-danger"><AlertTriangle className="size-4" /> {error.message}</p>
            {error.violations.length > 0 && (
              <ul className="m-0 list-disc space-y-1 pl-5 text-admin-ink">
                {error.violations.map((v, i) => (
                  <li key={i}>{v.message}{(() => { const add = rowForMissing(pilgrims.length, v.missing); return add && <> — <button type="button" className="font-semibold text-admin-accent-strong underline" onClick={() => changeRows([...rows, add.row])}>tambah baris {add.label}</button></> })()}</li>
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
        ) : !error && <p className="m-0 text-sm text-admin-muted">{incomplete >= 0 ? 'Lengkapi baris produk untuk menghitung total.' : dirty ? 'Menghitung…' : 'Belum ada perubahan.'}</p>}
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
              <input type="date" className="admin-inp w-40" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm text-admin-ink">Jatuh tempo
              <input type="date" className="admin-inp w-40" min={invoiceDate} value={dueDate} onChange={e => setDueDate(e.target.value)} />
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

  return <EditorShell backHref={`/${locale}/admin/bookings/${id}`} backLabel="Detail booking" title={<>Edit booking</>} main={main} sidebar={sidebar} />
}
