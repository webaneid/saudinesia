import type { PilgrimReviewStatus, Prisma, VisaStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { displayFields, valueByRole } from '@/lib/pilgrim-data/catalog'
import { pilgrimFieldSets } from '@/lib/pilgrim-data/forPilgrims'
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
  visaApplication: { visaProductId: string | null; plannedTravelDate: Date | null; status?: VisaStatus } | null
}

export type { PilgrimSlot, SlotDocument } from './slotTypes'

const DONE = new Set(['pending', 'accepted'])

export async function bookingPilgrimSlots(bookingId: string, departureDate: Date | null, pilgrims: readonly PilgrimInput[], locale?: string) {
  const [checklists, sets] = await Promise.all([
    bookingChecklists(bookingId, departureDate ? calendarDateOf(departureDate) : null, pilgrims.map(p => ({
      id: p.id, savedPilgrimId: p.savedPilgrimId,
      plannedTravelDate: p.visaApplication?.plannedTravelDate ? calendarDateOf(p.visaApplication.plannedTravelDate) : null,
    }))),
    pilgrimFieldSets(prisma, pilgrims.map(p => p.id)),
  ])
  // Kolom yang DIMINTA dari tiap jamaah (katalog Data Jamaah + saklar produk, docs/arsitektur-data-jamaah.md §3.3).
  const fieldsByPilgrim = new Map(pilgrims.map(p => [p.id, sets.get(p.id)?.demanded ?? []]))

  const slots: PilgrimSlot[] = pilgrims.map((p, i) => {
    const fields = fieldsByPilgrim.get(p.id) ?? []
    const values = (p.fieldValues ?? {}) as Record<string, unknown>
    const check = checklists.get(p.id)
    const items = check?.items ?? []
    const required = items.filter(x => x.required)
    const data = completeness(fields, values)
    const catalog = sets.get(p.id)?.catalog ?? []
    const name = valueByRole(catalog, values, 'display_name')
    const docsDone = required.filter(x => DONE.has(x.state)).length
    return {
      id: p.id,
      no: i + 1,
      name: typeof name === 'string' && name.trim() ? name : null,
      filled: !!p.savedPilgrimId || Object.values(values).some(v => !isEmptyValue(v)),
      card: check?.card ?? null,
      data: { filled: data.filled, required: data.required, complete: data.complete },
      docs: { done: docsDone, required: required.length },
      needed: fields.length > 0 || items.length > 0,
      ready: data.complete && docsDone === required.length,
      reviewStatus: p.reviewStatus,
      visa: p.visaApplication?.status ?? null,
      rows: fieldRows(displayFields(catalog, fields, values), values, locale),
      documents: items.map(x => ({ key: x.key, label: x.label, required: x.required, state: x.state, reusable: x.reusable })),
    }
  })
  return { slots, checklists, fieldsByPilgrim }
}
