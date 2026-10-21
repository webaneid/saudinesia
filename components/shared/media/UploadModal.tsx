'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { X, UploadCloud, FileText, ImageIcon, AlertCircle, CheckCircle2 } from 'lucide-react'
import { DOC_LABEL, REQUIRED_DOCUMENTS, type DocType } from '@/lib/constants/booking'
import type { VisaRequirement } from '@/lib/types/visa'

const ALLOWED_MIMES  = ['image/jpeg', 'image/png', 'application/pdf']
const ALLOWED_LABEL  = 'JPG, PNG, atau PDF'
const MAX_BYTES      = 5 * 1024 * 1024

type Props = {
  open: boolean
  defaultDocType?: string        // pre-select docType when opened from a card
  requirements?: VisaRequirement[] // dynamic list; falls back to REQUIRED_DOCUMENTS
  uploading: boolean
  uploadError: string | null
  onClose: () => void
  onUpload: (docType: DocType, file: File, onProgress: (pct: number) => void) => Promise<void>
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(file: File) { return file.type.startsWith('image/') }

export function UploadModal({ open, defaultDocType, requirements, uploading, uploadError, onClose, onUpload }: Props) {
  const docOptions = requirements
    ? requirements.map(r => ({ value: r.docType, label: r.label }))
    : REQUIRED_DOCUMENTS.map(t => ({ value: t, label: DOC_LABEL[t] ?? t }))

  const firstType = (docOptions[0]?.value ?? REQUIRED_DOCUMENTS[0]) as DocType
  const [docType,   setDocType]   = useState<DocType>((defaultDocType as DocType) ?? firstType)
  const [file,      setFile]      = useState<File | null>(null)
  const [preview,   setPreview]   = useState<string | null>(null)
  const [dragOver,  setDragOver]  = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [clientErr, setClientErr] = useState<string | null>(null)
  const [done,      setDone]      = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Sync defaultDocType when modal opens for a specific card
  useEffect(() => {
    if (open) {
      setDocType((defaultDocType as DocType) ?? firstType)
      setFile(null); setPreview(null); setProgress(0)
      setClientErr(null); setDone(false)
    }
  }, [open, defaultDocType])

  // Revoke object URL on cleanup
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const validate = (f: File): string | null => {
    if (!ALLOWED_MIMES.includes(f.type)) return `Format tidak didukung. Gunakan ${ALLOWED_LABEL}.`
    if (f.size > MAX_BYTES) return `Ukuran file maksimal 5 MB (file ini ${formatBytes(f.size)}).`
    return null
  }

  const pickFile = useCallback((f: File) => {
    const err = validate(f)
    if (err) { setClientErr(err); return }
    setClientErr(null)
    setFile(f)
    if (isImage(f)) setPreview(URL.createObjectURL(f))
    else setPreview(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) pickFile(f)
    e.target.value = '' // reset so same file can be re-selected
  }

  const handleSubmit = async () => {
    if (!file) return
    setProgress(0)
    try {
      await onUpload(docType, file, setProgress)
      setDone(true)
      setTimeout(() => { onClose() }, 900)
    } catch {
      // error shown via uploadError prop
    }
  }

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const activeErr = clientErr ?? uploadError

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-admin-ink/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Panel */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-admin border border-admin-line flex flex-col overflow-hidden font-jakarta">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-admin-line">
          <h2 className="text-[15px] font-bold text-admin-ink">Upload Dokumen</h2>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-admin-spot grid place-items-center text-admin-muted/70 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Doc type selector */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-muted block mb-1.5">
              Jenis Dokumen
            </label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value as DocType)}
              disabled={!!defaultDocType || uploading}
              className="admin-select text-sm disabled:opacity-60"
            >
              {docOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors select-none ${
              dragOver
                ? 'border-admin-accent/50 bg-admin-accent/10'
                : file
                ? 'border-admin-ok/30 bg-admin-ok/5'
                : 'border-admin-line hover:border-admin-accent/30 hover:bg-admin-spot/40'
            } ${uploading ? 'pointer-events-none' : ''}`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              className="hidden"
              onChange={handleFileInput}
            />

            {file ? (
              <>
                {preview
                  ? <img src={preview} alt="preview" className="h-20 w-20 object-cover rounded-xl border border-admin-line" />
                  : <FileText className="h-12 w-12 text-admin-accent" />
                }
                <p className="text-[13px] font-semibold text-admin-ink text-center">{file.name}</p>
                <p className="text-[11px] text-admin-muted">{formatBytes(file.size)} · {file.type.split('/')[1]?.toUpperCase()}</p>
                {!uploading && (
                  <p className="text-[11px] text-admin-accent font-medium">Klik untuk ganti file</p>
                )}
              </>
            ) : (
              <>
                <UploadCloud className="h-10 w-10 text-admin-muted/50" />
                <p className="text-[13px] font-medium text-admin-ink/80">Seret file ke sini</p>
                <p className="text-[11px] text-admin-muted/70">atau klik untuk pilih file</p>
                <p className="text-[11px] text-admin-muted/70">{ALLOWED_LABEL} · Maks 5 MB</p>
              </>
            )}
          </div>

          {/* Progress bar */}
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px] text-admin-muted">
                <span>Mengupload…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-admin-spot overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-admin-primary-medium to-admin-accent transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success state */}
          {done && (
            <div className="flex items-center gap-2 text-admin-ok text-[13px] font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Upload berhasil!
            </div>
          )}

          {/* Error */}
          {activeErr && !done && (
            <div className="flex items-start gap-2 bg-admin-danger/10 border border-admin-danger/20 rounded-xl p-3">
              <AlertCircle className="h-4 w-4 text-admin-danger/80 shrink-0 mt-0.5" />
              <p className="text-[12px] text-admin-danger">{activeErr}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={uploading}
            className="flex-1 h-10 rounded-xl border border-admin-line text-[13px] font-medium text-admin-ink/80 hover:bg-admin-spot disabled:opacity-50 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={!file || uploading || done}
            className="flex-1 h-10 rounded-xl bg-admin-accent text-white text-[13px] font-semibold hover:bg-admin-accent-strong disabled:opacity-40 transition-colors"
          >
            {uploading ? 'Mengupload…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}
