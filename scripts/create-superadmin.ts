// Membuat superadmin pertama — AMAN untuk production (hanya menambah SATU baris `users`, tidak menyentuh tabel lain).
// Ganti `bun run db:seed`, yang MENGHAPUS data katalog/harga dan memakai kredensial default yang diketahui.
//
// Di server (container web; password tidak lewat argumen supaya tidak masuk riwayat shell / `ps`):
//   docker compose -f docker-compose.prod.yml --env-file .env.production --env-file .env.deploy \
//     exec web bun scripts/create-superadmin.ts --email admin@domain.com --name "Nama Lengkap"
//   → diminta mengetik password dua kali (tidak ditampilkan). Otomasi: tambahkan --password-stdin dan -T,
//     lalu alirkan password lewat stdin.
// Lokal: bun scripts/create-superadmin.ts ... (DATABASE_URL dari .env.local).
//
// Perilaku:
//   - Menolak bila sudah ada superadmin, kecuali --additional (mencegah akun berhak-tinggi ganda karena salah ketik).
//   - Menolak bila email sudah dipakai — TIDAK PERNAH mengubah akun yang ada.
//   - Hanya bergantung pada @prisma/client + Bun: image production tidak membawa bcryptjs/zod (di-bundle Next.js),
//     jadi hash memakai Bun.password (bcrypt, cost 12 — sama dengan seed & kompatibel dengan bcryptjs.compare di login).
import { PrismaClient } from '@prisma/client'
import { createInterface } from 'node:readline'

// Skrip ini dijalankan Bun (image production berbasis oven/bun). Tipe global `Bun` tidak ada di project (tanpa
// @types/bun) — cukup deklarasi minimal untuk satu pemanggilan; bersifat lokal modul sehingga tidak bentrok bila
// @types/bun kelak ditambahkan.
declare const Bun: {
  password: { hash(password: string, options: { algorithm: 'bcrypt'; cost: number }): Promise<string> }
}

const BCRYPT_MAX_BYTES = 72

function parseArgs(argv: string[]) {
  const out: { email?: string; name?: string; passwordStdin: boolean; additional: boolean } = { passwordStdin: false, additional: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--email') out.email = argv[++i]
    else if (a === '--name') out.name = argv[++i]
    else if (a === '--password-stdin') out.passwordStdin = true
    else if (a === '--additional') out.additional = true
    else if (a === '--help' || a === '-h') {
      console.log('Pemakaian: bun scripts/create-superadmin.ts [--email <email>] [--name "<nama>"] [--password-stdin] [--additional]')
      process.exit(0)
    } else fail(`Argumen tidak dikenal: ${a}`)
  }
  return out
}

function fail(message: string): never {
  console.error(`GAGAL: ${message}`)
  process.exit(1)
}

// Aturan sama dengan passwordSchema di lib/validators/auth.ts (file itu tidak ada di image) — jaga tetap sinkron.
function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password minimal 8 karakter'
  if (!/[a-zA-Z]/.test(pw)) return 'Password harus mengandung huruf'
  if (!/[0-9]/.test(pw)) return 'Password harus mengandung angka'
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password harus mengandung karakter spesial (!@#$%...)'
  // Bun.password mem-pre-hash password > 72 byte (SHA-512) sehingga bcryptjs.compare di login TIDAK cocok →
  // admin terkunci di luar akunnya sendiri. Batas 72 byte = batas asli bcrypt.
  if (Buffer.byteLength(pw, 'utf8') > BCRYPT_MAX_BYTES) return `Password maksimal ${BCRYPT_MAX_BYTES} byte (batas bcrypt)`
  return null
}

function ask(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(label, (answer) => { rl.close(); resolve(answer.trim()) }))
}

// Input tersembunyi (mode raw) — butuh TTY.
function askHidden(label: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stdout.write(label)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\n' || c === '\r' || c === '\u0004') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          return resolve(buf)
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130) } // Ctrl-C
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1)
        else buf += c
      }
    }
    stdin.on('data', onData)
  })
}

async function readPassword(passwordStdin: boolean): Promise<string> {
  if (passwordStdin) {
    const chunks: Buffer[] = []
    for await (const c of process.stdin) chunks.push(c as Buffer)
    // Satu baris; buang hanya akhir-baris (spasi di dalam password tetap sah).
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }
  if (!process.stdin.isTTY) fail('Tidak ada terminal interaktif. Alirkan password lewat stdin dengan --password-stdin (dan gunakan `exec -T` di docker).')
  const first = await askHidden('Password: ')
  const second = await askHidden('Ulangi password: ')
  if (first !== second) fail('Kedua password tidak sama.')
  return first
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!process.env.DATABASE_URL) fail('DATABASE_URL tidak ada di environment.')

  const prisma = new PrismaClient({ log: ['error'] })
  try {
    // Penjaga: superadmin pertama saja, kecuali dikehendaki eksplisit.
    const existing = await prisma.user.findMany({ where: { role: 'superadmin' }, select: { email: true } })
    if (existing.length > 0 && !args.additional) {
      fail(`Sudah ada ${existing.length} superadmin (${existing.map((u) => u.email).join(', ')}). Tidak ada yang dibuat. Pakai --additional bila memang ingin menambah.`)
    }

    // Email selalu huruf kecil (docs/arsitektur-auth.md §3.1) — login & pencocokan Google memakai bentuk yang sama.
    const email = (args.email ?? (process.stdin.isTTY ? await ask('Email: ') : '')).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Format email tidak valid (gunakan --email).')
    const fullName = args.name ?? (process.stdin.isTTY ? await ask('Nama lengkap: ') : '')
    if (fullName.length < 2 || fullName.length > 100) fail('Nama harus 2–100 karakter (gunakan --name).')

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      fail(`Email ${email} sudah terdaftar. Akun yang ada TIDAK diubah.`)
    }

    const password = await readPassword(args.passwordStdin)
    const problem = passwordProblem(password)
    if (problem) fail(problem)

    const passwordHash = await Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 })
    const user = await prisma.user.create({
      data: { email, fullName, passwordHash, role: 'superadmin', isActive: true, emailVerifiedAt: new Date() },
      select: { id: true, email: true, role: true },
    })

    console.log(`OK: superadmin dibuat — ${user.email} (id ${user.id}).`)
    console.log('Masuk lewat /<locale>/admin/login. Password tidak disimpan di mana pun selain hash di database.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('GAGAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
