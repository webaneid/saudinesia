'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { BadgeCheck, HandCoins, Info, Landmark, Lock, SlidersHorizontal } from 'lucide-react'
import type { RevenueShareBasis } from '@prisma/client'
import { cn, formatRupiah } from '@/lib/utils'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { REVENUE_SHARE_BASIS_LABEL, revenueShareExample } from '@/lib/revenue-share/example'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { FormField } from '@/components/admin/ui/FormField'
import { Tabs, tabId, tabPanelId, type TabItem } from '@/components/admin/ui/Tabs'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'

// Sistem → Platform Provider (docs/arsitektur-bagi-hasil.md, Fase 13a). Data dari GET /api/v1/admin/system/platform-provider; simpan = POST (hanya akun
// Platform Provider — tombol dikunci untuk superadmin klien, dan API menolak juga). Contoh angka dari fungsi murni yang sama dengan rencana (lib/revenue-share/example).

type Current = { id: string | null; percent: number; basis: RevenueShareBasis; isDefault: boolean }
type Version = { id: string; percent: number; basis: RevenueShareBasis; note: string | null; createdAt: string }
type Balance = { entitledIdr: number; paidOutIdr: number; balanceIdr: number }
type Data = { current: Current; history: Version[]; configured: boolean; balance: Balance; canEdit: boolean }
type Tab = 'info' | 'setelan'

const TABS: readonly TabItem<Tab>[] = [{ id: 'info', label: 'Informasi', icon: Info }, { id: 'setelan', label: 'Setelan bagi hasil', icon: SlidersHorizontal }]
const BASIS_OPTIONS = (Object.keys(REVENUE_SHARE_BASIS_LABEL) as RevenueShareBasis[]).map(v => ({ id: v, label: REVENUE_SHARE_BASIS_LABEL[v] }))
const pct = (n: number) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`

function Example({ percent, basis }: { percent: number; basis: RevenueShareBasis }) {
  const e = revenueShareExample(percent, basis)
  const rows: Array<[string, number, boolean?]> = [['Modal (HPP)', e.costIdr], [`Margin klien ${e.marginPercent}%`, e.clientIdr], ['Bagian Platform Provider', e.providerIdr], ['Harga jual', e.sellIdr, true]]
  return (
    <div className="rounded-xl border border-admin-line bg-admin-spot/40 p-3">
      <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">Contoh: HPP Rp 1.000.000, margin 20%</p>
      {rows.map(([label, v, strong]) => (
        <div key={label} className={cn('flex justify-between gap-3 py-0.5 text-[13px]', strong && 'border-t border-admin-line pt-1.5 font-semibold')}>
          <span className={strong ? 'text-admin-ink' : 'text-admin-muted'}>{label}</span><span className="tabular-nums">{formatRupiah(v)}</span>
        </div>
      ))}
      <p className="m-0 mt-1.5 text-[11px] text-admin-muted">
        {basis === 'markup'
          ? 'Poin Platform Provider ditambahkan ke marjin otomatis: harga jual naik, margin klien tetap utuh.'
          : 'Harga jual tidak berubah: bagian Platform Provider diambil dari margin.'}
      </p>
    </div>
  )
}

export function PlatformProviderEditor() {
  const { locale } = useParams() as { locale: string }
  const base = `/${locale}/admin/system/platform-provider`
  const [tab, setTab] = useState<Tab>('info')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [percent, setPercent] = useState('')
  const [basis, setBasis] = useState<RevenueShareBasis>('markup')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/system/platform-provider')
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Data Platform Provider gagal dimuat.'); return }
      const d = j.data as Data
      setData(d); setPercent(String(d.current.percent)); setBasis(d.current.basis); setNote('')
    } catch { setError('Tidak dapat menghubungi server.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const parsed = Number(percent.replace(',', '.'))
  const valid = percent.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 50
  const dirty = !!data && (parsed !== data.current.percent || basis !== data.current.basis || data.current.isDefault || note.trim() !== '')

  const save = async () => {
    if (!data || !valid) return
    setSaving(true); setMessage(null)
    try {
      const res = await fetch('/api/v1/admin/system/platform-provider', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ percent: parsed, basis, note: note.trim() || null, expectedId: data.current.id }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) { setMessage({ ok: false, text: j?.error ?? 'Setelan gagal disimpan.' }); return }
      setMessage({ ok: true, text: 'Setelan tersimpan sebagai versi baru. Berlaku untuk booking yang terbit sesudah ini.' })
      await load()
    } catch { setMessage({ ok: false, text: 'Tidak dapat menghubungi server.' }) } finally { setSaving(false) }
  }

  const historyColumns: Column<Version>[] = [
    { key: 'at', header: 'Berlaku sejak', mobile: 'title', cell: v => <span className="tabular-nums">{formatInstant(v.createdAt, DATETIME_MEDIUM)}</span> },
    { key: 'p', header: 'Persen', align: 'right', cell: v => <span className="font-semibold tabular-nums">{pct(v.percent)}</span> },
    { key: 'b', header: 'Dasar', cell: v => REVENUE_SHARE_BASIS_LABEL[v.basis] },
    { key: 'n', header: 'Catatan', hideBelowLg: true, cell: v => <span className="text-admin-muted">{v.note ?? '—'}</span> },
  ]

  const c = data?.current
  return (
    <div className="space-y-5">
      <PageHeader icon={BadgeCheck} title="Platform Provider" description="Penyedia aplikasi Saudinesia dan kesepakatan bagi hasilnya. Persen dan dasar bagi hasil hanya dapat diubah akun Platform Provider." />
      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}
      <Tabs items={TABS} value={tab} onChange={setTab} label="Bagian Platform Provider" />

      <div id={tabPanelId('info')} role="tabpanel" aria-labelledby={tabId('info')} hidden={tab !== 'info'} className="space-y-4">
        <Card className="space-y-2 p-4">
          <h2 className="m-0 text-sm font-bold">Penyedia platform</h2>
          <p className="m-0 text-[13px] text-admin-muted">Platform Provider menyediakan dan memelihara aplikasi ini. Bagiannya dihitung per transaksi, hanya dari pembayaran yang berhasil.</p>
          <p className="m-0 text-[13px]">Akun Platform Provider: <span className="font-semibold">{data ? (data.configured ? 'sudah ditetapkan' : 'belum ditetapkan') : '…'}</span></p>
        </Card>
        {data && (
          <Card className="space-y-3 p-4">
            <h2 className="m-0 text-sm font-bold">Hak dan pencairan</h2>
            <dl className="m-0 grid gap-3 sm:grid-cols-3">
              <div><dt className="text-[11px] text-admin-muted">Hak tercatat</dt><dd className="m-0 text-lg font-semibold tabular-nums">{formatRupiah(data.balance.entitledIdr)}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Sudah dicairkan</dt><dd className="m-0 text-lg font-semibold tabular-nums">{formatRupiah(data.balance.paidOutIdr)}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Saldo belum dicairkan</dt><dd className="m-0 text-lg font-semibold tabular-nums">{formatRupiah(data.balance.balanceIdr)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Link href={`${base}/payouts`} className="admin-btn-sm"><HandCoins className="size-4" /> Pencairan</Link>
              <Link href={`${base}/accounts`} className="admin-btn-sm"><Landmark className="size-4" /> Rekening Platform Provider</Link>
            </div>
          </Card>
        )}
        {c && (
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-sm font-bold">Bagi hasil yang berlaku</h2>
              {c.isDefault && <Badge tone="neutral">Bawaan</Badge>}
            </div>
            <p className="m-0 text-2xl font-extrabold tabular-nums">{pct(c.percent)} <span className="text-sm font-semibold text-admin-muted">· {REVENUE_SHARE_BASIS_LABEL[c.basis]}</span></p>
            <Example percent={c.percent} basis={c.basis} />
            <p className="m-0 text-[12px] text-admin-muted">
              {data?.configured
                ? c.basis === 'markup'
                  ? `Harga otomatis semua produk memakai margin bawaan ditambah ${pct(c.percent)} untuk Platform Provider; harga manual tidak berubah.`
                  : 'Harga jual tidak berubah; bagian dihitung dari margin (jual − modal).'
                : 'Belum berlaku: harga dan invoice baru memakai bagi hasil setelah akun Platform Provider ditetapkan.'}
              {' '}Aturan dibekukan saat invoice terbit: perubahan setelan hanya berlaku untuk booking baru.
            </p>
          </Card>
        )}
      </div>

      <div id={tabPanelId('setelan')} role="tabpanel" aria-labelledby={tabId('setelan')} hidden={tab !== 'setelan'} className="space-y-4">
        {data && (
          <Card className="space-y-4 p-4">
            {!data.canEdit && (
              <p className="m-0 flex items-center gap-2 rounded-xl border border-admin-line bg-admin-spot/40 px-3 py-2 text-[13px] text-admin-muted">
                <Lock className="size-4 shrink-0" />Hanya akun Platform Provider yang dapat mengubah setelan ini.
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <FormField label="Persen bagi hasil" htmlFor="rs-percent" hint="0–50, bawaan 5" required>
                  <input id="rs-percent" className="admin-inp" inputMode="decimal" value={percent} onChange={e => setPercent(e.target.value)} disabled={!data.canEdit || saving} />
                </FormField>
                <FormField label="Dasar bagi hasil" htmlFor="rs-basis" required>
                  <ChoiceSelect options={BASIS_OPTIONS} value={basis} onChange={v => v && setBasis(v as RevenueShareBasis)} clearable={false} ariaLabel="Dasar bagi hasil" disabled={!data.canEdit || saving} />
                </FormField>
                <FormField label="Catatan versi" htmlFor="rs-note" hint="Opsional, mis. nomor kesepakatan">
                  <input id="rs-note" className="admin-inp" maxLength={200} value={note} onChange={e => setNote(e.target.value)} disabled={!data.canEdit || saving} />
                </FormField>
                {message && <p role={message.ok ? 'status' : 'alert'} className={cn('m-0 text-sm font-medium', message.ok ? 'text-admin-ok' : 'text-admin-danger')}>{message.text}</p>}
                {data.canEdit && <Button onClick={save} loading={saving} disabled={!valid || !dirty}>Simpan versi baru</Button>}
              </div>
              {valid ? <Example percent={parsed} basis={basis} /> : <p className="m-0 text-sm text-admin-danger">Persen harus angka 0–50.</p>}
            </div>
          </Card>
        )}
        <Card className="space-y-2 p-4">
          <h2 className="m-0 text-sm font-bold">Riwayat versi</h2>
          <DataTable columns={historyColumns} rows={data?.history ?? []} getRowId={v => v.id} loading={!data && !error} empty="Belum ada versi tersimpan — yang berlaku adalah bawaan (5%, tambah poin marjin)." />
        </Card>
      </div>
    </div>
  )
}
