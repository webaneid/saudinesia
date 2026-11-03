import { addMonths, type CalendarDate } from '@/lib/time'

// Evaluator kelengkapan dokumen (docs/arsitektur-jamaah.md §7.2/§7.6) — SATU-SATUNYA tempat aturan "dokumen syarat sudah terpenuhi" dihitung.
// Murni (tanpa DB), aman di server dan klien. Syarat = gabungan syarat semua produk yang dipakai jamaah (`mergeRequirements`); dokumen = berkas
// jamaah itu. Masa berlaku dihitung atas TANGGAL KALENDER: `referenceDate` = tanggal berangkat bila diketahui, selain itu hari ini (zona aplikasi).

export type RequirementView = {
  documentTypeId: string
  key: string
  /** Label tampil (pengganti per produk, atau label katalog). */
  label: string
  /** Label katalog jenis dokumen. */
  typeLabel: string
  description: string
  required: boolean
  icon: string
  reusable: boolean
  hasExpiry: boolean
  minValidityMonths: number | null
}

export type DocumentForCompleteness = {
  documentTypeId: string
  status: 'pending' | 'accepted' | 'rejected'
  expiresAt: CalendarDate | null
}

/** Urutan dari terburuk ke terbaik — dokumen terbaik per syarat yang dipakai (jenis boleh-banyak). */
export const REQUIREMENT_STATES = ['missing', 'rejected', 'expired', 'too_short', 'pending', 'accepted'] as const
export type RequirementState = (typeof REQUIREMENT_STATES)[number]

export type CompletenessItem = RequirementView & {
  state: RequirementState
  /** Paling awal tanggal habis berlaku yang diterima (null bila jenis tak bermasa berlaku). */
  validUntilNeeded: CalendarDate | null
}

export type Completeness = {
  items: CompletenessItem[]
  /** Semua syarat WAJIB sudah ada berkas yang menunggu pemeriksaan atau diterima — boleh diajukan. */
  ready: boolean
  /** Semua syarat WAJIB diterima petugas (dipakai verifikasi, Fase 6). */
  verified: boolean
  missingRequired: CompletenessItem[]
}

/** Gabungkan syarat beberapa produk per jenis: urutan kemunculan pertama, wajib bila salah satu produk mewajibkan, label/petunjuk dari yang pertama. */
export function mergeRequirements(lists: readonly (readonly RequirementView[])[]): RequirementView[] {
  const merged = new Map<string, RequirementView>()
  for (const list of lists) {
    for (const r of list) {
      const prev = merged.get(r.documentTypeId)
      if (!prev) merged.set(r.documentTypeId, { ...r })
      else if (r.required && !prev.required) prev.required = true
    }
  }
  return [...merged.values()]
}

/** Batas habis berlaku yang diterima untuk satu jenis pada tanggal acuan. */
export function validUntilNeeded(r: Pick<RequirementView, 'hasExpiry' | 'minValidityMonths'>, referenceDate: CalendarDate): CalendarDate | null {
  if (!r.hasExpiry) return null
  return r.minValidityMonths != null ? addMonths(referenceDate, r.minValidityMonths) : referenceDate
}

function stateOf(r: RequirementView, d: DocumentForCompleteness, referenceDate: CalendarDate, checkValidity: boolean): RequirementState {
  if (checkValidity && r.hasExpiry) {
    if (d.expiresAt === null) return r.minValidityMonths != null ? 'too_short' : d.status
    if (d.expiresAt < referenceDate) return 'expired'
    const needed = validUntilNeeded(r, referenceDate)
    if (needed && d.expiresAt < needed) return 'too_short'
  }
  return d.status
}

export function evaluateCompleteness(input: {
  requirements: readonly RequirementView[]
  documents: readonly DocumentForCompleteness[]
  referenceDate: CalendarDate
  /** `false` hanya untuk berkas model lama tanpa tanggal (rute dokumen booking v1) — masa berlaku tak bisa dinilai. */
  checkValidity?: boolean
}): Completeness {
  const checkValidity = input.checkValidity ?? true
  const rank = (s: RequirementState) => REQUIREMENT_STATES.indexOf(s)
  const items = input.requirements.map((r): CompletenessItem => {
    let state: RequirementState = 'missing'
    for (const d of input.documents) {
      if (d.documentTypeId !== r.documentTypeId) continue
      const s = stateOf(r, d, input.referenceDate, checkValidity)
      if (rank(s) > rank(state)) state = s
    }
    return { ...r, state, validUntilNeeded: validUntilNeeded(r, input.referenceDate) }
  })
  const required = items.filter(i => i.required)
  return {
    items,
    ready: required.every(i => i.state === 'pending' || i.state === 'accepted'),
    verified: required.every(i => i.state === 'accepted'),
    missingRequired: required.filter(i => i.state !== 'pending' && i.state !== 'accepted'),
  }
}
