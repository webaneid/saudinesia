import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { waTemplateSaveSchema } from '@/lib/validators/whatsapp'
import { isWaTemplateKey } from '@/lib/whatsapp/templateDefs'
import { saveWaTemplate } from '@/lib/whatsapp/templates'
import { logError } from '@/lib/log'

// Simpan teks/saklar satu template WhatsApp (docs/rencana-gowa-self-host.md §4.2, F3) — superadmin saja (K5). Penulis tunggal: lib/whatsapp/templates.ts.
export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  let staffId: string
  try {
    staffId = (await requireSuperAdmin()).userId
  } catch (e) {
    return authFailureResponse(e, 'admin/system/whatsapp/templates/PUT')
  }
  try {
    const { key } = await params
    if (!isWaTemplateKey(key)) return NextResponse.json(err('Template tidak ditemukan'), { status: 404 })
    const parsed = waTemplateSaveSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await saveWaTemplate(key, parsed.data, staffId)
    if (r.kind === 'invalid') return NextResponse.json(err(r.message), { status: 400 })
    if (r.kind === 'stale') return NextResponse.json(err('Template sudah diubah orang lain. Muat ulang halaman lalu coba lagi.'), { status: 409 })
    return NextResponse.json(ok(r.template))
  } catch (e) {
    logError('admin/system/whatsapp/templates/PUT', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
