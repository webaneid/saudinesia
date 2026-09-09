import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'

// Deprecated — use /api/v1/auth/register or /api/v1/auth/login instead
export async function POST() {
  return NextResponse.json(err('Endpoint ini sudah tidak digunakan.'), { status: 410 })
}
