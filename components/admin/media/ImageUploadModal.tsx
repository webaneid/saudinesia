'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, UploadCloud, ImageIcon, AlertCircle, CheckCircle2 } from 'lucide-react'

const ALLOWED_MIMES  = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_LABEL  = 'JPG, PNG, atau WebP'
const MAX_BYTES      = 5 * 1024 * 1024

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Props = {
  open: boolean
  uploading: boolean
  error: string | null
  onClose: () => void
  onUpload: (file: File, onProgress: (pct: number) => void) => Promise<void>
}

export function ImageUploadModal({ open, uploading, error, onClose, onUpload }: Props) {
  const [file,     setFile]     = useState<File | null>(null)
  const [preview,  setPreview]  = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const [clientErr,setClientErr]= useState<string | null>(null)
  const [done,     setDone]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) { setFile(null); setPreview(null); setProgress(0); setClientErr(null); setDone(false) }
  }, [open])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const validate = (f: File): string | null => {
    if (!ALLOWED_MIMES.includes(f.type)) return `Format tidak didukung. Gunakan ${ALLOWED_LABEL}.`
    if (f.size > MAX_BYTES) return `Ukuran file maksimal 5 MB (file ini ${formatBytes(f.size)}).`
    return null
  }

  const pickFile = useCallback((f: File) => {
    const e = validate(f)
    if (e) { setClientErr(e); return }
    setClientErr(null); setFile(f)
    setPreview(URL.createObjectURL(f))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ''
  }

  const handleSubmit = async () => {
    if (!file) return
    setProgress(0)
    try {
      await onUpload(file, setProgress)
      setDone(true)
      setTimeout(onClose, 800)
    } catch { /* error shown via prop */ }
  }

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const activeErr = clientErr ?? error

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,27,45,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-card border border-line/70 flex flex-col overflow-hidden font-jakarta">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-[15px] font-bold text-ink">Upload Foto</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-canvas grid place-items-center text-slate-400 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl cursor-pointer transition-colors select-none overflow-hidden ${
              dragOver
                ? 'border-teal-400 bg-teal-50'
                : file
                ? 'border-mint-300 bg-mint-50/30'
                : 'border-line hover:border-teal-300 hover:bg-canvas/50'
            } ${uploading ? 'pointer-events-none' : ''}`}
          >
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={handleInput} />

            {preview ? (
              <div className="relative">
                <img src={preview} alt="preview" className="w-full h-48 object-cover" />
                <div className="absolute inset-0 bg-ink/20 flex items-end p-3">
                  <div className="bg-white/90 rounded-lg px-2 py-1 backdrop-blur-sm">
                    <p className="text-[11px] font-medium text-ink truncate max-w-[180px]">{file!.name}</p>
                    <p className="text-[10px] text-slate-500">{formatBytes(file!.size)}</p>
                  </div>
                  {!uploading && (
                    <p className="ml-auto text-[11px] text-white font-medium bg-ink/60 rounded-lg px-2 py-1">Klik ganti</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 flex flex-col items-center gap-2">
                <UploadCloud className="h-10 w-10 text-slate-300" />
                <p className="text-[13px] font-medium text-ink2">Seret foto ke sini</p>
                <p className="text-[11px] text-slate-400">atau klik untuk pilih</p>
                <p className="text-[11px] text-slate-400">{ALLOWED_LABEL} · Maks 5 MB</p>
              </div>
            )}
          </div>

          {/* Progress */}
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Mengupload…</span><span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-canvas overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-600 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success */}
          {done && (
            <div className="flex items-center gap-2 text-mint-700 text-[13px] font-medium">
              <CheckCircle2 className="h-4 w-4" /> Foto berhasil diupload!
            </div>
          )}

          {/* Error */}
          {activeErr && !done && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-100 rounded-xl p-3">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-[12px] text-rose-700">{activeErr}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose} disabled={uploading}
            className="flex-1 h-10 rounded-xl border border-line text-[13px] font-medium text-ink2 hover:bg-canvas disabled:opacity-50 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit} disabled={!file || uploading || done}
            className="flex-1 h-10 rounded-xl bg-ink text-white text-[13px] font-semibold hover:bg-ink2 disabled:opacity-40 transition-colors"
          >
            {uploading ? 'Mengupload…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
