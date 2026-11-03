import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import type { WarehouseError } from './warehouse'

// Pemetaan galat gudang identitas → respons (429 membawa Retry-After). Pesan layanan aman ditampilkan ke staf.
export function warehouseFailure(r: WarehouseError): NextResponse {
  const res = NextResponse.json({ ...err(r.error), ...(r.field ? { meta: { field: r.field } } : {}) }, { status: r.status })
  if (r.retryAfterSec) res.headers.set('Retry-After', String(r.retryAfterSec))
  return res
}
export const identityNotFound = () => NextResponse.json(err('Identitas jamaah tidak ditemukan'), { status: 404 })
