import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'

export async function GET() {
  return NextResponse.json(ok(null))
}
