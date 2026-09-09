import { prisma } from '@/lib/db'

type Props = { params: Promise<{ locale: string }> }

const POOL_WINDOW_DAYS = 30

export default async function AdminQuotas({}: Props) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + POOL_WINDOW_DAYS)

  const [hotels, capacitySum, poolRows] = await Promise.all([
    prisma.hotelRoomSchedule.findMany({
      include: { period: { include: { hotel: true } }, roomType: true },
      orderBy: { period: { periodStart: 'asc' } },
    }),
    // Kapasitas pool = SUM live dailyCapacity muthowif aktif (docs/arsitektur-muthowif.md §9.2)
    prisma.muthowif.aggregate({ where: { isActive: true }, _sum: { dailyCapacity: true } }),
    prisma.muthowifPoolAvailability.findMany({
      where: { date: { gte: today, lte: windowEnd } },
      orderBy: { date: 'asc' },
    }),
  ])
  const totalCapacity = capacitySum._sum.dailyCapacity ?? 0
  const poolByDate = new Map(poolRows.map(p => [p.date.toISOString().slice(0, 10), p]))
  const muthowifPool = Array.from({ length: POOL_WINDOW_DAYS + 1 }, (_, i) => {
    const date = new Date(today); date.setDate(date.getDate() + i)
    const key = date.toISOString().slice(0, 10)
    const row = poolByDate.get(key)
    return {
      date, pendingCount: row?.pendingCount ?? 0, bookedCount: row?.bookedCount ?? 0,
    }
  }).filter(r => r.pendingCount > 0 || r.bookedCount > 0)

  return (
    <div className="space-y-7 max-w-5xl">
      <h1 className="admin-h1">Ketersediaan Quota</h1>

      {/* Hotel quota */}
      <div className="space-y-3">
        <p className="admin-section">Hotel</p>
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-line bg-canvas/60">
              <tr>
                <th className="admin-th">Hotel</th>
                <th className="admin-th">Tipe</th>
                <th className="admin-th text-right">Total</th>
                <th className="admin-th text-right">Pending</th>
                <th className="admin-th text-right">Booked</th>
                <th className="admin-th text-right">Sisa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {hotels.map(q => {
                const avail = q.totalQuota - q.pendingQuota - q.bookedQuota
                return (
                  <tr key={q.id} className="hover:bg-canvas/40 transition-colors">
                    <td className="px-4 py-3 text-ink font-medium text-[13px]">{q.period.hotel.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-[12px] capitalize">{q.roomType.name}</td>
                    <td className="px-4 py-3 text-right text-ink2 tabular-nums">{q.totalQuota}</td>
                    <td className="px-4 py-3 text-right text-gold-600 tabular-nums font-medium">{q.pendingQuota}</td>
                    <td className="px-4 py-3 text-right text-teal-700 tabular-nums font-medium">{q.bookedQuota}</td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${avail < 5 ? 'text-rose-600' : 'text-mint-700'}`}>
                      {avail}
                    </td>
                  </tr>
                )
              })}
              {hotels.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Belum ada data quota.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Muthowif — pool gabungan semua muthowif aktif, bukan per-orang (docs/arsitektur-muthowif.md §9) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="admin-section">Muthowif</p>
          <p className="text-[12px] text-slate-500">Kapasitas pool: <span className="font-semibold text-ink">{totalCapacity}/hari</span></p>
        </div>
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="border-b border-line bg-canvas/60">
              <tr>
                <th className="admin-th">Tanggal</th>
                <th className="admin-th text-right">Pending</th>
                <th className="admin-th text-right">Booked</th>
                <th className="admin-th text-right">Sisa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {muthowifPool.map(p => {
                const avail = totalCapacity - p.pendingCount - p.bookedCount
                return (
                  <tr key={p.date.toISOString()} className="hover:bg-canvas/40 transition-colors">
                    <td className="px-4 py-3 text-ink font-medium text-[13px]">{p.date.toLocaleDateString('id-ID', { dateStyle: 'medium' })}</td>
                    <td className="px-4 py-3 text-right text-gold-600 tabular-nums font-medium">{p.pendingCount}</td>
                    <td className="px-4 py-3 text-right text-teal-700 tabular-nums font-medium">{p.bookedCount}</td>
                    <td className={`px-4 py-3 text-right font-bold tabular-nums ${avail < 5 ? 'text-rose-600' : 'text-mint-700'}`}>
                      {avail}
                    </td>
                  </tr>
                )
              })}
              {muthowifPool.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">Belum ada reservasi dalam {POOL_WINDOW_DAYS} hari ke depan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
