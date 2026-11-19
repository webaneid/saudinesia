import { z } from 'zod'

// Satu sumber kebenaran untuk transisi status visa — dipakai client (VisaActions.tsx) dan
// server (app/api/v1/admin/visa/[pilgrimId]/status/route.ts). Sebelumnya cuma ada di client,
// jadi endpoint bisa dipanggil langsung untuk melompat status sembarangan — docs/arsitektur-visa.md §2/§4 (dulu Gap #5).
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

export const VISA_STATUSES = ['pending_documents', 'documents_complete', 'submitted_to_syarikah', 'in_review', 'issued', 'rejected'] as const

/** Ubah status visa (admin). Alasan penolakan DITAMPILKAN ke jamaah (docs/arsitektur-visa.md §9, V2) → wajib saat menolak; `notes` = catatan internal. */
export const visaStatusChangeSchema = z.object({
  status: z.enum(VISA_STATUSES),
  notes: z.string().trim().max(2000).optional(),
  rejectionReason: z.string().trim().max(1000, 'Alasan penolakan maksimal 1000 karakter').optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'rejected' && (v.rejectionReason ?? '').length < 3) ctx.addIssue({ code: 'custom', message: 'Tulis alasan penolakan untuk jamaah (minimal 3 karakter)', path: ['rejectionReason'] })
  if (v.status !== 'rejected' && v.rejectionReason) ctx.addIssue({ code: 'custom', message: 'Alasan penolakan hanya untuk status Ditolak', path: ['rejectionReason'] })
})
export type VisaStatusChange = z.infer<typeof visaStatusChangeSchema>
