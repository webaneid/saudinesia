import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { auditView, writeAudit, type AuditEntity } from '@/lib/invoice/audit'

// Handler CRUD bersama untuk daftar kecil di Pengaturan Invoice (rekening bank, akun QRIS, aturan pajak). Satu implementasi: auth superadmin di baris pertama, Zod `.strict()`,
// galat dibedakan (401/403 · 400 · 404 · 409 · 500+log), dan SETIAP perubahan menulis jejak append-only di transaksi yang sama (SEC-109). Route tipis hanya mengikat adapter model.
type Tx = Prisma.TransactionClient
type Ctx = { params: Promise<{ id: string }> }
type Row = Record<string, unknown>
export type ListAdapter<T> = {
  list: (db: Tx) => Promise<Row[]>
  get: (db: Tx, id: string) => Promise<Row | null>
  create: (db: Tx, data: T) => Promise<Row>
  update: (db: Tx, id: string, data: T) => Promise<Row>
  remove: (db: Tx, id: string) => Promise<void>
  /** Aktif/nonaktif tanpa mengirim ulang seluruh isian (aksi ikon di daftar). */
  setActive: (db: Tx, id: string, isActive: boolean) => Promise<Row>
}
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined)

export function createListHandlers<T>(opts: {
  tag: string; label: string; entity: AuditEntity
  /** Skema BUAT (bawaan boleh) dan skema UBAH (PUT = penggantian penuh; `isActive`/`sortOrder` wajib). */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>; updateSchema: z.ZodType<T, z.ZodTypeDef, unknown>
  adapter: ListAdapter<T>
  /** Disuntik hanya oleh uji (tanpa cookie); bawaan = `requireSuperAdmin`. */
  requireStaff?: () => Promise<{ userId: string }>
}) {
  const { tag, label, entity, schema, updateSchema, adapter } = opts
  const requireStaff = opts.requireStaff ?? requireSuperAdmin

  function failure(e: unknown, action: string): NextResponse {
    if (isRecordNotFound(e)) return NextResponse.json(err(`${label} tidak ditemukan`), { status: 404 })
    if (codeOf(e) === 'P2002') return NextResponse.json(err(`${label} yang sama sudah ada`), { status: 409 })
    if (codeOf(e) === 'P2003') return NextResponse.json(err(`${label} masih dipakai — nonaktifkan saja`), { status: 409 })
    console.error(`[${tag}/${action}]`, e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
  async function staff(action: string): Promise<{ staffId: string } | { response: NextResponse }> {
    try { return { staffId: (await requireStaff()).userId } } catch (e) { return { response: authFailureResponse(e, `${tag}/${action}`) } }
  }
  const invalid = (parsed: { error: z.ZodError }) => NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

  return {
    async GET() {
      const a = await staff('GET'); if ('response' in a) return a.response
      try { return NextResponse.json(ok(await adapter.list(prisma))) } catch (e) { return failure(e, 'GET') }
    },
    async POST(req: Request) {
      const a = await staff('POST'); if ('response' in a) return a.response
      const parsed = schema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return invalid(parsed)
      try {
        const created = await prisma.$transaction(async tx => {
          const row = await adapter.create(tx, parsed.data)
          await writeAudit(tx, a.staffId, entity, String(row.id), 'create', auditView(entity, row))
          return row
        })
        return NextResponse.json(ok(created), { status: 201 })
      } catch (e) { return failure(e, 'POST') }
    },
    async PUT(req: Request, { params }: Ctx) {
      const a = await staff('PUT'); if ('response' in a) return a.response
      const { id } = await params
      const raw: unknown = await req.json().catch(() => null)
      // Pola aksi ikon: body PERSIS `{ isActive: boolean }` = ganti status saja; selain itu wajib lolos skema penuh `.strict()`.
      const keys = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? Object.keys(raw) : []
      if (keys.length === 1 && keys[0] === 'isActive') {
        const active = (raw as { isActive?: unknown }).isActive
        if (typeof active !== 'boolean') return NextResponse.json(err('Status harus true/false'), { status: 400 })
        try {
          const row = await prisma.$transaction(async tx => {
            const before = await adapter.get(tx, id)
            const updated = await adapter.setActive(tx, id, active)
            await writeAudit(tx, a.staffId, entity, id, 'toggle', { isActive: [before ? Boolean(before.isActive) : null, active] })
            return updated
          })
          return NextResponse.json(ok(row))
        } catch (e) { return failure(e, 'PUT') }
      }
      const parsed = updateSchema.safeParse(raw)
      if (!parsed.success) return invalid(parsed)
      try {
        const row = await prisma.$transaction(async tx => {
          const before = await adapter.get(tx, id)
          const updated = await adapter.update(tx, id, parsed.data)
          await writeAudit(tx, a.staffId, entity, id, 'update', { before: before ? auditView(entity, before) : null, after: auditView(entity, updated) })
          return updated
        })
        return NextResponse.json(ok(row))
      } catch (e) { return failure(e, 'PUT') }
    },
    async DELETE(_req: Request, { params }: Ctx) {
      const a = await staff('DELETE'); if ('response' in a) return a.response
      const { id } = await params
      try {
        await prisma.$transaction(async tx => {
          const before = await adapter.get(tx, id)
          await adapter.remove(tx, id)
          await writeAudit(tx, a.staffId, entity, id, 'delete', before ? auditView(entity, before) : { tidakDitemukan: true })
        })
        return NextResponse.json(ok(null))
      } catch (e) { return failure(e, 'DELETE') }
    },
  }
}
