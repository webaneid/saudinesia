import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { VendorNotUsableError } from './integrity'

/** Route yang menyimpan `vendorId`: vendor tak ada/nonaktif → 400 dengan pesan jelas (dulu galat FK → 500). null = bukan galat vendor. */
export function vendorNotUsableResponse(e: unknown): NextResponse | null {
  return e instanceof VendorNotUsableError ? NextResponse.json(err(e.message), { status: 400 }) : null
}
