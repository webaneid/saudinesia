import { prisma } from '@/lib/db'

type Props = { params: Promise<{ locale: string }> }

export default async function AdminNotifications({}: Props) {
  const logs = await prisma.notificationLog.findMany({
    orderBy: { sentAt: 'desc' },
    take: 50,
    include: { user: { select: { fullName: true, phone: true } } },
  })

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="admin-h1">Log Notifikasi</h1>

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60">
            <tr>
              <th className="admin-th">Waktu</th>
              <th className="admin-th">User</th>
              <th className="admin-th">Kanal</th>
              <th className="admin-th">Tipe</th>
              <th className="admin-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {logs.map(l => (
              <tr key={l.id} className="hover:bg-canvas/40 transition-colors">
                <td className="px-4 py-3 text-slate-500 text-[12px]">
                  {new Date(l.sentAt).toLocaleString('id-ID')}
                </td>
                <td className="px-4 py-3 text-ink text-[13px]">{l.user.fullName ?? l.recipient}</td>
                <td className="px-4 py-3">
                  <span className={l.channel === 'whatsapp' ? 'admin-badge-green' : 'admin-badge-blue'}>
                    {l.channel}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-[12px]">{l.type.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <span className={l.status === 'sent' ? 'admin-badge-green' : 'admin-badge-red'}>
                    {l.status}
                  </span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">Belum ada log.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
