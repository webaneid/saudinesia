'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, Loader2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { REQUIRED_DOCUMENTS, DOC_LABEL } from '@/lib/constants/booking'
import type { VisaRequirement } from '@/lib/types/visa'
import { DocumentCard } from '@/components/shared/media/DocumentCard'
import { PreviewModal } from '@/components/shared/media/PreviewModal'
import type { DocumentItem } from '@/components/shared/media/useDocuments'

type Props = {
  bookingId: string
  pilgrimId: string
  pilgrimName: string
  bookingCode: string
  requirements?: VisaRequirement[]  // from visaProduct; undefined = use REQUIRED_DOCUMENTS fallback
}

export function PilgrimDocuments({ bookingId, pilgrimId, pilgrimName, bookingCode, requirements }: Props) {
  const base = `/api/v1/pilgrims/${bookingId}/${pilgrimId}/documents`

  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [open,      setOpen]      = useState(true)
  const [zipping,   setZipping]   = useState(false)

  const [previewOpen,     setPreviewOpen]     = useState(false)
  const [previewDocId,    setPreviewDocId]    = useState<string | null>(null)
  const [previewFileName, setPreviewFileName] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(base)
      .then(r => r.json())
      .then(j => {
        if (!j.success) throw new Error(j.error)
        setDocuments(j.data.documents)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [base])

  const openPreview = useCallback((docId: string) => {
    const doc = documents.find(d => d.id === docId)
    if (!doc) return
    setPreviewDocId(docId)
    setPreviewFileName(doc.fileName)
    setPreviewOpen(true)
  }, [documents])

  const getPreviewUrl = useCallback(async (docId: string): Promise<string> => {
    const res  = await fetch(`${base}/${docId}`)
    const json = await res.json()
    if (!json.success) throw new Error(json.error)
    return json.data.url
  }, [base])

  const handleZip = useCallback(async () => {
    setZipping(true)
    try {
      const res = await fetch(`/api/v1/admin/bookings/${bookingId}/documents/zip`)
      if (!res.ok) throw new Error('ZIP generation failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = Object.assign(document.createElement('a'), {
        href: url, download: `docs-${bookingCode}.zip`,
      })
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // silent
    } finally {
      setZipping(false)
    }
  }, [bookingId, bookingCode])

  const docList = requirements
    ? requirements.map(r => ({ docType: r.docType, label: r.label, required: r.required }))
    : REQUIRED_DOCUMENTS.map(t => ({ docType: t, label: DOC_LABEL[t] ?? t, required: true }))

  const requiredCount = docList.filter(d => d.required).length
  const docMap  = Object.fromEntries(documents.map(d => [d.docType, d]))
  const uploaded = documents.length

  return (
    <div className="admin-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-admin-spot/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-bold text-admin-ink">{pilgrimName}</span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            uploaded >= requiredCount
              ? 'bg-admin-ok/10 text-admin-ok'
              : uploaded === 0
              ? 'bg-admin-danger/10 text-admin-danger'
              : 'bg-admin-gold/15 text-admin-gold-strong'
          }`}>
            {uploaded}/{requiredCount} dok
          </span>
        </div>
        <div className="flex items-center gap-2">
          {uploaded > 0 && (
            <button
              onClick={e => { e.stopPropagation(); handleZip() }}
              disabled={zipping}
              className="h-8 px-3 rounded-lg border border-admin-line text-[12px] font-medium text-admin-ink/80 hover:bg-white hover:shadow-admin flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {zipping
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />
              }
              ZIP
            </button>
          )}
          {open ? <ChevronUp className="h-4 w-4 text-admin-muted/70" /> : <ChevronDown className="h-4 w-4 text-admin-muted/70" />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-admin-line pt-4">
          {loading && (
            <div className="flex justify-center py-6 text-admin-muted/70">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-admin-danger text-[12px]">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {uploaded === 0 ? (
                <p className="text-[13px] text-admin-muted/70 py-4 text-center">Belum ada dokumen diupload.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {docList.map(({ docType, label, required }) => (
                    <DocumentCard
                      key={docType}
                      docType={docType}
                      label={label}
                      required={required}
                      document={docMap[docType] ?? null}
                      onUploadClick={() => {}}
                      onPreviewClick={openPreview}
                      onDeleteClick={() => {}}
                      readonly
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <PreviewModal
        open={previewOpen}
        docId={previewDocId}
        fileName={previewFileName}
        onClose={() => { setPreviewOpen(false); setPreviewDocId(null) }}
        onFetchUrl={getPreviewUrl}
      />
    </div>
  )
}
