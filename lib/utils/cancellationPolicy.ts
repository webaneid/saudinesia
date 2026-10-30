import { calendarDateOf, dateInApp, daysBetween } from '@/lib/time'
export type RefundPolicy = {
  refundPercent: number
  label: string
}

export function getCancellationPolicy(
  departureDate: Date,
  cancelDate: Date = new Date(),
): RefundPolicy {
  // Hari KALENDER antara hari pembatalan (zona aplikasi) dan tanggal berangkat (`@db.Date`) — bukan selisih instan yang bergeser menurut jam saat menekan batal.
  const days = daysBetween(dateInApp(cancelDate), calendarDateOf(departureDate))
  if (days > 60) return { refundPercent: 100, label: '>60 hari: refund penuh' }
  if (days >= 30) return { refundPercent: 50, label: '30–60 hari: refund 50%' }
  return { refundPercent: 0, label: '<30 hari: tidak ada refund' }
}

export function computeRefundAmount(totalAmount: number, departureDate: Date): number {
  const { refundPercent } = getCancellationPolicy(departureDate)
  return Math.floor((totalAmount * refundPercent) / 100)
}
