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
    <div className={`admin-card p-4 flex flex-col gap-3 relative ${filled ? 'border-teal-200/60' : 'border-line'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {filled
            ? <CheckCircle2 className="h-4 w-4 text-mint-600 shrink-0" />
            : <Clock className="h-4 w-4 text-slate-400 shrink-0" />
          }
          <span className="text-[13px] font-semibold text-ink leading-snug">{label}</span>
          {!required && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">Opsional</span>
          )}
        </div>

        {filled && !readonly && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="h-7 w-7 rounded-lg hover:bg-canvas grid place-items-center text-slate-400 transition-colors"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-8 z-20 bg-white border border-line rounded-xl shadow-card p-1 min-w-[130px]"
                onBlur={() => setMenuOpen(false)}
              >
                <button
                  onClick={() => { setMenuOpen(false); onPreviewClick(document!.id) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink2 hover:bg-canvas rounded-lg transition-colors"
                >
                  <Eye className="h-3.5 w-3.5" /> Lihat
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onUploadClick(docType) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-ink2 hover:bg-canvas rounded-lg transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" /> Ganti
                </button>
                <div className="h-px bg-line my-1" />
                <button
                  onClick={() => { setMenuOpen(false); onDeleteClick(document!.id, label) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
            className="h-14 w-14 rounded-xl bg-canvas border border-line flex items-center justify-center shrink-0 hover:border-teal-300 transition-colors group"
          >
            {isImage(document!.fileName)
              ? <ImageIcon className="h-6 w-6 text-teal-500 group-hover:text-teal-600" />
              : <FileText className="h-6 w-6 text-slate-400 group-hover:text-slate-500" />
            }
          </button>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-ink truncate">{document!.fileName}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {formatBytes(document!.fileSizeBytes)} · {formatDate(document!.uploadedAt)}
            </p>
          </div>
        </div>
      ) : (
        <div className="h-14 flex items-center">
          <p className="text-[12px] text-slate-400">Belum diupload</p>
        </div>
      )}

      {/* Action */}
      {!readonly && (
        <div className="flex gap-2">
          {filled ? (
            <button
              onClick={() => onPreviewClick(document!.id)}
              className="flex-1 h-8 rounded-lg border border-line text-[12px] font-medium text-ink2 hover:bg-canvas flex items-center justify-center gap-1.5 transition-colors"
            >
              <Eye className="h-3.5 w-3.5" /> Lihat
            </button>
          ) : (
            <button
              onClick={() => onUploadClick(docType)}
              className="flex-1 h-8 rounded-lg bg-ink text-white text-[12px] font-medium hover:bg-ink2 flex items-center justify-center gap-1.5 transition-colors"
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
          className="h-8 w-full rounded-lg border border-line text-[12px] font-medium text-ink2 hover:bg-canvas flex items-center justify-center gap-1.5 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" /> Lihat
        </button>
      )}
    </div>
  )
}
