import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/auth/session'
import { ok } from '@/lib/validators'

export async function POST() {
  await clearSession()
  return NextResponse.json(ok(null))
}
