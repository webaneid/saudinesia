import { prisma } from '@/lib/db'
import { deleteObjectsByPrefix } from '@/lib/storage/minio'

// Penyapuan ulang akun yang SUDAH dianonimkan (SEC-57, docs/arsitektur-hapus-akun.md §6). executeDeletion mengosongkan data pada saat commit,
// tetapi tulis TERLAMBAT bisa mendarat sesudahnya: unggahan dokumen yang sedang berjalan (FK hanya ke BookingPilgrim, jadi kunci baris
// pengguna tak menahannya) dan `notify()` yang sedang terbang (menulis NotificationLog dengan penerima asli SESUDAH mengirim).
// Baris BookingPilgrim tetap ada setelah anonimisasi, jadi awalan objek `pilgrims/<id>/` selalu diketahui dan bisa disapu kapan saja.

export type SweepDeps = { deleteByPrefix: (prefix: string) => Promise<number> }
const defaultDeps: SweepDeps = { deleteByPrefix: (prefix) => deleteObjectsByPrefix(prefix) }
export const SWEEP_CONCURRENCY = 5

export type SweepResult = { prefixes: number; objects: number; documents: number; notificationLogs: number }

const ERASED_EMAIL = /^deleted-[0-9a-f-]{36}@deleted\.invalid$/

/**
 * Menyapu satu akun. SANGAT KONSERVATIF: hanya bertindak bila akun benar-benar sudah dianonimkan (email `deleted-<id>@deleted.invalid`)
 * DAN ada permintaan hapus berstatus `completed` — bila tidak, mengembalikan `null` tanpa menyentuh apa pun, sehingga bug pemanggil
 * tak pernah bisa menghapus berkas akun yang masih hidup.
 */
export async function sweepErasedAccount(userId: string, deps: SweepDeps = defaultDeps): Promise<SweepResult | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user || !ERASED_EMAIL.test(user.email)) return null
  const completed = await prisma.accountDeletionRequest.findFirst({ where: { userId, status: 'completed' }, select: { id: true } })
  if (!completed) return null

  const pilgrims = await prisma.bookingPilgrim.findMany({ where: { booking: { userId } }, select: { id: true } })
  const ids = pilgrims.map((p) => p.id)

  // Paralelisme terbatas: booking grup bisa berisi ratusan jamaah, tetapi MinIO tak boleh dibanjiri (dan satu panggilan lambat tak menahan semuanya).
  let objects = 0
  for (let i = 0; i < ids.length; i += SWEEP_CONCURRENCY) {
    const counts = await Promise.all(ids.slice(i, i + SWEEP_CONCURRENCY).map((id) => deps.deleteByPrefix(`pilgrims/${id}/`)))
    objects += counts.reduce((a, b) => a + b, 0)
  }

  const documents = (await prisma.document.deleteMany({ where: { bookingPilgrimId: { in: ids } } })).count
  await prisma.bookingPilgrim.updateMany({ where: { id: { in: ids } }, data: { fieldValues: {}, userId: null } })
  // Log yang ditulis terlambat dengan penerima/isi asli: scrub ulang (baris dipertahankan untuk audit pengiriman).
  const notificationLogs = (await prisma.notificationLog.updateMany({
    where: { userId, NOT: { recipient: '[dihapus]' } },
    data: { recipient: '[dihapus]', messagePreview: null, error: null },
  })).count

  return { prefixes: ids.length, objects, documents, notificationLogs }
}

export type SweepSummary = { accounts: number; objects: number; documents: number; notificationLogs: number; failed: number }

/** Semua penghapusan yang selesai dalam `days` hari terakhir (jendela tempat tulis terlambat masuk akal). Per akun terisolasi: satu gagal tak menghentikan yang lain. */
export async function sweepRecentErasures(days = 7, deps: SweepDeps = defaultDeps): Promise<SweepSummary> {
  const since = new Date(Date.now() - days * 24 * 3_600_000)
  const requests = await prisma.accountDeletionRequest.findMany({
    where: { status: 'completed', processedAt: { gte: since } },
    select: { userId: true },
    distinct: ['userId'],
  })
  const total: SweepSummary = { accounts: 0, objects: 0, documents: 0, notificationLogs: 0, failed: 0 }
  for (const { userId } of requests) {
    try {
      const r = await sweepErasedAccount(userId, deps)
      if (!r) continue
      total.accounts++; total.objects += r.objects; total.documents += r.documents; total.notificationLogs += r.notificationLogs
    } catch (e) {
      total.failed++
      console.error('[erasure-sweep] satu akun gagal disapu:', e instanceof Error ? e.name : e) // tanpa id/PII
    }
  }
  return total
}
