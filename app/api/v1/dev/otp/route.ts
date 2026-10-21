import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'

// Dev only — returns the latest unused OTP for a phone from DB.
// FAIL-CLOSED: hanya hidup bila NODE_ENV persis 'development'. Dulu `=== 'production'` → 404, sehingga NODE_ENV yang
// salah/kosong di lingkungan terdeploy membuat endpoint ini membocorkan OTP aktif siapa pun.
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(err('Not found'), { status: 404 })
  }
  const phone = new URL(request.url).searchParams.get('phone')
  if (!phone) return NextResponse.json(err('phone required'), { status: 400 })

  const record = await prisma.otpRequest.findFirst({
    where: { phone, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { code: true },
  })
  if (!record) return NextResponse.json(err('No active OTP'), { status: 404 })
  return NextResponse.json(ok({ code: record.code }))
}
