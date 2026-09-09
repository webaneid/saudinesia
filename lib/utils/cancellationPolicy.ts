export type RefundPolicy = {
  refundPercent: number
  label: string
}

export function getCancellationPolicy(
  departureDate: Date,
  cancelDate: Date = new Date(),
): RefundPolicy {
  const days = Math.floor((departureDate.getTime() - cancelDate.getTime()) / 86_400_000)
  if (days > 60) return { refundPercent: 100, label: '>60 hari: refund penuh' }
  if (days >= 30) return { refundPercent: 50, label: '30–60 hari: refund 50%' }
  return { refundPercent: 0, label: '<30 hari: tidak ada refund' }
}

export function computeRefundAmount(totalAmount: number, departureDate: Date): number {
  const { refundPercent } = getCancellationPolicy(departureDate)
  return Math.floor((totalAmount * refundPercent) / 100)
}
