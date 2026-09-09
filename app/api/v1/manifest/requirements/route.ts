import { NextResponse } from 'next/server'
import { getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { ok, err } from '@/lib/validators'

// docs/arsitektur-manifest.md §5 — dipakai wizard (client component) untuk render form
// per-orang dinamis. Publik (tidak sensitif, cuma definisi field, bukan data pribadi).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const productType = url.searchParams.get('productType')
  const productId = url.searchParams.get('productId')
  if (!productType || !productId) {
    return NextResponse.json(err('productType dan productId wajib diisi'), { status: 400 })
  }
  const fields = await getManifestFieldRequirements(productType, productId)
  return NextResponse.json(ok(fields))
}
