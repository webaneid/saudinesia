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
import { formatRupiah } from '@/lib/utils'
import type { TaxLine } from '@/lib/invoice/tax'
import type { BookingDraft } from '@/lib/validators/booking'
import type { Catalog, ModuleKey } from './catalog'
import { ItemRows, rowForMissing, rowFromItem, rowToItem, type ItemRow } from './ItemRows'
import { applyVisaRows, stripRow, syncVisaCounts, visaRowTotal, visaRowsFromSlots, type VisaSlot } from './visaRows'
import { grouping, groupsInput, removeGroup, resizeGroup, startGroups, type GroupDraft } from './groupRows'
import { GroupsBox } from './GroupsBox'

// Editor draf booking admin (docs/arsitektur-booking-engine-v2.md §10.3, D3): draf tersimpan di database (dapat dilanjutkan). Produk = editor BARIS inline (§10.4, arahan
// pemilik 2026-11-01); subtotal baris, total, pajak, dan pelanggaran aturan dihitung SERVER otomatis sesaat setelah berhenti mengubah (pratinjau = simulasi terbit yang
// di-rollback — angka mengikat). Terbitkan = kuota ditahan + harga dibekukan + invoice terbit, lalu ke detail booking untuk mengisi data jamaah.

type Props = { params: Promise<{ locale: string; id: string }> }
type Violation = { visaName: string; missing: string; message: string }
type Preview = { lines: Array<{ label: string; description: string; qty: number; unitPrice: number; amount: number }>; total: number; tax: TaxLine[]; taxAdded: number; grandTotal: number; dueDays: number; itemTotals: number[]; pilgrimVisaTotals: number[] }
type Loaded = { id: string; bookingCode: string; updatedAt: string; draft: BookingDraft; defaultDueDays: number; activeBankCount: number; user: { id: string; fullName: string; email: string } }

const PREVIEW_DELAY_MS = 800

export default function DraftEditorPage({ params }: Props) {
  const { locale, id } = use(params)
  const router = useRouter()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [rows, setRows] = useState<ItemRow[]>([])
  // Slot jamaah draf (visa per orang); baris Visa di editor produk adalah kelompok atas slot ini (./visaRows.ts).
  const [pilgrims, setPilgrims] = useState<VisaSlot[]>([{}])
  // Rombongan (§10.8): ≥ 2 atau kosong; slot jamaah dan baris menunjuknya lewat indeks.
  const [groups, setGroups] = useState<GroupDraft[]>([])
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
      const v = visaRowsFromSlots<VisaSlot>(d.pilgrims)
      setLoaded(j.data); setRows([...v.rows, ...d.items.map(it => rowFromItem(it))]); setPilgrims(v.slots); setDueDays(d.dueDays)
      setGroups((d.groups ?? []).map(g => ({ label: g.label ?? '', plannedTravelDate: g.plannedTravelDate ?? '' })))
      setSnapshot(JSON.stringify(d))
      void load('visa')
    }).catch(() => setNotFound(true))
  }, [id, load])

  // Isi draf dari baris: baris belum lengkap tidak ikut, tetapi MENAHAN simpan/terbit (ditandai di barisnya).
  const g = useMemo(() => grouping(groups, pilgrims), [groups, pilgrims])
  const checked = useMemo(() => rows.map(r => rowToItem(r, catalog, g)), [rows, catalog, g])
  const incomplete = checked.findIndex(c => 'error' in c)
  const draft: BookingDraft = useMemo(() => ({
    items: checked.flatMap(c => ('item' in c ? [c.item] : [])), pilgrims: pilgrims.map(stripRow), ...(groups.length >= 2 && { groups: groupsInput(groups) }), ...(dueDays !== undefined && { dueDays }),
  }), [checked, pilgrims, groups, dueDays])
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
  const withVisa = pilgrims.filter(p => p.row).length
  // Mengurangi jamaah hanya membuang slot TANPA visa (dari belakang); slot bervisa dikurangi lewat jumlah orang di baris Visa-nya.
  const setPeople = (n: number) => {
    const count = Math.max(1, withVisa, Math.min(2000, n))
    touched()
    if (count >= pilgrims.length) { setPilgrims([...pilgrims, ...Array.from({ length: count - pilgrims.length }, () => ({}))]); return }
    let drop = pilgrims.length - count
    const next: VisaSlot[] = []
    for (let i = pilgrims.length - 1; i >= 0; i--) {
      const p = pilgrims[i]!
      if (drop > 0 && !p.row) { drop--; continue }
      next.unshift(p)
    }
    setPilgrims(next); setRows(rs => syncVisaCounts(rs, next))
  }
  const changeRows = (r: ItemRow[]) => {
    touched()
    const next = applyVisaRows(pilgrims, r, () => ({}))
    setPilgrims(next); setRows(syncVisaCounts(r, next))
  }
  const applyGroups = (x: { groups: GroupDraft[]; slots: VisaSlot[]; rows: ItemRow[] }) => {
    touched(); setGroups(x.groups); setPilgrims(x.slots); setRows(syncVisaCounts(x.rows, x.slots))
  }
  const groupSizes = groups.map((_, i) => pilgrims.filter(p => p.group === i).length)
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

  // Subtotal per baris dari pratinjau: urutan `itemTotals` = urutan baris ITEM lengkap (yang ikut dikirim); baris Visa = Σ visa anggotanya (`pilgrimVisaTotals`).
  const rowTotals: (number | undefined)[] = []
  const itemRowIndex: number[] = [] // nomor item server (`meta.itemIndex`) → nomor baris editor
  checked.forEach((c, i) => {
    if ('visa' in c) { rowTotals.push(visaRowTotal(pilgrims, rows[i]!.key, preview?.pilgrimVisaTotals)); return }
    if (!('item' in c)) { rowTotals.push(undefined); return }
    const k = itemRowIndex.push(i) - 1
    rowTotals.push(preview ? preview.itemTotals[k] : problem?.itemTotals?.[k] ?? undefined) // gagal satu baris → subtotal baris lain dari pratinjau parsial
  })
  const errorRow = problem?.itemIndex !== undefined ? itemRowIndex[problem.itemIndex] : undefined

  const main = (
    <>
      <MetaBox title="Produk" icon={Package} collapsible={false} description="Ubah langsung di baris. Subtotal dan total dihitung server otomatis.">
        <ItemRows rows={rows} onChange={changeRows} catalog={catalog} load={load} defaultPeople={people} defaultVisaPeople={people - withVisa} totals={rowTotals} computing={previewing} grouping={g}
          rowError={errorRow !== undefined && problem ? { index: errorRow, message: problem.message } : undefined} />
      </MetaBox>

      <GroupsBox groups={groups} sizes={groupSizes} onChange={gs => { touched(); setGroups(gs) }}
        onStart={() => applyGroups(startGroups(pilgrims, rows, [{}]))}
        onAdd={() => applyGroups({ groups: [...groups, { label: '', plannedTravelDate: '' }], slots: [...pilgrims, { group: groups.length }], rows })}
        onRemove={i => applyGroups(removeGroup(groups, pilgrims, rows, i, true))}
        resize={{ min: groups.map((_, i) => pilgrims.filter(p => p.group === i && p.row).length), set: (i, n) => applyGroups({ groups, slots: resizeGroup(pilgrims, i, n, () => ({})), rows }) }} />

      <MetaBox title="Jamaah" icon={Users} collapsible={false} description="Jumlah orang dalam booking ini. Data jamaah (nama, paspor, …) diisi setelah booking terbit.">
        <div className="space-y-2">
          {g ? <p className="m-0 text-sm text-admin-ink">Jumlah jamaah: <b>{people}</b> <span className="text-admin-muted">(jumlah semua rombongan — ubah di kotak Rombongan)</span></p> : (
            <label className="flex items-center gap-2 text-sm text-admin-ink">
              Jumlah jamaah
              <input type="number" min={Math.max(1, withVisa)} max={2000} className="admin-inp w-24" value={people} onChange={e => setPeople(Number(e.target.value) || 1)} />
            </label>
          )}
          <p className="m-0 text-xs text-admin-muted">
            {withVisa > 0 ? <>{withVisa} dari {people} jamaah memegang visa dari baris Visa di atas.</> : <>Belum ada visa — tambahkan baris Visa di Produk bila booking ini menjual visa.</>}
          </p>
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
                  <li key={i}>{v.message}{(() => { const add = rowForMissing(people, v.missing); return add && <> — <button type="button" className="font-semibold text-admin-accent-strong underline" onClick={() => changeRows([...rows, add.row])}>tambah baris {add.label}</button></> })()}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {preview ? (
          <div className="space-y-1 text-sm">
            <p className="m-0 flex justify-between text-admin-ink/80"><span>Subtotal</span><span className="tabular-nums">{formatRupiah(preview.total)}</span></p>
            {preview.tax.map((t, i) => (
              <p key={i} className="m-0 flex justify-between text-admin-ink/80"><span>{t.name} {t.ratePercent}%{t.mode === 'included' ? ' (termasuk)' : ''}</span><span className="tabular-nums">{formatRupiah(t.amountIdr)}</span></p>
            ))}
            <p className="m-0 flex justify-between border-t border-admin-line-strong pt-2 font-bold text-admin-ink"><span>Total tagihan</span><span className="text-base font-extrabold tabular-nums">{formatRupiah(preview.grandTotal)}</span></p>
            <p className="m-0 text-xs text-admin-muted">Nomor invoice dan pajak dibekukan saat diterbitkan.</p>
          </div>
        ) : !problem && <p className="m-0 text-sm text-admin-muted">{incomplete >= 0 ? 'Lengkapi baris produk untuk menghitung total.' : hasProducts ? 'Menghitung…' : 'Tambahkan produk (visa, tiket, hotel, …).'}</p>}
      </MetaBox>
    </>
  )

  const sidebar = (
    <>
      <PublishBox onSave={() => void save()} saving={saving} dirty={dirty} saved={saved && !dirty} canSave={dirty} saveLabel="Simpan draf"
        meta={<span>Pemesan: <b>{loaded.user.fullName}</b></span>}
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
        {loaded.activeBankCount === 0 && <p role="alert" className="m-0 text-[12px] font-medium text-admin-warning">Belum ada rekening aktif di Pengaturan Invoice. Tambahkan dulu, karena pelanggan tidak tahu ke mana harus membayar.</p>}
        <p className="m-0 text-[11px] text-admin-muted">Pelanggan menerima tautan invoice (email/WhatsApp terverifikasi). Data jamaah diisi di halaman berikutnya.</p>
      </div>
      <DeleteBox confirmText={<>Hapus draf <b>{loaded.bookingCode}</b>? Draf belum punya kuota atau pembayaran — penghapusan permanen.</>} onDelete={remove} deleting={deleting} label="Hapus draf" />
    </>
  )

  return <EditorShell backHref={`/${locale}/admin/bookings`} backLabel="Daftar Booking" title={<>Draf {loaded.bookingCode}</>} main={main} sidebar={sidebar} />
}
