'use client'

import { useState, useCallback } from 'react'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { REQUIRED_DOCUMENTS, DOC_LABEL, type DocType } from '@/lib/constants/booking'
import type { VisaRequirement } from '@/lib/types/visa'
import { useDocuments } from './useDocuments'
import { DocumentCard } from './DocumentCard'
import { UploadModal } from './UploadModal'
import { PreviewModal } from './PreviewModal'

type Props = {
  bookingId: string
  pilgrimId: string
  pilgrimName: string
  requirements?: VisaRequirement[]  // dynamic per visa product; falls back to REQUIRED_DOCUMENTS
}

export function DocumentGrid({ bookingId, pilgrimId, pilgrimName, requirements }: Props) {
  const docs = useDocuments(bookingId, pilgrimId)

  const [uploadOpen,    setUploadOpen]    = useState(false)
  const [uploadDocType, setUploadDocType] = useState<string | undefined>(undefined)
  const [previewOpen,    setPreviewOpen]    = useState(false)
  const [previewDocId,   setPreviewDocId]   = useState<string | null>(null)
  const [previewFileName, setPreviewFileName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)

  // Normalise to a flat list of { docType, label }
  const docList = requirements
    ? requirements.map(r => ({ docType: r.docType, label: r.label, required: r.required }))
    : REQUIRED_DOCUMENTS.map(t => ({ docType: t, label: DOC_LABEL[t] ?? t, required: true }))

  const openUpload = useCallback((docType: string) => {
    setUploadDocType(docType)
    setUploadOpen(true)
    docs.clearUploadError()
  }, [docs])

  const openPreview = useCallback((docId: string) => {
    const doc = docs.documents.find(d => d.id === docId)
    if (!doc) return
    setPreviewDocId(docId)
    setPreviewFileName(doc.fileName)
    setPreviewOpen(true)
  }, [docs.documents])

  const confirmDelete = useCallback((id: string, label: string) => {
    setDeleteTarget({ id, label })
  }, [])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try { await docs.remove(deleteTarget.id) }
    catch { /* error surfaced via hook */ }
    finally { setDeleteTarget(null) }
  }, [deleteTarget, docs])

  const handleUpload = useCallback(
    async (docType: DocType, file: File, onProgress: (pct: number) => void) => {
      await docs.upload(docType, file, onProgress)
    },
    [docs],
  )

  const getPreviewUrl = useCallback(
    (docId: string) => docs.getPreviewUrl(docId),
    [docs],
  )

  const docMap   = Object.fromEntries(docs.documents.map(d => [d.docType, d]))
  const required = docList.filter(d => d.required)
  const uploaded = required.filter(d => docMap[d.docType]).length
  const total    = required.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-ink">Dokumen {pilgrimName}</h3>
          <p className={`text-[12px] mt-0.5 font-medium ${uploaded === total ? 'text-mint-700' : 'text-slate-500'}`}>
            {uploaded} dari {total} dokumen wajib telah diupload
          </p>
        </div>
        <button
          onClick={() => docs.refresh()}
          disabled={docs.loading}
          className="h-8 w-8 rounded-lg border border-line grid place-items-center text-slate-400 hover:text-ink hover:bg-canvas transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${docs.loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {docs.error && (
        <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-xl p-3 text-[12px] text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {docs.error}
        </div>
      )}

      {docs.loading && !docs.error && (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {!docs.loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {docList.map(({ docType, label, required: isRequired }) => (
            <DocumentCard
              key={docType}
              docType={docType}
              label={label}
              required={isRequired}
              document={docMap[docType] ?? null}
              onUploadClick={openUpload}
              onPreviewClick={openPreview}
              onDeleteClick={confirmDelete}
            />
          ))}
        </div>
      )}

      <UploadModal
        open={uploadOpen}
        defaultDocType={uploadDocType}
        requirements={requirements}
        uploading={docs.uploading}
        uploadError={docs.uploadError}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />

      <PreviewModal
        open={previewOpen}
        docId={previewDocId}
        fileName={previewFileName}
        onClose={() => { setPreviewOpen(false); setPreviewDocId(null) }}
        onFetchUrl={getPreviewUrl}
      />

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,27,45,0.45)', backdropFilter: 'blur(2px)' }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl border border-line shadow-card p-6 space-y-4 font-jakarta">
            <h3 className="text-[15px] font-bold text-ink">Hapus Dokumen</h3>
            <p className="text-[13px] text-slate-500">
              Hapus <strong className="text-ink">{deleteTarget.label}</strong>? Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 h-10 rounded-xl border border-line text-[13px] font-medium text-ink2 hover:bg-canvas transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 h-10 rounded-xl bg-rose-600 text-white text-[13px] font-semibold hover:bg-rose-700 transition-colors"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
