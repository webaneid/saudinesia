'use client'

import { useEffect, useState } from 'react'
import { X, FileText, Loader2, ExternalLink, AlertCircle } from 'lucide-react'

type Props = {
  open: boolean
  docId: string | null
  fileName: string
  onClose: () => void
  onFetchUrl: (docId: string) => Promise<string>
}

export function PreviewModal({ open, docId, fileName, onClose, onFetchUrl }: Props) {
  const [url,     setUrl]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const isPdf   = /\.pdf$/i.test(fileName)
  const isImage = /\.(jpe?g|png)$/i.test(fileName)

  useEffect(() => {
    if (!open || !docId) { setUrl(null); return }
    setLoading(true); setError(null); setUrl(null)
    onFetchUrl(docId)
      .then(u  => setUrl(u))
      .catch(() => setError('Gagal memuat file. Coba lagi.'))
      .finally(() => setLoading(false))
  }, [open, docId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,27,45,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-card border border-line/70 flex flex-col overflow-hidden font-jakarta">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="text-[13px] font-semibold text-ink truncate">{fileName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-3 rounded-lg border border-line text-[12px] font-medium text-ink2 hover:bg-canvas flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Buka
              </a>
            )}
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg hover:bg-canvas grid place-items-center text-slate-400 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0 flex items-center justify-center bg-canvas/40 p-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-[13px]">Memuat file…</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p className="text-[13px] text-rose-600">{error}</p>
            </div>
          )}

          {url && !loading && (
            <>
              {isImage && (
                <img
                  src={url}
                  alt={fileName}
                  className="max-w-full max-h-[70vh] rounded-xl shadow-soft object-contain"
                />
              )}
              {isPdf && (
                <iframe
                  src={url}
                  title={fileName}
                  className="w-full h-[70vh] rounded-xl border border-line"
                />
              )}
              {!isImage && !isPdf && (
                <div className="flex flex-col items-center gap-4 py-12">
                  <FileText className="h-16 w-16 text-slate-300" />
                  <p className="text-[14px] text-ink2 font-medium">{fileName}</p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-btn"
                  >
                    <ExternalLink className="h-4 w-4" /> Buka / Download
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
