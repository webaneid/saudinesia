import { NextResponse } from 'next/server'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createSession } from '@/lib/auth/session'
import { loginSchema } from '@/lib/validators/auth'
import { ok, err } from '@/lib/validators'
import { accountKey, clientIp, consume, policy, reset, tooManyRequests } from '@/lib/auth/rateLimit'

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

    // 2. Per akun: SETIAP percobaan DIRESERVASI secara atomik (`consume`) SEBELUM bcrypt, dan dihapus (`reset`) bila password benar.
    //    Dua lapis: akun+IP (rapat — pengguna sah tidak terkunci oleh penyerang di IP lain) dan akun saja (longgar — menahan
    //    brute-force terdistribusi dari banyak IP). Kunci memakai email huruf kecil.
    //    Dulu: `peek` (baca) sebelum bcrypt lalu `consume` sesudahnya — SEC-26: N percobaan paralel semuanya lolos `peek` karena belum ada
    //    yang selesai dihitung, sehingga burst melewati batas. Reservasi-dulu menutup celah itu: hanya `limit` percobaan pertama yang
    //    pernah mencapai bcrypt, secepat apa pun datangnya.
    const acct = email.trim().toLowerCase()
    const acctKey = accountKey(acct) // SEC-14: bentuk kunci yang sama dipakai tombol "reset pembatasan" superadmin
    const acctIp = ip ? policy('loginAcctIp', `${acctKey}|${ip}`) : null
    const acctAny = policy('loginAcct', acctKey)
    //    BERURUTAN, bukan paralel (S26-T01): percobaan yang sudah ditolak lapis akun+IP TIDAK boleh menaikkan lapis akun-saja — kalau tidak,
    //    satu IP yang melewati batas per-IP menambah `loginAcct` ratusan kali dan menguncinya untuk semua orang (satu IP cukup menggembok akun
    //    korban; dulu butuh minimal dua IP). Tiap `consume` tetap atomik, jadi atomisitas SEC-26 terjaga.
    const first = acctIp ? await consume(acctIp) : null
    if (first && !first.allowed) return tooManyRequests(first.retryAfterSec)
    const second = await consume(acctAny)
    if (!second.allowed) return tooManyRequests(second.retryAfterSec)

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, role: true, isActive: true, emailVerifiedAt: true, sessionVersion: true },
    })

    // Same error for "not found" and "wrong password" — prevent email enumeration. Keduanya sudah terhitung (reservasi di atas).
    const invalid = () => NextResponse.json(err('Email atau password salah.'), { status: 401 })

    // Akun tidak ada tetap membayar biaya bcrypt yang sama (hash tiruan) — selisih waktu tak membocorkan email terdaftar.
    if (!user) {
      await compare(password, DUMMY_HASH)
      return invalid()
    }

    const match = await compare(password, user.passwordHash)
    if (!match) return invalid()

    // Password terbukti benar: hitungan reservasi dihapus SEKARANG (juga bila status akun di bawah menolak) — pengguna sah tidak membawa
    // hitungan gagal ke sesi berikutnya, dan akun nonaktif/belum terverifikasi yang berpassword benar tidak terkunci oleh percobaannya sendiri.
    await reset(...(acctIp ? [acctIp, acctAny] : [acctAny]))

    // Status akun baru diungkap SETELAH password terbukti benar — sebelum itu membedakan "akun nonaktif" dari "salah password"
    // membocorkan keberadaan akun (enumerasi email).
    if (!user.isActive) {
      return NextResponse.json(err('Akun ini dinonaktifkan. Hubungi kami untuk bantuan.'), { status: 403 })
    }
    if (!user.emailVerifiedAt) {
      // Akun lama (sebelum verifikasi email): reset password membuktikan kepemilikan email dan mengaktifkannya.
      return NextResponse.json(err('Email belum diverifikasi. Gunakan "Lupa password" untuk mengaktifkan akun.'), { status: 403 })
    }

    // Versi yang dilihat saat password diperiksa dibawa ke penerbitan: reset password yang commit di celah bcrypt membuat ini ditolak (S18-B).
    try {
      await createSession(user.id, user.sessionVersion)
    } catch (e) {
      if (e instanceof Error && e.message === 'Unauthorized') return invalid()
      throw e
    }
    return NextResponse.json(ok({ role: user.role }))
  } catch (error) {
    console.error('[auth/login]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
