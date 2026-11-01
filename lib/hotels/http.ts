import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { vendorNotUsableResponse } from '@/lib/vendors/http'
import { PriceInputError } from '@/lib/pricing/engine/manual'
import { HotelPeriodError } from './periods'

/** Galat route periode hotel: galat aturan → status + pesan; auth → 401/403; sisanya 500 + log (lib/admin/errors.ts). */
export function periodFailure(e: unknown, tag: string): NextResponse {
  if (e instanceof HotelPeriodError) return NextResponse.json(err(e.message), { status: e.status })
  if (e instanceof PriceInputError) return NextResponse.json(err(e.message), { status: 400 })
  if (isRecordNotFound(e)) return NextResponse.json(err('Periode harga hotel tidak ditemukan'), { status: 404 })
  return vendorNotUsableResponse(e) ?? authFailureResponse(e, tag)
}
