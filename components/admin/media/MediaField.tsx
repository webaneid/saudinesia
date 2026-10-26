'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, ImageIcon, Loader2, Pencil, Plus, Star, Trash2, X, ZoomIn } from 'lucide-react'
import { ImageUploadModal } from './ImageUploadModal'

type Img = { id: string; url: string | null; cardUrl: string | null; alt: string | null; isFeatured: boolean; sortOrder: number; width: number | null; height: number | null }
type Meta = { mode: 'featured' | 'gallery'; max: number }

type Props = {
  /** Kunci registry lib/media/owners.ts (hotel, vehicle, haji, …). Mode (satu foto unggulan / galeri) mengikuti registry di server. */
  productType: string
  productId: string
  label?: string
}

/**
 * Komponen foto universal admin (docs/arsitektur-media.md F2): SATU komponen untuk semua produk. Mode featured = satu foto unggulan (unggah baru
 * mengganti); mode gallery = banyak foto — jadikan sampul, ubah urutan, teks alternatif, hapus. Berbicara hanya dengan
 * `/api/v1/admin/media/[productType]/[productId]`; setiap galat server (unggah/ubah/hapus) ditampilkan, tak ada yang senyap.
 * Semua tombol bertipe `button` supaya aman dipakai di dalam `<form>`.
 */
export function MediaField({ productType, productId, label = 'Foto' }: Props) {
  const base = `/api/v1/admin/media/${productType}/${productId}`
  const [images, setImages] = useState<Img[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [lightbox, setLightbox] = useState<Img | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [editingAlt, setEditingAlt] = useState<{ id: string; value: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(base)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) { setError(json?.error ?? 'Foto gagal dimuat.'); return }
      setImages(json.data as Img[]); setMeta(json.meta as Meta); setError(null)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { void load() }, [load])

  const call = useCallback(async (id: string, url: string, method: string, body?: unknown): Promise<boolean> => {
    setBusy(id); setError(null)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) { setError(json?.error ?? 'Perubahan gagal disimpan.'); return false }
      await load()
      return true
    } catch {
      setError('Tidak dapat menghubungi server.')
      return false
    } finally {
      setBusy(null)
    }
  }, [load])

  const upload = useCallback((file: File, onProgress: (pct: number) => void) => new Promise<void>((resolve, reject) => {
    setUploading(true); setUploadErr(null)
    const form = new FormData(); form.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.upload.addEventListener('progress', e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) })
    xhr.addEventListener('load', async () => {
      setUploading(false)
      if (xhr.status === 201) { await load(); resolve(); return }
      let msg = 'Unggah gagal.'
      try { msg = JSON.parse(xhr.responseText)?.error ?? msg } catch { /* tanpa badan JSON */ }
      setUploadErr(msg); reject(new Error(msg))
    })
    xhr.addEventListener('error', () => { setUploading(false); const msg = 'Koneksi gagal. Coba lagi.'; setUploadErr(msg); reject(new Error(msg)) })
    xhr.open('POST', base)
    xhr.send(form)
  }), [base, load])

  const gallery = meta?.mode === 'gallery'
  const canAdd = !!meta && (meta.mode === 'featured' || images.length < meta.max)
  const openModal = () => { setUploadErr(null); setModalOpen(true) }

  // Urutan tampil: sampul dulu, lalu sortOrder. Hanya foto non-sampul yang dapat digeser (sampul selalu di depan).
  const movable = images.filter(i => !i.isFeatured)
  async function move(img: Img, dir: -1 | 1) {
    const i = movable.findIndex(m => m.id === img.id), j = i + dir
    if (i < 0 || j < 0 || j >= movable.length) return
    const next = [...movable]; const tmp = next[i]!; next[i] = next[j]!; next[j] = tmp
    const featured = images.filter(f => f.isFeatured)
    await call(img.id, base, 'PATCH', { order: [...featured, ...next].map(x => x.id) })
  }

  const Thumb = ({ img, className }: { img: Img; className?: string }) => img.cardUrl
    ? <img src={img.cardUrl} alt={img.alt ?? ''} className={`h-full w-full object-cover ${className ?? ''}`} loading="lazy" />
    : <div className="grid h-full w-full place-items-center text-admin-muted/50"><ImageIcon className="h-6 w-6" /></div>

  return (
    <section className="space-y-3" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="m-0 text-[13px] font-semibold text-admin-ink">{label}</p>
          {meta && gallery && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">{images.length}/{meta.max} foto — satu foto menjadi sampul</p>}
          {meta && !gallery && <p className="m-0 mt-0.5 text-[11px] text-admin-muted">Satu foto unggulan; unggah baru menggantikan yang lama</p>}
        </div>
        {canAdd && images.length > 0 && (
          <button type="button" onClick={openModal} disabled={uploading} className="admin-btn-sm flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> {gallery ? 'Tambah Foto' : 'Ganti Foto'}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-admin-danger/20 bg-admin-danger/10 px-3 py-2 text-[12px] text-admin-danger">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {loading && <div className="flex justify-center py-8 text-admin-muted/70"><Loader2 className="h-5 w-5 animate-spin" /></div>}

      {!loading && images.length === 0 && !error && (
        <button type="button" onClick={openModal} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-admin-line p-8 text-admin-muted/70 transition-colors hover:border-admin-accent/30 hover:text-admin-accent">
          <ImageIcon className="h-8 w-8" />
          <p className="m-0 text-[13px] font-medium">Belum ada foto</p>
          <p className="m-0 text-[11px]">Klik untuk mengunggah {gallery ? 'foto pertama (akan menjadi sampul)' : 'foto unggulan'}</p>
        </button>
      )}

      {!loading && images.length > 0 && (
        <ul className={`m-0 grid list-none gap-3 p-0 ${gallery ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:max-w-sm'}`}>
          {images.map(img => {
            const mi = movable.findIndex(m => m.id === img.id)
            const isBusy = busy === img.id
            return (
              <li key={img.id} className="space-y-1.5">
                <div className={`group relative overflow-hidden rounded-xl border border-admin-line bg-admin-spot ${gallery ? 'aspect-[4/3]' : 'aspect-[16/10]'}`}>
                  <Thumb img={img} />
                  {gallery && img.isFeatured && (
                    <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-admin-ink/75 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm"><Star className="h-2.5 w-2.5" /> SAMPUL</span>
                  )}
                  {isBusy && <div className="absolute inset-0 grid place-items-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-admin-accent" /></div>}
                  {img.url && (
                    <button type="button" onClick={() => setLightbox(img)} aria-label="Lihat penuh" className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-admin-ink opacity-0 shadow transition-opacity hover:bg-white group-hover:opacity-100 focus:opacity-100">
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {gallery && !img.isFeatured && (
                    <button type="button" disabled={!!busy} onClick={() => call(img.id, `${base}/${img.id}`, 'PATCH', { isFeatured: true })} className="admin-btn-ghost flex items-center gap-1 text-[11px]" title="Jadikan sampul"><Star className="h-3 w-3" /> Sampul</button>
                  )}
                  {gallery && !img.isFeatured && (
                    <>
                      <button type="button" disabled={!!busy || mi <= 0} onClick={() => move(img, -1)} aria-label="Geser ke kiri" className="admin-btn-ghost px-1.5"><ArrowLeft className="h-3 w-3" /></button>
                      <button type="button" disabled={!!busy || mi < 0 || mi >= movable.length - 1} onClick={() => move(img, 1)} aria-label="Geser ke kanan" className="admin-btn-ghost px-1.5"><ArrowRight className="h-3 w-3" /></button>
                    </>
                  )}
                  <button type="button" disabled={!!busy} onClick={() => setEditingAlt({ id: img.id, value: img.alt ?? '' })} className="admin-btn-ghost flex items-center gap-1 text-[11px]" title="Teks alternatif"><Pencil className="h-3 w-3" /> Alt</button>
                  {confirmingId === img.id ? (
                    <span className="ml-auto flex items-center gap-1 text-[11px]">
                      <button type="button" disabled={!!busy} onClick={async () => { if (await call(img.id, `${base}/${img.id}`, 'DELETE')) setConfirmingId(null) }} className="rounded-md bg-admin-danger px-2 py-0.5 font-semibold text-white">Hapus</button>
                      <button type="button" onClick={() => setConfirmingId(null)} className="admin-btn-ghost px-1.5"><X className="h-3 w-3" /></button>
                    </span>
                  ) : (
                    <button type="button" disabled={!!busy} onClick={() => setConfirmingId(img.id)} aria-label="Hapus foto" className="admin-btn-ghost ml-auto px-1.5 text-admin-danger"><Trash2 className="h-3 w-3" /></button>
                  )}
                </div>

                {editingAlt?.id === img.id ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus className="admin-inp-xs" value={editingAlt.value} maxLength={200} aria-label="Teks alternatif"
                      placeholder="Deskripsi singkat foto (untuk aksesibilitas & SEO)"
                      onChange={e => setEditingAlt({ id: img.id, value: e.target.value })}
                      onKeyDown={async e => { if (e.key === 'Enter') { e.preventDefault(); if (await call(img.id, `${base}/${img.id}`, 'PATCH', { alt: editingAlt.value })) setEditingAlt(null) } if (e.key === 'Escape') setEditingAlt(null) }}
                    />
                    <button type="button" disabled={!!busy} onClick={async () => { if (await call(img.id, `${base}/${img.id}`, 'PATCH', { alt: editingAlt.value })) setEditingAlt(null) }} className="admin-btn-sm text-[11px]">Simpan</button>
                    <button type="button" onClick={() => setEditingAlt(null)} className="admin-btn-ghost px-1.5"><X className="h-3 w-3" /></button>
                  </div>
                ) : img.alt ? (
                  <p className="m-0 truncate text-[11px] text-admin-muted" title={img.alt}>{img.alt}</p>
                ) : null}
              </li>
            )
          })}
          {gallery && canAdd && (
            <li>
              <button type="button" onClick={openModal} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-admin-line text-admin-muted/70 transition-colors hover:border-admin-accent/30 hover:text-admin-accent">
                <Plus className="h-5 w-5" /><span className="text-[10px] font-medium">Tambah</span>
              </button>
            </li>
          )}
        </ul>
      )}

      <ImageUploadModal open={modalOpen} uploading={uploading} error={uploadErr} onClose={() => setModalOpen(false)} onUpload={upload} />

      {lightbox?.url && (
        <div role="dialog" aria-label="Pratinjau foto" className="fixed inset-0 z-50 flex items-center justify-center bg-admin-ink/80 p-4" onClick={() => setLightbox(null)}>
          <button type="button" onClick={() => setLightbox(null)} aria-label="Tutup" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"><X className="h-5 w-5" /></button>
          <img src={lightbox.url} alt={lightbox.alt ?? ''} className="max-h-[90vh] max-w-full rounded-2xl object-contain shadow-admin" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </section>
  )
}
