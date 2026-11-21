// SATU-SATUNYA penulis/pembaca `whatsapp_templates` (docs/rencana-gowa-self-host.md §4.2, F3). Definisi + render murni di templateDefs.ts.
// Pembacaan untuk pengiriman TIDAK PERNAH melempar: DB bermasalah → teks bawaan & aktif (notifikasi, terutama email, tak boleh ikut gagal).
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeAudit } from '@/lib/invoice/audit'
import { logError } from '@/lib/log'
import { WA_TEMPLATE_DEFS, WA_TEMPLATE_KEYS, renderTemplate, templateProblem, type WaTemplateKey, type WaValues } from '@/lib/whatsapp/templateDefs'

export type WaTemplateDto = {
  key: WaTemplateKey
  /** Teks kustom; null = memakai bawaan. */
  body: string | null
  enabled: boolean
  updatedAt: string
}

const toDto = (r: { key: string; body: string | null; enabled: boolean; updatedAt: Date }): WaTemplateDto =>
  ({ key: r.key as WaTemplateKey, body: r.body, enabled: r.enabled, updatedAt: r.updatedAt.toISOString() })

/** Semua template untuk editor admin, urut daftar kunci. Baris disemai migrasi; createMany defensif untuk DB uji. */
export async function listWaTemplates(): Promise<WaTemplateDto[]> {
  await prisma.whatsappTemplate.createMany({ data: WA_TEMPLATE_KEYS.map(key => ({ key })), skipDuplicates: true })
  const rows = await prisma.whatsappTemplate.findMany({ where: { key: { in: [...WA_TEMPLATE_KEYS] } } })
  const byKey = new Map(rows.map(r => [r.key, r]))
  return WA_TEMPLATE_KEYS.map(k => toDto(byKey.get(k)!))
}

export type SaveWaTemplateInput = { body: string | null; enabled: boolean; expectedUpdatedAt: string }
export type SaveWaTemplateResult = { kind: 'done'; template: WaTemplateDto } | { kind: 'stale' } | { kind: 'invalid'; message: string }

/**
 * Simpan teks dan/atau saklar. `body` null = kembali ke bawaan; teks yang SAMA PERSIS dengan bawaan juga disimpan sebagai null (tak ada
 * "kustom" palsu). Kunci baris, versi basi → `stale` (409), jejak `settings_audit` (entity `whatsapp_template`; isi teks hanya "berubah").
 */
export async function saveWaTemplate(key: WaTemplateKey, input: SaveWaTemplateInput, staffId: string): Promise<SaveWaTemplateResult> {
  const body = input.body === null || input.body.replace(/\r\n?/g, '\n') === WA_TEMPLATE_DEFS[key].defaultBody ? null : input.body.replace(/\r\n?/g, '\n')
  if (body !== null) {
    const problem = templateProblem(key, body)
    if (problem) return { kind: 'invalid', message: problem }
  }
  return prisma.$transaction(async (tx) => {
    await tx.whatsappTemplate.createMany({ data: [{ key }], skipDuplicates: true })
    await tx.$queryRaw(Prisma.sql`SELECT "key" FROM "whatsapp_templates" WHERE "key" = ${key} FOR UPDATE`) // Prisma ORM tak punya SELECT … FOR UPDATE
    const before = await tx.whatsappTemplate.findUniqueOrThrow({ where: { key } })
    if (before.updatedAt.toISOString() !== input.expectedUpdatedAt) return { kind: 'stale' as const }
    if (before.body === body && before.enabled === input.enabled) return { kind: 'done' as const, template: toDto(before) }
    const after = await tx.whatsappTemplate.update({ where: { key }, data: { body, enabled: input.enabled } })
    const changed: Record<string, Prisma.InputJsonValue> = {}
    if (before.enabled !== after.enabled) changed.enabled = [before.enabled, after.enabled]
    if (before.body !== after.body) changed.body = after.body === null ? 'bawaan' : 'berubah'
    await writeAudit(tx, staffId, 'whatsapp_template', key, 'update', changed)
    return { kind: 'done' as const, template: toDto(after) }
  })
}

export type WaRendered = { kind: 'message'; text: string } | { kind: 'disabled' }

/** Pesan siap kirim untuk satu kunci, atau `disabled` bila saklar dimatikan. Tak pernah melempar (fallback = bawaan, aktif). */
export async function renderWa(key: WaTemplateKey, values: WaValues): Promise<WaRendered> {
  let body: string | null = null
  try {
    const row = await prisma.whatsappTemplate.findUnique({ where: { key }, select: { body: true, enabled: true } })
    if (row && !row.enabled) return { kind: 'disabled' }
    // Teks tersimpan yang (karena perubahan definisi) tak lagi sah → bawaan, bukan pesan rusak.
    if (row?.body && templateProblem(key, row.body) === null) body = row.body
  } catch (e) {
    logError('whatsapp/templates/render', e)
  }
  return { kind: 'message', text: renderTemplate(body ?? WA_TEMPLATE_DEFS[key].defaultBody, values) }
}
