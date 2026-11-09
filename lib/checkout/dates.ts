import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { err } from '@/lib/validators'
import { calendarDateOf, todayInApp } from '@/lib/time'
import { checkoutDate, type CheckoutInput } from '@/lib/validators/checkout'

// Tanggal pilihan pelanggan (berangkat paket, rencana berangkat visa, tanggal kuota kendaraan) tidak boleh di masa lalu menurut zona aplikasi (lib/time).
// Halaman checkout tidak menawarkan tanggal lampau; ini pemeriksaan server untuk permintaan yang dibuat langsung. Admin boleh mencatat tanggal lampau lewat form admin.

export async function checkoutDateRefusal(c: CheckoutInput): Promise<NextResponse | null> {
  const today = todayInApp()
  const past = () => NextResponse.json(err('Tanggal tidak boleh sebelum hari ini'), { status: 400 })
  const d = checkoutDate(c)
  if (d !== null && d < today) return past()
  if (c.kind === 'transport') {
    const q = await prisma.transportQuota.findUnique({ where: { id: c.transportQuotaId }, select: { travelDate: true } })
    if (q && calendarDateOf(q.travelDate) < today) return past() // tak ditemukan → biar mesin pesan menjawab 422 seragam
  }
  return null
}
