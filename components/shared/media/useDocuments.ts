'use client'

import { useState, useCallback, useEffect } from 'react'
import { REQUIRED_DOCUMENTS, type DocType } from '@/lib/constants/booking'

export type DocumentItem = {
  id: string
  docType: string
  fileName: string
  fileSizeBytes: number | null
  uploadedAt: string
}

export type DocumentsState = {
  documents: DocumentItem[]
  missing: string[]
  loading: boolean
  error: string | null
}

export type UseDocumentsReturn = DocumentsState & {
  refresh: () => Promise<void>
  upload: (docType: DocType, file: File, onProgress?: (pct: number) => void) => Promise<void>
  remove: (docId: string) => Promise<void>
  getPreviewUrl: (docId: string) => Promise<string>
  uploadError: string | null
  uploading: boolean
  clearUploadError: () => void
}

export function useDocuments(bookingId: string, pilgrimId: string): UseDocumentsReturn {
  const base = `/api/v1/pilgrims/${bookingId}/${pilgrimId}/documents`

  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [missing,   setMissing]   = useState<string[]>([...REQUIRED_DOCUMENTS])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(base)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load documents')
      setDocuments(json.data.documents)
      setMissing(json.data.missing)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { refresh() }, [refresh])

  // Upload via XHR to track progress (fetch doesn't expose upload progress)
  const upload = useCallback(
    (docType: DocType, file: File, onProgress?: (pct: number) => void) =>
      new Promise<void>((resolve, reject) => {
        setUploading(true)
        setUploadError(null)

        const formData = new FormData()
        formData.append('file', file)
        formData.append('docType', docType)

        const xhr = new XMLHttpRequest()

        if (onProgress) {
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
          })
        }

        xhr.addEventListener('load', async () => {
          setUploading(false)
          if (xhr.status === 201) {
            await refresh()
            resolve()
          } else {
            let msg = 'Upload failed'
            try { msg = JSON.parse(xhr.responseText)?.error ?? msg } catch { /* */ }
            setUploadError(msg)
            reject(new Error(msg))
          }
        })

        xhr.addEventListener('error', () => {
          setUploading(false)
          const msg = 'Network error. Please try again.'
          setUploadError(msg)
          reject(new Error(msg))
        })

        xhr.open('POST', base)
        xhr.send(formData)
      }),
    [base, refresh],
  )

  const remove = useCallback(async (docId: string) => {
    const res  = await fetch(`${base}/${docId}`, { method: 'DELETE' })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'Delete failed')
    await refresh()
  }, [base, refresh])

  const getPreviewUrl = useCallback(async (docId: string): Promise<string> => {
    const res  = await fetch(`${base}/${docId}`)
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'Preview unavailable')
    return json.data.url as string
  }, [base])

  const clearUploadError = useCallback(() => setUploadError(null), [])

  return {
    documents, missing, loading, error,
    uploading, uploadError, clearUploadError,
    refresh, upload, remove, getPreviewUrl,
  }
}
