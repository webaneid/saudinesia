import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { err } from '@/lib/validators'
import { calendarDateOf, todayInApp } from '@/lib/time'
import { checkoutDate, type CheckoutInput } from '@/lib/validators/checkout'

// Tanggal pilihan pelanggan (berangkat paket, rencana berangkat visa, tanggal kuota kendaraan, check-in hotel, tanggal tur) tidak boleh di masa lalu menurut zona aplikasi (lib/time).
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
  // Paket Ziarah dengan kendaraan pilihan: tanggal tur = tanggal kuota kendaraan (mesin memakai tanggal kuota) — keduanya harus sama supaya
  // yang dipesan persis yang dilihat pelanggan.
  if (c.kind === 'tour' && c.transportQuotaId) {
    const q = await prisma.transportQuota.findUnique({ where: { id: c.transportQuotaId }, select: { travelDate: true } })
    if (q && calendarDateOf(q.travelDate) !== c.tourDate) return NextResponse.json(err('Tanggal kendaraan tidak sesuai dengan tanggal tur'), { status: 400 })
  }
  return null
}
