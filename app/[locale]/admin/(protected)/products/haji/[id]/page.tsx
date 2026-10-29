'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Star, Wallet } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { HAJI_TYPES } from '@/lib/constants/haji'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { CostComponentsPanel } from '@/components/admin/pricing/CostComponentsPanel'
import { MediaField } from '@/components/admin/media/MediaField'
import { PriceCard } from '@/components/admin/pricing/PriceCard'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

type HajiDetail = {
  id: string; name: string; description: string | null; hajiType: string; year: number
  departureDate: string | null; returnDate: string | null; durationDays: number | null
  includes: string[]; price: number; totalQuota: number; pendingQuota: number; bookedQuota: number
  isActive: boolean; bookingCount: number
}
type Form = { name: string; description: string; hajiType: string; year: string; departureDate: string; returnDate: string; durationDays: string; includes: string; totalQuota: string; isActive: boolean }

const toForm = (h: HajiDetail): Form => ({
  name: h.name, description: h.description ?? '', hajiType: h.hajiType, year: String(h.year),
  departureDate: h.departureDate?.slice(0, 10) ?? '', returnDate: h.returnDate?.slice(0, 10) ?? '',
  durationDays: h.durationDays != null ? String(h.durationDays) : '', includes: h.includes.join('\n'),
  totalQuota: String(h.totalQuota), isActive: h.isActive,
})

export default function HajiEditPage() {
  const { locale, id } = useParams() as { locale: string; id: string }
  const list = `/${locale}/admin/products/haji`
  const e = useEditEntity<HajiDetail>(`/api/v1/admin/products/haji/${id}`, list)
  const [form, setForm] = useState<Form | null>(null)
  const { dirty, markClean, patchClean } = useDirtyForm(form)
  const [priceTick, setPriceTick] = useState(0) // naik setiap biaya/harga berubah → PriceCard memuat ulang

  // Formulir diisi SEKALI dari data yang dimuat. Muat-ulang akibat Komponen Biaya (harga berubah) hanya memperbarui `e.item`,
  // tidak menimpa ketikan yang belum disimpan.
  useEffect(() => {
    if (e.item && !form) { const f = toForm(e.item); setForm(f); markClean(f) }
  }, [e.item, form, markClean])

  if (e.missing) return <p className="text-sm text-admin-muted">Produk haji tidak ditemukan — mungkin sudah dihapus. <a className="font-semibold underline" href={list}>Kembali ke daftar</a></p>
  if (e.loading || !form || !e.item) return <p className="text-sm text-admin-muted">{e.error ?? 'Memuat…'}</p>

  const haji = e.item
  const sisa = haji.totalQuota - haji.pendingQuota - haji.bookedQuota
  const patch = (p: Partial<Form>) => { e.clearMessages(); setForm(f => f && ({ ...f, ...p })) }
  const set = (k: keyof Form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => patch({ [k]: ev.target.value } as Partial<Form>)
  const hasBookings = haji.bookingCount > 0

  return (
    <EditPage
      icon={Star} title={haji.name} backHref={list} backLabel="Daftar Haji"
      active={form.isActive} onActiveChange={isActive => patch({ isActive })} dirty={dirty}
      onSubmit={async () => {
        const ok = await e.save({
          name: form.name, description: form.description, hajiType: form.hajiType, year: Number(form.year),
          departureDate: form.departureDate || null, returnDate: form.returnDate || null,
          durationDays: form.durationDays ? Number(form.durationDays) : null,
          includes: form.includes.split('\n').map(s => s.trim()).filter(Boolean),
          totalQuota: Number(form.totalQuota), isActive: form.isActive,
        })
        if (ok) markClean(form)
      }}
      saving={e.saving} canSubmit={!!form.name.trim()} error={e.error} notice={e.notice}
      media={<MediaField productType="haji" productId={haji.id} label="Foto Unggulan Haji" />}
      sidebar={
        <MetaBox title="Harga Jual per Orang" icon={Wallet} collapsible={false}>
          {haji.price > 0 ? (
            <p className="m-0 text-xl font-bold text-admin-accent-strong">{formatRupiah(haji.price)}</p>
          ) : (
            <p className="m-0 text-[13px] text-admin-warning">Belum ditetapkan — tambahkan Komponen Biaya. Selama belum berharga, produk ini tidak dapat dipesan.</p>
          )}
          <p className="m-0 text-[11px] text-admin-muted">Otomatis = jumlah harga jual semua komponen (diperbarui saat komponen atau kurs berubah). Harga bisa diatur manual lewat kartu “Harga” di bawah.</p>
        </MetaBox>
      }
      remove={{
        label: hasBookings ? 'Nonaktifkan produk' : 'Hapus produk',
        confirmText: hasBookings
          ? `Produk "${haji.name}" sudah punya ${haji.bookingCount} booking sehingga tidak bisa dihapus. Nonaktifkan produk ini (hilang dari katalog, data booking tetap aman)?`
          : `Hapus produk "${haji.name}" beserta komponen biayanya secara permanen? Tindakan ini tidak bisa dibatalkan.`,
        onDelete: async () => { if (await e.remove() === 'deactivated') { setForm(p => p && ({ ...p, isActive: false })); patchClean({ isActive: false }) } },
        deleting: e.deleting,
      }}
      after={
        <>
        <PriceCard ownerType="haji" ownerId={id} reloadKey={priceTick} onChanged={() => { void e.reload() }} />
        <CostComponentsPanel
          apiBase={`/api/v1/admin/products/haji/${id}/costs`}
          hint="Tiap komponen (visa, akomodasi, transportasi, dst) dapat margin sendiri, baru dijumlah jadi harga per orang — lihat docs/arsitektur-komponen-biaya.md"
          namePlaceholder="Visa Haji, Akomodasi Makkah, Transportasi, dst"
          onChanged={async () => { await e.reload(); setPriceTick(t => t + 1) }}
        />
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><p className="mb-1 text-xs text-admin-muted">Nama Produk</p><input className="admin-inp" value={form.name} onChange={set('name')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Jenis Haji</p><ChoiceSelect ariaLabel="Jenis haji" value={form.hajiType} onChange={v => setForm(f => f && { ...f, hajiType: v })} clearable={false} options={HAJI_TYPES.map(t => ({ id: t.value, label: t.label }))} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tahun</p><input type="number" className="admin-inp" value={form.year} onChange={set('year')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tanggal Berangkat</p><input type="date" className="admin-inp" value={form.departureDate} onChange={set('departureDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Tanggal Kembali</p><input type="date" className="admin-inp" value={form.returnDate} onChange={set('returnDate')} /></div>
        <div><p className="mb-1 text-xs text-admin-muted">Durasi (hari)</p><input type="number" className="admin-inp" value={form.durationDays} onChange={set('durationDays')} /></div>
        <div>
          <p className="mb-1 text-xs text-admin-muted">Kuota Total</p>
          <input type="number" className="admin-inp" value={form.totalQuota} onChange={set('totalQuota')} />
          <p className="mt-1 text-[11px] text-admin-muted/70">Ditahan {haji.pendingQuota} · Terjual {haji.bookedQuota} · Sisa {sisa}</p>
        </div>
        <div className="min-w-0 md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
          <RichTextEditor id="haji-edit-description" title="Deskripsi paket haji" value={form.description} onChange={description => patch({ description })} placeholder="Program perjalanan, fasilitas, syarat, dan catatan penting…" />
        </div>
        <div className="md:col-span-2">
          <p className="mb-1 text-xs text-admin-muted">Yang Termasuk (satu baris per item)</p>
          <textarea className="admin-inp" rows={4} value={form.includes} onChange={set('includes')} />
        </div>
      </div>
    </EditPage>
  )
}
