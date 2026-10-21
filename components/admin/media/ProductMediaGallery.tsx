'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, Loader2, ImageIcon, X, AlertCircle, ZoomIn } from 'lucide-react'
import { ImageUploadModal } from './ImageUploadModal'

type ImageItem = { key: string; url: string | null }

type Props = {
  hotelId: string      // generic: could be any entity id
  apiBase: string      // e.g. /api/v1/admin/products/hotels/{id}/images
  label?: string       // e.g. "Foto Hotel"
  maxImages?: number   // default 10
}

export function ProductMediaGallery({ hotelId, apiBase, label = 'Foto', maxImages = 10 }: Props) {
  const [images,    setImages]    = useState<ImageItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [lightbox,  setLightbox]  = useState<string | null>(null)
  const [deleting,  setDeleting]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(apiBase)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setImages(json.data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { load() }, [load])

  // XHR upload with progress
  const handleUpload = useCallback(
    (file: File, onProgress: (pct: number) => void) =>
      new Promise<void>((resolve, reject) => {
        setUploading(true); setUploadErr(null)

        const formData = new FormData()
        formData.append('file', file)

        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
        })
        xhr.addEventListener('load', async () => {
          setUploading(false)
          if (xhr.status === 201) {
            await load(); resolve()
          } else {
            let msg = 'Upload gagal'
            try { msg = JSON.parse(xhr.responseText)?.error ?? msg } catch { /* */ }
            setUploadErr(msg); reject(new Error(msg))
          }
        })
        xhr.addEventListener('error', () => {
          setUploading(false)
          const msg = 'Network error. Coba lagi.'
          setUploadErr(msg); reject(new Error(msg))
        })
        xhr.open('POST', apiBase)
        xhr.send(formData)
      }),
    [apiBase, load],
  )

  const handleDelete = useCallback(async (key: string) => {
    if (!confirm('Hapus foto ini?')) return
    setDeleting(key)
    try {
      const res  = await fetch(apiBase, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      await load()
    } catch {
      // silent
    } finally {
      setDeleting(null)
    }
  }, [apiBase, load])

  const openModal = () => { setUploadErr(null); setModalOpen(true) }

  const canAdd = images.length < maxImages

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-admin-ink">{label}</p>
          <p className="text-[11px] text-admin-muted mt-0.5">{images.length}/{maxImages} foto</p>
        </div>
        {canAdd && (
          <button
            onClick={openModal}
            disabled={uploading}
            className="admin-btn-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah Foto
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-admin-danger text-[12px] bg-admin-danger/10 rounded-xl px-3 py-2 border border-admin-danger/20">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Loading */}
      {loading && !error && (
        <div className="flex justify-center py-8 text-admin-muted/70">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && images.length === 0 && (
        <button
          onClick={openModal}
          className="w-full border-2 border-dashed border-admin-line rounded-2xl p-8 flex flex-col items-center gap-2 text-admin-muted/70 hover:border-admin-accent/30 hover:text-admin-accent hover:bg-admin-accent/5 transition-colors"
        >
          <ImageIcon className="h-8 w-8" />
          <p className="text-[13px] font-medium">Belum ada foto</p>
          <p className="text-[11px]">Klik untuk upload foto pertama</p>
        </button>
      )}

      {/* Image grid */}
      {!loading && images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {images.map((img, idx) => (
            <div key={img.key} className="relative group rounded-xl overflow-hidden border border-admin-line bg-admin-spot aspect-square">
              {img.url ? (
                <img
                  src={img.url}
                  alt={`Foto ${idx + 1}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-admin-muted/50">
                  <ImageIcon className="h-6 w-6" />
                </div>
              )}

              {/* Hover overlay */}
              <div className="absolute inset-0 bg-admin-ink/0 group-hover:bg-admin-ink/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                {img.url && (
                  <button
                    onClick={() => setLightbox(img.url)}
                    className="h-8 w-8 rounded-full bg-white/90 grid place-items-center text-admin-ink hover:bg-white transition-colors shadow"
                    title="Lihat penuh"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(img.key)}
                  disabled={deleting === img.key}
                  className="h-8 w-8 rounded-full bg-admin-danger grid place-items-center text-white hover:bg-admin-danger transition-colors shadow disabled:opacity-60"
                  title="Hapus foto"
                >
                  {deleting === img.key
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />
                  }
                </button>
              </div>

              {/* Primary badge for first image */}
              {idx === 0 && (
                <span className="absolute top-1.5 left-1.5 text-[9px] font-bold bg-admin-ink/70 text-white px-1.5 py-0.5 rounded-md backdrop-blur-sm">
                  UTAMA
                </span>
              )}
            </div>
          ))}

          {/* Add more slot */}
          {canAdd && (
            <button
              onClick={openModal}
              className="aspect-square rounded-xl border-2 border-dashed border-admin-line flex flex-col items-center justify-center gap-1.5 text-admin-muted/70 hover:border-admin-accent/30 hover:text-admin-accent hover:bg-admin-accent/5 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span className="text-[10px] font-medium">Tambah</span>
            </button>
          )}
        </div>
      )}

      {/* Upload modal */}
      <ImageUploadModal
        open={modalOpen}
        uploading={uploading}
        error={uploadErr}
        onClose={() => { setModalOpen(false) }}
        onUpload={handleUpload}
      />

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-admin-ink/80"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt="preview"
            className="max-w-full max-h-[90vh] rounded-2xl shadow-admin object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
