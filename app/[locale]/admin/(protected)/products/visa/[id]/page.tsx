'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { KeyRound, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { Badge } from '@/components/admin/ui/Badge'
import { MediaField } from '@/components/admin/media/MediaField'
import { RequirementsTable } from '@/components/admin/documents/RequirementsTable'
import { bodyFromRows, rowFromView, type RequirementRow } from '@/components/admin/documents/requirementRows'
import { parseRequiredComponents, visaSalesModel, type RequiredComponent } from '@/lib/validators/visa'
import { adminHref } from '@/lib/admin/href'
import { VisaInfoFields, visaInfoBody, visaInfoValid, type VisaInfo } from '../VisaInfoFields'
import { SalesModelCard } from './SalesModelCard'
import { VisaTiersTable } from './VisaTiersTable'
import type { ProductDetail } from './types'
import { PilgrimDataToggle } from '@/components/admin/pilgrim-data/PilgrimDataToggle'

// Editor produk visa — tata letak sama dengan Haji/Paket (EditPage: konten kiri, Terbitkan/Foto/Harga/Hapus kanan), bagian tersusun ke bawah tanpa tab.
// Data jamaah = saklar `PilgrimDataToggle` di kanan (katalog global Produk → Data Jamaah, docs/arsitektur-data-jamaah.md). Kolom manifest per
// produk lama (`manifestFields` di API) tidak dikirim halaman ini dan tidak dibaca jalur jamaah mana pun — dihapus di D5.

type Form = VisaInfo & { isActive: boolean; reqs: RequirementRow[]; rules: RequiredComponent[] }

const toForm = (v: ProductDetail): Form => ({
  name: v.name, country: v.country, visaType: v.visaType, description: v.description ?? '', processDays: String(v.processDays),
  isActive: v.isActive, reqs: v.documentRequirements.map(rowFromView), rules: parseRequiredComponents(v.requiredComponents).components,
})

export default function VisaEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = adminHref(locale, `/admin/products/visa`)
  const e = useEditEntity<ProductDetail>(`/api/v1/admin/products/visa/${id}`, list)
  const [form, setForm] = useState<Form | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)
  const [priceTick, setPriceTick] = useState(0) // naik setiap harga berubah → tabel rentang memuat ulang

  // Formulir diisi SEKALI dari data yang dimuat; muat-ulang akibat harga berubah tidak menimpa ketikan yang belum disimpan.
  useEffect(() => {
    if (e.item && !form) { const f = toForm(e.item); setForm(f); markClean(f) }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Produk visa tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form || !e.item) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const visa = e.item
  const price = Number(visa.price)
  const model = visaSalesModel(form.rules)
  const patch = (p: Partial<Form>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }
  const reloadPrice = async () => { await e.reload(); setPriceTick(t => t + 1) }

  return (
    <EditPage
      icon={KeyRound} title={visa.name} backHref={list} backLabel="Daftar Produk Visa"
      active={form.isActive} onActiveChange={isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => {
        const ok = await e.save({ ...visaInfoBody(form), isActive: form.isActive, requirements: bodyFromRows(form.reqs), requiredComponents: form.rules })
        if (ok) {
          const kept = { ...form, reqs: form.reqs.filter(r => r.documentTypeId) }
          setForm(kept); markClean(kept)
        }
      }}
      saving={e.saving} canSubmit={visaInfoValid(form)} error={e.error} notice={e.notice}
      media={<MediaField productType="visa" productId={visa.id} label="Foto Unggulan Visa" />}
      sidebar={
        <>
        <MetaBox title="Harga Jual per Orang" icon={Wallet} collapsible={false}>
          {price > 0 ? (
            <p className="m-0 text-xl font-bold text-admin-accent-strong">{formatRupiah(price)}</p>
          ) : (
            <p className="m-0 text-[13px] text-admin-warning">Belum ditetapkan — tambahkan rentang hari di bagian Harga. Selama belum berharga, produk ini tidak dapat dipesan.</p>
          )}
          <p className="m-0 text-[11px] text-admin-muted">Harga terendah dari semua rentang hari (tampil “mulai dari” di katalog).</p>
          <div className="flex items-center gap-2 pt-1 text-[11px] text-admin-muted">Model penjualan <Badge tone={model.plus ? 'accent' : 'neutral'}>{model.label}</Badge></div>
        </MetaBox>
        <PilgrimDataToggle productType="visa" productId={visa.id} />
        </>
      }
      remove={{
        label: 'Hapus produk',
        confirmText: `Hapus produk "${visa.name}"? Bila sudah dipakai pesanan, pengajuan visa, atau paket, produk hanya dinonaktifkan (riwayat tetap utuh, bisa diaktifkan kembali).`,
        onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } },
        deleting: e.deleting,
      }}
      after={
        <>
          <RequirementsTable rows={form.reqs} onChange={reqs => patch({ reqs })} productNoun="visa ini" />
          <SalesModelCard rules={form.rules} onChange={rules => patch({ rules })} />
          <VisaTiersTable productId={id} onChanged={reloadPrice} reloadKey={priceTick} />
        </>
      }
    >
      <VisaInfoFields value={form} onChange={patch} idPrefix="visa-edit" />
    </EditPage>
  )
}
