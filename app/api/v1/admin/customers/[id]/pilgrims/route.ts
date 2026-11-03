import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { prisma } from '@/lib/db'
import { requireCustomerManage } from '@/lib/customers/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { createSavedPilgrim, listSavedPilgrims } from '@/lib/pilgrims/service'
import { badRequest, cardIdSchema, listOptionsOf, notFound, parseBody, writeResponse } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string }> }

// Jamaah tersimpan milik satu pelanggan, dikelola staf atas namanya (docs/arsitektur-jamaah.md §9; createdById = staf).
// Semua peran admin (lib/customers/policy.ts). Gudang identitas/NIK utuh TIDAK lewat sini (Fase 8).

const customerNotFound = () => NextResponse.json({ success: false, error: 'Pelanggan tidak ditemukan' }, { status: 404 })

export async function GET(req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return customerNotFound()
    const customer = await prisma.user.findFirst({ where: { id: id.data, role: 'pilgrim' }, select: { id: true } })
    if (!customer) return customerNotFound()
    const list = await listSavedPilgrims({ userId: session.userId, role: session.role }, id.data, listOptionsOf(new URL(req.url)))
    if (!list) return notFound()
    return NextResponse.json(ok(list.items, { pagination: list.meta }))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/GET')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return customerNotFound()
    const parsed = savedPilgrimInputSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    // Pemilik bukan akun jamaah aktif → 404/422 dari layanan (lockOwner), di dalam kunci yang sama dengan penghapusan akun.
    return writeResponse(await createSavedPilgrim({ userId: session.userId, role: session.role }, id.data, parsed.data), true)
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/POST')
  }
}
