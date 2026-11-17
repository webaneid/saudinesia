import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { MAX_UPLOAD_BYTES } from '@/lib/media/image'
import { decodeQrisPayload } from '@/lib/qris/decode'
import { qrisMerchantName } from '@/lib/qris/emv'

// Baca payload QRIS dari foto QRIS statis (Fase 8, §10.11 butir 2). Gambar TIDAK disimpan (K8-3) — hanya dibaca lalu dibuang; hasil diisikan ke formulir QRIS
// dan baru tersimpan saat admin menyimpan akun QRIS (lewat handler daftar biasa yang memvalidasi payload lagi). Superadmin saja, sama dengan Pengaturan Invoice.
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024

export async function POST(req: Request) {
  try {
    await requireSuperAdmin()
    const len = Number(req.headers.get('content-length') ?? NaN)
    if (!Number.isFinite(len)) return NextResponse.json(err('Panjang permintaan wajib'), { status: 411 })
    if (len > MAX_BODY_BYTES) return NextResponse.json(err('Ukuran file maksimal 5 MB.'), { status: 413 })
    let form: FormData
    try { form = await req.formData() } catch { return NextResponse.json(err('Form tidak valid'), { status: 400 }) }
    const keys = [...form.keys()]
    const file = form.get('file')
    if (keys.length !== 1 || !(file instanceof File)) return NextResponse.json(err('Unggah tepat satu gambar QRIS'), { status: 400 })
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json(err('Ukuran file maksimal 5 MB.'), { status: 413 })
    const payload = await decodeQrisPayload(Buffer.from(await file.arrayBuffer()))
    if (!payload) return NextResponse.json(err('QRIS tidak terbaca dari gambar ini — pastikan gambar QRIS jelas, atau tempel payload secara manual'), { status: 422 })
    return NextResponse.json(ok({ emvPayload: payload, merchantName: qrisMerchantName(payload) }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/qris-accounts/decode')
  }
}
