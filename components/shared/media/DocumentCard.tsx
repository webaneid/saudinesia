'use client'

import { useState } from 'react'
import {
  FileText, Upload, Eye, Trash2, MoreVertical,
  CheckCircle2, Clock, ImageIcon,
} from 'lucide-react'
import { DOC_LABEL } from '@/lib/constants/booking'
import type { DocumentItem } from './useDocuments'

type Props = {
  docType: string
  label?: string       // overrides DOC_LABEL lookup
  required?: boolean   // shows optional badge if false
  document: DocumentItem | null
  onUploadClick: (docType: string) => void
  onPreviewClick: (docId: string) => void
  onDeleteClick: (docId: string, label: string) => void
  readonly?: boolean
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function isImage(fileName: string): boolean {
  return /\.(jpe?g|png)$/i.test(fileName)
}

export function DocumentCard({ docType, label: labelProp, required = true, document, onUploadClick, onPreviewClick, onDeleteClick, readonly = false }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const label  = labelProp ?? DOC_LABEL[docType] ?? docType
  const filled = !!document

  return (
    <div className={`admin-card p-4 flex flex-col gap-3 relative ${filled ? 'border-admin-accent/20' : 'border-admin-line'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {filled
            ? <CheckCircle2 className="h-4 w-4 text-admin-ok shrink-0" />
            : <Clock className="h-4 w-4 text-admin-muted/70 shrink-0" />
          }
          <span className="text-[13px] font-semibold text-admin-ink leading-snug">{label}</span>
          {!required && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-admin-spot text-admin-muted shrink-0">Opsional</span>
          )}
        </div>

        {filled && !readonly && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="h-7 w-7 rounded-lg hover:bg-admin-spot grid place-items-center text-admin-muted/70 transition-colors"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-8 z-20 bg-white border border-admin-line rounded-xl shadow-admin p-1 min-w-[130px]"
                onBlur={() => setMenuOpen(false)}
              >
                <button
                  onClick={() => { setMenuOpen(false); onPreviewClick(document!.id) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-admin-ink/80 hover:bg-admin-spot rounded-lg transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" /> Lihat
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onUploadClick(docType) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-admin-ink/80 hover:bg-admin-spot rounded-lg transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" /> Ganti
                </button>
                <div className="h-px bg-admin-line my-1" />
                <button
                  onClick={() => { setMenuOpen(false); onDeleteClick(document!.id, label) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-admin-danger hover:bg-admin-danger/10 rounded-lg transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Hapus
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {filled ? (
        <div className="flex items-center gap-3">
          {/* Thumbnail placeholder */}
          <button
            onClick={() => onPreviewClick(document!.id)}
            className="h-14 w-14 rounded-xl bg-admin-spot border border-admin-line flex items-center justify-center shrink-0 hover:border-admin-accent/30 transition-colors group"
          >
            {isImage(document!.fileName)
              ? <ImageIcon className="h-6 w-6 text-admin-accent group-hover:text-admin-accent" />
              : <FileText className="h-6 w-6 text-admin-muted/70 group-hover:text-admin-muted" />
            }
          </button>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-admin-ink truncate">{document!.fileName}</p>
            <p className="text-[11px] text-admin-muted mt-0.5">
              {formatBytes(document!.fileSizeBytes)} · {formatDate(document!.uploadedAt)}
            </p>
          </div>
        </div>
      ) : (
        <div className="h-14 flex items-center">
          <p className="text-[12px] text-admin-muted/70">Belum diupload</p>
        </div>
      )}

      {/* Action */}
      {!readonly && (
        <div className="flex gap-2">
          {filled ? (
            <button
              onClick={() => onPreviewClick(document!.id)}
              className="flex-1 h-8 rounded-lg border border-admin-line text-[12px] font-medium text-admin-ink/80 hover:bg-admin-spot flex items-center justify-center gap-1.5 transition-colors"
            >
              <Eye className="h-3.5 w-3.5" /> Lihat
            </button>
          ) : (
            <button
              onClick={() => onUploadClick(docType)}
              className="flex-1 h-8 rounded-lg bg-admin-accent text-white text-[12px] font-medium hover:bg-admin-accent-strong flex items-center justify-center gap-1.5 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" /> Upload
            </button>
          )}
        </div>
      )}

      {/* Readonly preview button */}
      {readonly && filled && (
        <button
          onClick={() => onPreviewClick(document!.id)}
          className="h-8 w-full rounded-lg border border-admin-line text-[12px] font-medium text-admin-ink/80 hover:bg-admin-spot flex items-center justify-center gap-1.5 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" /> Lihat
        </button>
      )}
    </div>
  )
}
