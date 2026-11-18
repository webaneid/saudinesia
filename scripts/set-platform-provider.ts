// Menetapkan / mencabut penanda akun Platform Provider (docs/arsitektur-bagi-hasil.md §3). SATU-SATUNYA jalan menulis `users.isPlatformProvider` —
// tak ada route/UI yang mengubahnya, supaya superadmin klien tidak bisa menjadikan dirinya Platform Provider.
//
// Di server (container web — skrip ini ikut ke image, lihat Dockerfile + docs/deployment.md §6):
//   docker compose -f docker-compose.prod.yml --env-file .env.production --env-file .env.deploy exec web bun scripts/set-platform-provider.ts <email>
//   … <email> --off   → cabut
// Lokal: bun scripts/set-platform-provider.ts <email> (DATABASE_URL dari .env.local).
//
// Hanya bergantung pada @prisma/client + Bun (image produksi tak membawa lib/ maupun alias tsconfig — pola create-superadmin.ts).
// Penanda + kenaikan sessionVersion ditulis SATU pernyataan bersyarat (updateMany: superadmin aktif) — tak ada celah antara cek dan tulis.
// Mencetak hanya email yang diberikan operator + hasil.
import { PrismaClient } from '@prisma/client'

const [rawEmail, flag] = process.argv.slice(2)
if (!rawEmail || (flag !== undefined && flag !== '--off')) {
  console.error('Pakai: bun scripts/set-platform-provider.ts <email> [--off]')
  process.exit(2)
}
const email = rawEmail.trim().toLowerCase()
const on = flag !== '--off'
const prisma = new PrismaClient()

async function main(): Promise<number> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isPlatformProvider: true } })
  if (!user) { console.error('Akun tidak ditemukan.'); return 1 }
  if (user.isPlatformProvider === on) { console.log(`Tidak berubah: ${email} ${on ? 'sudah' : 'bukan'} Platform Provider.`); return 0 }
  const res = await prisma.user.updateMany({
    where: on ? { id: user.id, role: 'superadmin', isActive: true, isPlatformProvider: false } : { id: user.id, isPlatformProvider: true },
    data: { isPlatformProvider: on, sessionVersion: { increment: 1 } },
  })
  if (res.count !== 1) { console.error(on ? 'Akun Platform Provider harus superadmin yang aktif.' : 'Akun berubah di tengah jalan — jalankan ulang.'); return 1 }
  console.log(`${email}: Platform Provider ${on ? 'DITETAPKAN' : 'DICABUT'} (sesi akun itu perlu login ulang).`)
  return 0
}

const code = await main().catch(e => { console.error('Gagal:', e instanceof Error ? e.name : 'galat'); return 1 })
await prisma.$disconnect()
process.exit(code)
