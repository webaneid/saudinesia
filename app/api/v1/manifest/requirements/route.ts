import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { prisma } from '@/lib/db'
import { activeFields, pilgrimCatalog } from '@/lib/pilgrim-data/catalog'
import { enabledProducts } from '@/lib/pilgrim-data/products'
import { isPilgrimDataOwner } from '@/lib/pilgrim-data/owners'

// Kolom data jamaah yang diminta satu produk (docs/arsitektur-data-jamaah.md §3.3): kolom aktif katalog bila saklar produk nyala, selain itu
// kosong. Publik (definisi kolom, bukan data pribadi). Bentuk respons sama dengan sebelumnya (`fieldKey`/`label`/`fieldType`/…).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const productType = url.searchParams.get('productType')
  const productId = url.searchParams.get('productId')
  if (!productType || !productId || productId.length > 64 || !isPilgrimDataOwner(productType)) {
    return apiErrorJson('invalidInput', 400)
  }
  const on = (await enabledProducts(prisma, [{ productType, productId }])).size > 0
  const fields = on ? activeFields(await pilgrimCatalog()).map(({ id, fieldKey, label, fieldType, options, required, role, order }) => ({ id, fieldKey, label, fieldType, options, required, role, order })) : []
  return NextResponse.json(ok(fields))
}
