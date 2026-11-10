'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Circle, Clock, FileText, FolderOpen, Plane, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/shared/Modal'
import { DocumentRepeater } from '@/components/shared/documents/DocumentRepeater'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'

// Kelengkapan dokumen satu jamaah di booking (docs/arsitektur-jamaah.md §5.5 butir 2) — SATU komponen untuk halaman jamaah dan admin
// (endpoint berbeda: milik pemilik vs atas nama pelanggan). Status dihitung server (evaluateCompleteness).
// Ringkas: progres "n dari m", satu baris per syarat dengan arti status dalam kalimat, dan tombol Unggah yang membuka pengunggah yang SAMA
// (DocumentRepeater) dalam popup: dokumen pribadi (paspor/KTP — tersimpan di kartu Jamaah Saya) atau dokumen perjalanan (booking ini).

export type ChecklistItemView = {
  key: string
  documentTypeId: string
  label: string
  required: boolean
  state: string
  sources: string[]
  /** true = dokumen pribadi di kartu (dipakai ulang), false = dokumen perjalanan booking ini. */
  reusable: boolean
  validUntilNeeded: string | null
}

type Props = {
  items: ChecklistItemView[]
  card: { id: string; name: string } | null
  /** Koleksi dokumen kartu (pribadi) dan dokumen perjalanan jamaah booking ini — pemanggil memilih route jamaah atau admin. */
  endpoints: { personal: string; trip: string } | null
  /** Teks untuk jamaah belum tertaut (jamaah: "Pilih atau tambah…", admin: "Tautkan kartu…"). */
  emptyHint?: string
}

const DONE = new Set(['pending', 'accepted'])
const PROBLEM = new Set(['rejected', 'expired', 'too_short'])

function statusText(i: ChecklistItemView): string {
  switch (i.state) {
    case 'accepted': return 'Diterima petugas'
    case 'pending': return 'Sudah diunggah, menunggu pemeriksaan petugas'
    case 'rejected': return 'Ditolak petugas — unggah ulang'
    case 'expired': return 'Sudah habis berlaku — unggah yang baru'
    case 'too_short': return i.validUntilNeeded ? `Harus berlaku sampai ${formatCalendarDate(i.validUntilNeeded, DATE_LONG)} — unggah yang baru` : 'Masa berlaku kurang — unggah yang baru'
    default: return 'Belum diunggah'
  }
}

function StatusIcon({ state }: { state: string }) {
  if (state === 'accepted') return <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />
  if (state === 'pending') return <Clock className="h-5 w-5 shrink-0 text-amber-600" aria-hidden />
  if (PROBLEM.has(state)) return <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
  return <Circle className="h-5 w-5 shrink-0 text-muted-foreground/60" aria-hidden />
}

const segmentTone = (state: string) =>
  state === 'accepted' ? 'bg-primary' : state === 'pending' ? 'bg-amber-500' : PROBLEM.has(state) ? 'bg-destructive' : 'bg-muted'

export function DocumentChecklist({ items, card, endpoints, emptyHint = 'Pilih atau tambah data jamaah dulu, lalu dokumen berikut bisa diunggah di sini:' }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<{ personal: boolean; typeId?: string } | null>(null)
  if (items.length === 0) return null

  const done = items.filter(i => DONE.has(i.state)).length
  const sources = [...new Set(items.flatMap(i => i.sources))]
  const oneSource = sources.length === 1 ? sources[0] : null

  return (
    <section className="space-y-3 rounded-md border p-3" aria-label="Kelengkapan dokumen">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Kelengkapan dokumen</p>
          {card && <p className="text-xs text-muted-foreground tabular-nums">{done} dari {items.length} sudah diunggah</p>}
        </div>
        {card && (
          <div className="flex gap-1" aria-hidden>
            {items.map(i => <span key={i.key} className={`h-1.5 flex-1 rounded-full ${segmentTone(i.state)}`} />)}
          </div>
        )}
        {oneSource && <p className="text-xs text-muted-foreground">Diminta oleh {oneSource}</p>}
      </div>

      {!card ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
          <ul className="flex flex-wrap gap-1.5">
            {items.map(i => (
              <li key={i.key} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> {i.label}{i.required ? '' : ' (opsional)'}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <ul className="divide-y">
            {items.map(i => {
              const needsUpload = !DONE.has(i.state)
              return (
                <li key={i.key} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1">
                  <StatusIcon state={i.state} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{i.label}{i.required ? '' : <span className="font-normal text-muted-foreground"> (opsional)</span>}</p>
                    <p className={`text-xs ${PROBLEM.has(i.state) ? 'text-destructive' : 'text-muted-foreground'}`}>{statusText(i)}</p>
                    {!oneSource && i.sources.length > 0 && <p className="text-xs text-muted-foreground">Diminta oleh {i.sources.join(', ')}</p>}
                  </div>
                  <Button size="sm" variant={needsUpload ? 'default' : 'ghost'} className="shrink-0"
                    onClick={() => setOpen({ personal: i.reusable, typeId: needsUpload ? i.documentTypeId : undefined })}
                    aria-label={`${needsUpload ? 'Unggah' : 'Lihat'} ${i.label}`}>
                    {needsUpload ? <><Upload className="h-4 w-4" /> {i.state === 'missing' ? 'Unggah' : 'Ganti'}</> : 'Lihat'}
                  </Button>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {items.some(i => i.reusable) && <Button size="sm" variant="outline" onClick={() => setOpen({ personal: true })}><FolderOpen className="h-4 w-4" /> Dokumen pribadi</Button>}
            {items.some(i => !i.reusable) && <Button size="sm" variant="outline" onClick={() => setOpen({ personal: false })}><Plane className="h-4 w-4" /> Dokumen perjalanan</Button>}
          </div>
        </>
      )}

      {card && endpoints && open && (
        <Modal open title={open.personal ? `Dokumen pribadi — ${card.name}` : `Dokumen perjalanan — ${card.name}`} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {open.personal
                ? 'Dokumen pribadi yang diminta booking ini. Tersimpan di data jamaah (Jamaah Saya) dan dipakai lagi untuk pesanan berikutnya.'
                : 'Dokumen perjalanan yang diminta booking ini — hanya untuk booking ini.'}
            </p>
            <DocumentRepeater
              key={`${open.personal}-${open.typeId ?? ''}`}
              endpoint={open.personal ? endpoints.personal : endpoints.trip}
              openTypeId={open.typeId}
              // Dokumen pribadi: hanya syarat produk (jenis lain tetap di kartu untuk booking lain — dikelola di Jamaah Saya). Perjalanan disaring
              // server (tripUploadableTypes) — tanpa saringan klien supaya berkas lama yang tak diminta tampil bertanda "Tidak diperlukan".
              onlyTypeIds={open.personal ? items.filter(i => i.reusable).map(i => i.documentTypeId) : undefined}
              onChange={() => router.refresh()}
            />
          </div>
        </Modal>
      )}
    </section>
  )
}
