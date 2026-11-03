// Label status satu syarat dokumen (hasil `evaluateCompleteness`) — satu sumber untuk panel admin dan halaman booking jamaah
// (docs/arsitektur-jamaah.md §5.5 butir 2). Nada dipetakan ke lencana masing-masing area (admin `Badge` tone, jamaah varian shadcn).
export type ChecklistTone = 'ok' | 'warning' | 'danger' | 'neutral'

export const CHECKLIST_STATE: Record<string, { label: string; tone: ChecklistTone }> = {
  accepted: { label: 'Diterima', tone: 'ok' },
  pending: { label: 'Menunggu', tone: 'warning' },
  missing: { label: 'Belum ada', tone: 'danger' },
  rejected: { label: 'Ditolak', tone: 'danger' },
  expired: { label: 'Habis berlaku', tone: 'danger' },
  too_short: { label: 'Masa berlaku kurang', tone: 'danger' },
}

export const checklistState = (state: string) => CHECKLIST_STATE[state] ?? { label: state, tone: 'neutral' as const }
