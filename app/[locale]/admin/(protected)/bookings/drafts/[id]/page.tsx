'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Eye, Loader2, Package, Send, Users } from 'lucide-react'
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
import { MODULE_LABEL, type Catalog, type ModuleKey } from './catalog'
import { ItemRows, newRow, rowFromItem, rowToItem, type ItemRow } from './ItemRows'

// Editor draf booking admin (docs/arsitektur-booking-engine-v2.md §10.3, D3): draf tersimpan di database (dapat dilanjutkan). Produk = editor BARIS inline (§10.4, arahan
// pemilik 2026-11-01); subtotal baris, total, pajak, dan pelanggaran aturan dihitung SERVER otomatis sesaat setelah berhenti mengubah (pratinjau = simulasi terbit yang
// di-rollback — angka mengikat). Terbitkan = kuota ditahan + harga dibekukan + invoice terbit, lalu ke detail booking untuk mengisi data jamaah.

type Props = { params: Promise<{ locale: string; id: string }> }
type Violation = { visaName: string; missing: string; severity: 'error' | 'warning'; message: string }
type Preview = { lines: Array<{ label: string; description: string; qty: number; unitPrice: number; amount: number }>; total: number; tax: TaxLine[]; taxAdded: number; grandTotal: number; dueDays: number; warnings: Violation[]; itemTotals: number[] }
type Loaded = { id: string; bookingCode: string; updatedAt: string; draft: BookingDraft; defaultDueDays: number; user: { id: string; fullName: string; email: string; allowVisaWithoutBundle: boolean } }

const MISSING_MODULE: Record<string, ModuleKey> = { flight: 'flight', hotel: 'hotel', transport: 'transport' }
const PREVIEW_DELAY_MS = 800

export default function DraftEditorPage({ params }: Props) {
  const { locale, id } = use(params)
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [rows, setRows] = useState<ItemRow[]>([])
  const [pilgrims, setPilgrims] = useState<BookingDraft['pilgrims']>([{}])
  const [dueDays, setDueDays] = useState<number | undefined>(undefined)
  const [snapshot, setSnapshot] = useState('')
  const [catalog, setCatalog] = useState<Catalog>({})
  const loading = useRef(new Set<ModuleKey>())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [problem, setProblem] = useState<{ message: string; violations: Violation[]; itemIndex?: number; itemTotals?: (number | null)[] } | null>(null)
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
    fetch(`/api/v1/admin/bookings/drafts/${id}`).then(r => r.json()).then((j: { data?: Loaded }) => {
      if (!j.data) { setNotFound(true); return }
      const d = j.data.draft
      setLoaded(j.data); setRows(d.items.map(it => rowFromItem(it))); setPilgrims(d.pilgrims); setDueDays(d.dueDays)
      setSnapshot(JSON.stringify(d))
      void load('visa')
    }).catch(() => setNotFound(true))
  }, [id, load])

  // Isi draf dari baris: baris belum lengkap tidak ikut, tetapi MENAHAN simpan/terbit (ditandai di barisnya).
  const checked = useMemo(() => rows.map(r => rowToItem(r, catalog)), [rows, catalog])
  const incomplete = checked.findIndex(c => 'error' in c)
  const draft: BookingDraft = useMemo(() => ({
    items: checked.flatMap(c => ('item' in c ? [c.item] : [])), pilgrims, ...(dueDays !== undefined && { dueDays }),
  }), [checked, pilgrims, dueDays])
  const draftJson = JSON.stringify(draft)
  const dirty = !!loaded && (draftJson !== snapshot || incomplete >= 0)
  const hasProducts = draft.items.length > 0 || draft.pilgrims.some(p => p.visaProductId)
  useUnsavedGuard(dirty)

  // Pratinjau otomatis: ±0,8 dtk setelah berhenti mengubah, hanya bila semua baris lengkap; respons usang (permintaan lebih lama) diabaikan.
  useEffect(() => {
    if (!loaded || incomplete >= 0 || !hasProducts) { setPreview(null); return }
    const seq = ++previewSeq.current
    const t = setTimeout(async () => {
      setPreviewing(true)
      try {
        const res = await fetch(`/api/v1/admin/bookings/drafts/${id}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }) })
        const json = await res.json().catch(() => null)
        if (seq !== previewSeq.current) return
        if (!res.ok) { setPreview(null); setProblem({ message: json?.error ?? 'Pratinjau gagal.', violations: json?.meta?.violations ?? [], itemIndex: json?.meta?.itemIndex, itemTotals: json?.meta?.itemTotals }) }
        else { setPreview(json.data); setProblem(null) }
      } catch {
        if (seq === previewSeq.current) setProblem({ message: 'Tidak dapat menghubungi server.', violations: [] })
      } finally { if (seq === previewSeq.current) setPreviewing(false) }
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(t)
  }, [draftJson, loaded, incomplete, hasProducts, id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) return <p className="p-6 text-sm text-admin-muted">Draf tidak ditemukan — mungkin sudah diterbitkan atau dihapus.</p>
  if (!loaded) return <div className="flex items-center gap-2 p-6 text-sm text-admin-muted"><Loader2 className="size-4 animate-spin" /> Memuat draf…</div>

  const touched = () => setSaved(false)
  const people = pilgrims.length
  const setPeople = (n: number) => {
    const count = Math.max(1, Math.min(2000, n))
    touched()
    setPilgrims(ps => (count > ps.length ? [...ps, ...Array.from({ length: count - ps.length }, () => ({}))] : ps.slice(0, count)))
  }
  const blockIncomplete = () => {
    if (incomplete < 0) return false
    setProblem({ message: `Baris produk ke-${incomplete + 1} belum lengkap — lengkapi atau hapus barisnya.`, violations: [] })
    return true
  }

  /** Simpan; berhasil → versi tersimpan (`updatedAt`) untuk dikirim saat terbit, gagal → null. */
  async function save(): Promise<string | null> {
    if (blockIncomplete()) return null
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/admin/bookings/drafts/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft, expectedUpdatedAt: loaded!.updatedAt }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setProblem({ message: json?.error ?? 'Draf gagal disimpan.', violations: [] }); return null }
      setLoaded(l => (l ? { ...l, updatedAt: json.data.updatedAt } : l)); setSnapshot(draftJson); setSaved(true)
      return json.data.updatedAt as string
    } catch {
      setProblem({ message: 'Tidak dapat menghubungi server.', violations: [] }); return null
    } finally { setSaving(false) }
  }

  async function publish() {
    if (blockIncomplete()) return
    // Terbit terikat ke versi yang terlihat di tab ini: bila tab lain menyimpan isi berbeda sesudahnya, server menolak (409) alih-alih menerbitkan isi itu.
    const version = dirty ? await save() : loaded!.updatedAt
    if (!version) return
    setPublishing(true); setProblem(null)
    try {
      const body = { expectedUpdatedAt: version, ...(dueDays !== undefined && { dueDays }) }
      const res = await fetch(`/api/v1/admin/bookings/drafts/${id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setProblem({ message: json?.error ?? 'Booking gagal diterbitkan.', violations: json?.meta?.violations ?? [], itemIndex: json?.meta?.itemIndex }); return }
      setSnapshot(draftJson)
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
      setSnapshot(draftJson)
      router.push(`/${locale}/admin/bookings`)
    } finally { setDeleting(false) }
  }

  const visaOptions = (catalog.visa ?? []).map(v => ({ id: v.id, label: v.name }))
  // Subtotal per baris dari pratinjau: urutan `itemTotals` = urutan baris LENGKAP (yang ikut dikirim).
  const rowTotals: (number | undefined)[] = []
  { let k = 0; for (const c of checked) { if (!('item' in c)) { rowTotals.push(undefined); continue } rowTotals.push(preview ? preview.itemTotals[k] : problem?.itemTotals?.[k] ?? undefined); k++ } } // gagal satu baris → subtotal baris lain dari pratinjau parsial

  const main = (
    <>
      <MetaBox title="Produk" icon={Package} collapsible={false} description="Ubah langsung di baris. Subtotal dan total dihitung server otomatis.">
        <ItemRows rows={rows} onChange={r => { touched(); setRows(r) }} catalog={catalog} load={load} defaultPeople={people} totals={rowTotals} computing={previewing}
          rowError={problem?.itemIndex !== undefined ? { index: problem.itemIndex, message: problem.message } : undefined} />
      </MetaBox>

      <MetaBox title="Jamaah" icon={Users} collapsible={false} description="Jumlah orang dan visa per orang. Data jamaah (nama, paspor, …) diisi setelah booking terbit.">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-admin-ink">
            Jumlah jamaah
            <input type="number" min={1} max={2000} className="admin-inp w-24" value={people} onChange={e => setPeople(Number(e.target.value) || 1)} />
          </label>
          <ul className="m-0 list-none space-y-2 p-0">
            {pilgrims.map((p, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 sm:grid-cols-[5rem_minmax(0,1fr)_5rem]">
                <span className="col-span-2 text-xs font-semibold text-admin-muted sm:col-span-1">Jamaah {i + 1}</span>
                <ChoiceSelect ariaLabel={`Visa jamaah ${i + 1}`} size="sm" value={p.visaProductId ?? ''} placeholder="— tanpa visa —" options={visaOptions}
                  onChange={v => { touched(); setPilgrims(ps => ps.map((x, j) => (j === i ? (v ? { ...x, visaProductId: v } : {}) : x))) }} />
                <input type="number" min={1} className="admin-inp" aria-label={`Lama tinggal jamaah ${i + 1}`} placeholder="hari" disabled={!p.visaProductId} value={p.selectedDurationDays ?? ''}
                  onChange={e => { touched(); setPilgrims(ps => ps.map((x, j) => (j === i ? { ...x, selectedDurationDays: Number(e.target.value) > 0 ? Math.trunc(Number(e.target.value)) : undefined } : x))) }} />
              </li>
            ))}
          </ul>
        </div>
      </MetaBox>

      <MetaBox title="Ringkasan invoice" icon={Eye} collapsible={false} aside={previewing ? <span className="flex items-center gap-1 text-xs text-admin-muted"><Loader2 className="size-3.5 animate-spin" /> menghitung…</span> : undefined}
        description="Dihitung server dengan aturan, harga, dan kuota saat ini — angka sama dengan saat diterbitkan.">
        {problem && (
          <div role="alert" className="mb-3 space-y-1 rounded-lg border border-admin-danger/40 bg-admin-danger/5 p-3 text-sm">
            <p className="m-0 flex items-center gap-1.5 font-semibold text-admin-danger"><AlertTriangle className="size-4" /> {problem.message}</p>
            {problem.violations.length > 0 && (
              <ul className="m-0 list-disc space-y-1 pl-5 text-admin-ink">
                {problem.violations.map((v, i) => (
                  <li key={i}>{v.message}{MISSING_MODULE[v.missing] && <> — <button type="button" className="font-semibold text-admin-accent-strong underline" onClick={() => { touched(); setRows(r => [...r, newRow(people, MISSING_MODULE[v.missing])]) }}>tambah baris {MODULE_LABEL[MISSING_MODULE[v.missing]!].toLowerCase()}</button></>}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview ? (
          <div className="space-y-1 text-sm">
            {preview.warnings.length > 0 && (
              <p className="m-0 mb-2 rounded-lg bg-admin-warning/10 p-2 text-xs text-admin-ink">Dilonggarkan untuk pelanggan ini: {preview.warnings.map(w => w.message).join('; ')}</p>
            )}
            {pilgrims.some(p => p.visaProductId) && (
              <p className="m-0 flex justify-between text-admin-ink/80"><span>Visa ({pilgrims.filter(p => p.visaProductId).length} jamaah)</span><span className="tabular-nums">{formatRupiah(preview.total - preview.itemTotals.reduce((s, x) => s + x, 0))}</span></p>
            )}
            <p className="m-0 flex justify-between text-admin-ink/80"><span>Subtotal</span><span className="tabular-nums">{formatRupiah(preview.total)}</span></p>
            {preview.tax.map((t, i) => (
              <p key={i} className="m-0 flex justify-between text-admin-ink/80"><span>{t.name} {t.ratePercent}%{t.mode === 'included' ? ' (termasuk)' : ''}</span><span className="tabular-nums">{formatRupiah(t.amountIdr)}</span></p>
            ))}
            <p className="m-0 flex justify-between border-t border-admin-line-strong pt-2 font-bold text-admin-ink"><span>Total tagihan</span><span className="text-base font-extrabold tabular-nums">{formatRupiah(preview.grandTotal)}</span></p>
            <p className="m-0 text-xs text-admin-muted">Nomor invoice dan pajak dibekukan saat diterbitkan.</p>
          </div>
        ) : !problem && <p className="m-0 text-sm text-admin-muted">{incomplete >= 0 ? 'Lengkapi baris produk untuk menghitung total.' : hasProducts ? 'Menghitung…' : 'Tambahkan produk atau visa jamaah.'}</p>}
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
            <input type="number" min={0} max={365} className="admin-inp w-20" value={dueDays ?? loaded.defaultDueDays}
              onChange={e => { touched(); setDueDays(Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0)))) }} />
          </label>
        }
        hint="Draf belum menahan kuota dan belum terlihat pelanggan. Terbitkan untuk menahan kuota dan membekukan harga." />
      <div className="kartu space-y-2 p-4">
        <Button className="w-full" onClick={publish} loading={publishing} disabled={!hasProducts}><Send className="size-4" /> Terbitkan booking</Button>
        <p className="m-0 text-[11px] text-admin-muted">Pelanggan menerima tautan invoice (email/WhatsApp terverifikasi). Data jamaah diisi di halaman berikutnya.</p>
      </div>
      <DeleteBox confirmText={<>Hapus draf <b>{loaded.bookingCode}</b>? Draf belum punya kuota atau pembayaran — penghapusan permanen.</>} onDelete={remove} deleting={deleting} label="Hapus draf" />
    </>
  )

  return <EditorShell backHref={`/${locale}/admin/bookings`} backLabel="Daftar Booking" title={<>Draf {loaded.bookingCode}</>} main={main} sidebar={sidebar} />
}
