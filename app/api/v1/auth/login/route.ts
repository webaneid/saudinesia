import { NextResponse } from 'next/server'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createSession } from '@/lib/auth/session'
import { loginSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'
import { clientIp, consume, peek, policy, reset, tooManyRequests } from '@/lib/auth/rateLimit'

// Hash bcrypt cost 12 yang valid, tidak cocok dengan password mana pun yang dipakai pengguna — hanya untuk menyamakan waktu.
const DUMMY_HASH = '$2b$12$mMjECRUCpXjI1zuGrztAd.jA/C6.JUsjG4mWPzlh9aGhJLtg1mD7C'

export async function POST(request: Request) {
  try {
    // 1. Per IP: SEMUA percobaan (juga yang gagal validasi) — batas kasar untuk satu sumber.
    const ip = clientIp(request)
    if (ip) {
      const h = await consume(policy('loginIp', ip))
      if (!h.allowed) return tooManyRequests(h.retryAfterSec)
    }

    const body = await request.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { email, password } = parsed.data

    // 2. Per akun: hanya yang GAGAL dihitung, dan dicek (peek) sebelum membandingkan password. Dua lapis:
    //    akun+IP (rapat — pengguna sah tidak terkunci oleh penyerang di IP lain) dan akun saja (longgar —
    //    menahan brute-force terdistribusi dari banyak IP). Kunci memakai email huruf kecil.
    const acct = email.trim().toLowerCase()
    const acctIp = ip ? policy('loginAcctIp', `${acct}|${ip}`) : null
    const acctAny = policy('loginAcct', acct)
    const [a, b] = await Promise.all([acctIp ? peek(acctIp) : null, peek(acctAny)])
    const blocked = [a, b].filter((x) => x && !x.allowed)
    if (blocked.length > 0) return tooManyRequests(Math.max(...blocked.map((x) => x!.retryAfterSec)))

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true, isActive: true, emailVerifiedAt: true },
    })

    // Same error for "not found" and "wrong password" — prevent email enumeration. Keduanya dihitung sebagai gagal.
    const invalid = async () => {
      await Promise.all([acctIp ? consume(acctIp) : null, consume(acctAny)])
      return NextResponse.json(err('Email atau password salah.'), { status: 401 })
    }

    // Akun tidak ada tetap membayar biaya bcrypt yang sama (hash tiruan) — selisih waktu tak membocorkan email terdaftar.
    if (!user) {
      await compare(password, DUMMY_HASH)
      return invalid()
    }

    const match = await compare(password, user.passwordHash)
    if (!match) return invalid()

    // Status akun baru diungkap SETELAH password terbukti benar — sebelum itu membedakan "akun nonaktif" dari "salah password"
    // membocorkan keberadaan akun (enumerasi email).
    if (!user.isActive) {
      return NextResponse.json(err('Akun ini dinonaktifkan. Hubungi kami untuk bantuan.'), { status: 403 })
    }
    if (!user.emailVerifiedAt) {
      // Akun lama (sebelum verifikasi email): reset password membuktikan kepemilikan email dan mengaktifkannya.
      return NextResponse.json(err('Email belum diverifikasi. Gunakan "Lupa password" untuk mengaktifkan akun.'), { status: 403 })
    }

    // Berhasil: pengguna sah tidak membawa hitungan gagal ke sesi berikutnya.
    await reset(...(acctIp ? [acctIp, acctAny] : [acctAny]))
    await createSession({ userId: user.id, role: user.role })
    return NextResponse.json(ok({ role: user.role }))
  } catch (error) {
    console.error('[auth/login]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
