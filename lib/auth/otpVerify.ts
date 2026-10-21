import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { invalidateOtp, verifyAndConsumeOtp } from '@/lib/auth/otp'
import { clientIp, consume, peek, policy, reset, tooManyRequests } from '@/lib/auth/rateLimit'

/**
 * Verifikasi OTP dengan batas percobaan (SEC-04). Kode 6 digit hanya aman bila percobaan salah dibatasi:
 *   - per IP: semua percobaan verifikasi,
 *   - per nomor: maks `otpVerifyPhone` salah dalam jendela; pada kegagalan terakhir OTP DIBATALKAN, sehingga
 *     sisa tebakan tidak berguna dan pengguna harus meminta OTP baru (itu sendiri dibatasi 3/10 menit).
 * Keberhasilan mereset hitungan salah nomor itu. Pengirim OTP baru juga mereset (lihat `resetOtpVerifyFailures`).
 */
export async function verifyOtpGuarded(request: Request, phone: string, code: string): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const ip = clientIp(request)
  if (ip) {
    const h = await consume(policy('otpVerifyIp', ip))
    if (!h.allowed) return { ok: false, response: tooManyRequests(h.retryAfterSec) }
  }

  const failures = policy('otpVerifyPhone', phone)
  const before = await peek(failures)
  if (!before.allowed) return { ok: false, response: tooManyRequests(before.retryAfterSec) }

  if (await verifyAndConsumeOtp(phone, code)) {
    await reset(failures)
    return { ok: true }
  }

  const after = await consume(failures)
  if (after.count >= after.limit) await invalidateOtp(phone)
  return { ok: false, response: NextResponse.json(err('Kode OTP salah atau sudah kadaluarsa.'), { status: 401 }) }
}

/** Dipanggil setelah OTP BARU berhasil diterbitkan: pengguna yang sah tidak boleh terkunci oleh kegagalan OTP lama. */
export async function resetOtpVerifyFailures(phone: string): Promise<void> {
  await reset(policy('otpVerifyPhone', phone))
}
