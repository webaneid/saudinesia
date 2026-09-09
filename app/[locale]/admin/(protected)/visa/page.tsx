import { prisma } from '@/lib/db'
import Link from 'next/link'
import { VISA_STATUS, VISA_TYPE_LABEL } from '@/lib/constants/booking'
import { getManifestFieldRequirements, getFieldByRole } from '@/lib/manifest/getRequirements'

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }

export default async function AdminVisa({ params, searchParams }: Props) {
  const { locale } = await params
  const { status } = await searchParams

  const applications = await prisma.visaApplication.findMany({
    where: status ? { status: status as import('@prisma/client').VisaStatus } : {},
    orderBy: { id: 'desc' },
    take: 60,
    include: {
      pilgrim: {
        include: {
          booking:   { select: { bookingCode: true, id: true } },
          documents: { select: { docType: true } },
        },
      },
    },
  })

  // docs/arsitektur-manifest.md §4 — getFieldByRole() menggantikan a.pilgrim.fullName (kolom
  // baku sudah dihapus). Dicache per visaProductId, bukan per aplikasi, biar tidak fetch dobel.
  const fieldsByProduct = new Map<string, Awaited<ReturnType<typeof getManifestFieldRequirements>>>()
  for (const productId of new Set(applications.map(a => a.visaProductId).filter((v): v is string => !!v))) {
    fieldsByProduct.set(productId, await getManifestFieldRequirements('visa', productId))
  }
  function displayName(a: (typeof applications)[number]): string {
    const fields = a.visaProductId ? fieldsByProduct.get(a.visaProductId) ?? [] : []
    const name = getFieldByRole(fields, a.pilgrim.fieldValues as Record<string, unknown>, 'display_name')
    return typeof name === 'string' && name ? name : 'Jamaah'
  }

  const statuses = Object.keys(VISA_STATUS)

  const VISA_BADGE: Record<string, string> = {
    issued:            'admin-badge-green',
    pending_documents: 'admin-badge-red',
    rejected:          'admin-badge-red',
    in_review:         'admin-badge-blue',
    documents_complete: 'admin-badge-blue',
    submitted_to_syarikah: 'admin-badge-amber',
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <h1 className="admin-h1">Manajemen Visa</h1>

      <div className="flex flex-wrap gap-2">
        <Link href={`/${locale}/admin/visa`}
          className={!status ? 'admin-pill-on' : 'admin-pill-off'}>
          Semua
        </Link>
        {statuses.map(s => (
          <Link key={s} href={`/${locale}/admin/visa?status=${s}`}
            className={status === s ? 'admin-pill-on' : 'admin-pill-off'}>
            {VISA_STATUS[s as keyof typeof VISA_STATUS]?.label}
          </Link>
        ))}
      </div>

      <div className="admin-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="border-b border-line bg-canvas/60">
            <tr>
              <th className="admin-th">Jamaah</th>
              <th className="admin-th">Booking</th>
              <th className="admin-th">Jenis Visa</th>
              <th className="admin-th">Dokumen</th>
              <th className="admin-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {applications.map(a => {
              const cfg = VISA_STATUS[a.status as keyof typeof VISA_STATUS]
              return (
                <tr key={a.id} className="hover:bg-canvas/40 transition-colors">
                  <td className="px-4 py-3 text-ink font-medium text-[13px]">{displayName(a)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/${locale}/admin/bookings/${a.pilgrim.booking.id}`}
                      className="font-mono text-[12px] font-semibold text-teal-700 hover:text-teal-800">
                      {a.pilgrim.booking.bookingCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">
                    {VISA_TYPE_LABEL[a.visaType] ?? a.visaType}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-[12px]">
                    {a.pilgrim.documents.length} file
                  </td>
                  <td className="px-4 py-3">
                    <span className={VISA_BADGE[a.status] ?? 'admin-badge-gray'}>
                      {cfg?.label}
                    </span>
                  </td>
                </tr>
              )
            })}
            {applications.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-400 text-sm">
                  Tidak ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
