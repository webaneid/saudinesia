// Satu sumber kebenaran untuk transisi status visa — dipakai client (VisaActions.tsx) dan
// server (app/api/v1/admin/visa/[pilgrimId]/status/route.ts). Sebelumnya cuma ada di client,
// jadi endpoint bisa dipanggil langsung untuk melompat status sembarangan — docs/arsitektur-visa.md §7 Gap #5.
export const VISA_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending_documents:     ['documents_complete'],
  documents_complete:    ['submitted_to_syarikah'],
  submitted_to_syarikah: ['in_review'],
  in_review:             ['issued', 'rejected'],
  issued:                [],
  rejected:              ['pending_documents'],
}

export function isValidVisaStatusTransition(from: string, to: string): boolean {
  return (VISA_STATUS_TRANSITIONS[from] ?? []).includes(to)
}
