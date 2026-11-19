import type { VisaStatus } from '@prisma/client'

// Linimasa status visa per jamaah (docs/arsitektur-visa.md §9) — MURNI (aman di klien): dari status terkini + riwayat `visa_status_events`.
// Langkah tetap: 4 langkah proses lalu satu langkah akhir (Terbit, atau Ditolak bila status terkini Ditolak). Setelah ditolak lalu diproses ulang,
// linimasa memakai putaran TERAKHIR (riwayat sejak kembali ke "Menunggu dokumen"); penolakan sebelumnya tidak ditampilkan sebagai langkah.

export const VISA_PROCESS_STEPS = ['pending_documents', 'documents_complete', 'submitted_to_syarikah', 'in_review'] as const satisfies readonly VisaStatus[]

export type VisaEvent = { fromStatus: VisaStatus | null; toStatus: VisaStatus; createdAt: Date }
export type VisaStep = { status: VisaStatus; state: 'done' | 'current' | 'todo' | 'rejected'; at: Date | null }

export function visaTimeline(current: VisaStatus, events: readonly VisaEvent[]): VisaStep[] {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const restart = sorted.map(e => e.fromStatus === 'rejected' && e.toStatus === 'pending_documents').lastIndexOf(true)
  const round = restart < 0 ? sorted : sorted.slice(restart)
  const at = (s: VisaStatus) => [...round].reverse().find(e => e.toStatus === s)?.createdAt ?? null
  const final: VisaStatus = current === 'rejected' ? 'rejected' : 'issued'
  const order: VisaStatus[] = [...VISA_PROCESS_STEPS, final]
  const idx = order.indexOf(current)
  return order.map((status, i) => ({
    status,
    state: status === 'rejected' ? 'rejected' : i < idx || (status === 'issued' && current === 'issued') ? 'done' : i === idx ? 'current' : 'todo',
    at: i <= idx ? at(status) : null,
  }))
}

export const VISA_TONE_PUBLIC: Record<VisaStatus, 'muted' | 'warning' | 'destructive' | 'success'> = {
  pending_documents: 'warning',
  documents_complete: 'muted',
  submitted_to_syarikah: 'muted',
  in_review: 'muted',
  issued: 'success',
  rejected: 'destructive',
}
