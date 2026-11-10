import type { PilgrimReviewStatus, Prisma } from '@prisma/client'
import { getFieldByRole, getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_ID, CORE_MANIFEST_PRODUCT_TYPE } from '@/lib/manifest/constants'
import { completeness, isEmptyValue } from '@/lib/manifest/values'
import { fieldRows } from '@/lib/manifest/display'
import type { PilgrimSlot } from './slotTypes'
import { calendarDateOf } from '@/lib/time'
import { bookingChecklists } from './bookingLink'

// Slot jamaah satu booking untuk TABEL jamaah (pemilik 2026-11-10) — SATU perhitungan untuk halaman booking jamaah dan admin: siapa sudah
// diisi, kelengkapan data (aturan `completeness` = penolakan "Ajukan"), kelengkapan dokumen (bookingChecklists → evaluateCompleteness), status
// pemeriksaan. Slot = baris `booking_pilgrims` (jumlahnya = yang ditagih); "diisi" = tertaut kartu atau punya isian.

type PilgrimInput = {
  id: string
  savedPilgrimId: string | null
  fieldValues: Prisma.JsonValue
  reviewStatus: PilgrimReviewStatus
  visaApplication: { visaProductId: string | null; plannedTravelDate: Date | null } | null
}

export type { PilgrimSlot, SlotDocument } from './slotTypes'

const DONE = new Set(['pending', 'accepted'])

export async function bookingPilgrimSlots(bookingId: string, departureDate: Date | null, pilgrims: readonly PilgrimInput[]) {
  const [checklists, fieldsAll] = await Promise.all([
    bookingChecklists(bookingId, departureDate ? calendarDateOf(departureDate) : null, pilgrims.map(p => ({
      id: p.id, savedPilgrimId: p.savedPilgrimId,
      plannedTravelDate: p.visaApplication?.plannedTravelDate ? calendarDateOf(p.visaApplication.plannedTravelDate) : null,
    }))),
    Promise.all(pilgrims.map(p => p.visaApplication?.visaProductId
      ? getManifestFieldRequirements('visa', p.visaApplication.visaProductId)
      : getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID))),
  ])
  const fieldsByPilgrim = new Map(pilgrims.map((p, i) => [p.id, [...(fieldsAll[i] ?? [])].sort((a, b) => a.order - b.order)]))

  const slots: PilgrimSlot[] = pilgrims.map((p, i) => {
    const fields = fieldsByPilgrim.get(p.id) ?? []
    const values = (p.fieldValues ?? {}) as Record<string, unknown>
    const check = checklists.get(p.id)
    const items = check?.items ?? []
    const required = items.filter(x => x.required)
    const data = completeness(fields, values)
    const name = getFieldByRole(fields, values, 'display_name')
    const docsDone = required.filter(x => DONE.has(x.state)).length
    return {
      id: p.id,
      no: i + 1,
      name: typeof name === 'string' && name.trim() ? name : null,
      filled: !!p.savedPilgrimId || Object.values(values).some(v => !isEmptyValue(v)),
      card: check?.card ?? null,
      data: { filled: data.filled, required: data.required, complete: data.complete },
      docs: { done: docsDone, required: required.length },
      ready: data.complete && docsDone === required.length,
      reviewStatus: p.reviewStatus,
      rows: fieldRows(fields, values),
      documents: items.map(x => ({ key: x.key, label: x.label, required: x.required, state: x.state, reusable: x.reusable })),
    }
  })
  return { slots, checklists, fieldsByPilgrim }
}
