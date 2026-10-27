'use client'

import { MediaField } from '@/components/admin/media/MediaField'
import { useState } from 'react'
import { ExternalLink, FileText, ImageIcon, Info, Trash2, Wallet } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { Switch } from '@/components/admin/ui/Switch'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { formatRupiah } from '@/lib/utils'
import type { InfoForm } from './types'

const VISA_TYPE_SUGGESTIONS = ['Umroh', 'Visitor', 'Bisnis', 'Kerja', 'Transit', 'Haji']

type Props = {
  productId: string
  form: InfoForm
  onChange: (patch: Partial<InfoForm>) => void
  price: number
  locale: string
  productName: string
  onShowPrice: () => void
  /** Mengembalikan pesan galat bila gagal, null bila berhasil (halaman yang mengalihkan). */
  onDelete: () => Promise<string | null>
}

export function ProductInfoTab({ productId, form, onChange, price, locale, productName, onShowPrice, onDelete }: Props) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <Card className="space-y-4 p-5">
          <SectionTitle icon={Info} title="Informasi dasar" />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField label="Nama produk" htmlFor="visa-name" required>
              <input id="visa-name" className="admin-input" value={form.name} onChange={e => onChange({ name: e.target.value })} />
            </FormField>
            <FormField label="Negara" htmlFor="visa-country">
              <input id="visa-country" className="admin-input" value={form.country} placeholder="Saudi Arabia" onChange={e => onChange({ country: e.target.value })} />
            </FormField>
            <FormField label="Jenis visa" htmlFor="visa-type" required hint="Teks bebas. Pilih saran atau ketik sendiri.">
              <input
                id="visa-type" className="admin-input" value={form.visaType} placeholder="Umroh / Visitor / Bisnis…"
                list="visa-type-suggestions" onChange={e => onChange({ visaType: e.target.value })}
              />
              <datalist id="visa-type-suggestions">
                {VISA_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
              </datalist>
            </FormField>
            <FormField label="Estimasi proses (hari kerja)" htmlFor="visa-process-days">
              <input id="visa-process-days" type="number" min={1} className="admin-input" value={form.processDays} onChange={e => onChange({ processDays: e.target.value })} />
            </FormField>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <SectionTitle icon={FileText} title="Deskripsi" hint="Opsional" />
          <p className="m-0 text-xs text-admin-muted">
            Tampil di katalog Layanan Visa, di bawah nama produk. Boleh panjang: pakai judul dan daftar supaya mudah dibaca jamaah.
          </p>
          <RichTextEditor
            id="visa-description"
            title="Deskripsi produk visa"
            value={form.description}
            onChange={description => onChange({ description })}
            placeholder="Jelaskan jenis visa ini, kelayakan pemohon, prosedur, dan catatan penting…"
          />
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="space-y-3 p-5">
          <SectionTitle title="Publikasi" />
          <div className="flex items-start gap-3">
            <Switch id="visa-active" checked={form.isActive} onChange={isActive => onChange({ isActive })} label="Tampilkan di katalog" />
            <label htmlFor="visa-active" className="cursor-pointer">
              <span className="block text-sm font-semibold text-admin-ink">{form.isActive ? 'Aktif' : 'Nonaktif'}</span>
              <span className="block text-xs text-admin-muted">
                {form.isActive ? 'Tampil di katalog dan bisa dipesan jamaah.' : 'Disembunyikan dari katalog. Pesanan lama tidak terpengaruh.'}
              </span>
            </label>
          </div>
          <a
            href={`/${locale}/visa`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-admin-accent-strong hover:underline"
          >
            Lihat katalog publik <ExternalLink className="size-3.5" />
          </a>
        </Card>

        <Card className="space-y-3 p-5">
          <SectionTitle icon={ImageIcon} title="Foto Unggulan" />
          <MediaField productType="visa" productId={productId} label="Foto Unggulan Visa" />
        </Card>

        <Card className="space-y-2 p-5">
          <SectionTitle icon={Wallet} title="Harga saat ini" />
          <p className="m-0 text-2xl font-extrabold tracking-tight text-admin-ink">{formatRupiah(price)}</p>
          <p className="m-0 text-xs text-admin-muted">Per orang. Dihitung otomatis dari HPP dan komponen biaya, tidak diisi manual di sini.</p>
          <button type="button" onClick={onShowPrice} className="text-xs font-semibold text-admin-accent-strong hover:underline">
            Atur HPP dan harga jual
          </button>
        </Card>

        <DangerZone productName={productName} onDelete={onDelete} />
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, title, hint }: { icon?: typeof Info; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="size-4 text-admin-accent" />}
      <h2 className="m-0 text-sm font-bold text-admin-ink">{title}</h2>
      {hint && <Badge tone="neutral">{hint}</Badge>}
    </div>
  )
}

function DangerZone({ productName, onDelete }: { productName: string; onDelete: () => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setDeleting(true)
    setError(null)
    const message = await onDelete()
    if (message) { setError(message); setDeleting(false) }
  }

  return (
    <Card className="space-y-3 border-admin-danger/25 p-5">
      <h2 className="m-0 text-sm font-bold text-admin-danger">Zona berbahaya</h2>
      <p className="m-0 text-xs text-admin-muted">Menghapus produk ini permanen. Data jamaah yang sudah memesan tidak terpengaruh.</p>
      {error && <p className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
      {!confirming ? (
        <Button variant="outline" size="sm" className="border-admin-danger/30 text-admin-danger hover:border-admin-danger" onClick={() => setConfirming(true)}>
          <Trash2 className="size-3.5" /> Hapus produk
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold text-admin-ink">Hapus &quot;{productName}&quot;? Tindakan ini tidak bisa dibatalkan.</p>
          <div className="flex gap-2">
            <Button variant="danger" size="sm" loading={deleting} onClick={run}>Ya, hapus</Button>
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => { setConfirming(false); setError(null) }}>Batal</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
