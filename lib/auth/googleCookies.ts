import { cookies } from 'next/headers'
import { SIGNUP_COOKIE, STATE_COOKIE } from '@/lib/auth/google'
import { cookieSecure } from '@/lib/auth/cookieFlags'

// Opsi cookie sementara login Google. SameSite=Lax (bukan Strict seperti sesi): callback adalah navigasi tingkat-atas LINTAS-SITUS dari
// Google — cookie Strict tidak ikut terkirim sehingga state tak terbaca. httpOnly + Secure di produksi + kedaluwarsa singkat.
const base = { httpOnly: true, secure: cookieSecure(), sameSite: 'lax' as const }

export async function setStateCookie(value: string) {
  (await cookies()).set(STATE_COOKIE, value, { ...base, maxAge: 600, path: '/api/v1/auth/google' })
}
export async function takeStateCookie(): Promise<string | undefined> {
  const jar = await cookies()
  const v = jar.get(STATE_COOKIE)?.value
  jar.delete({ name: STATE_COOKIE, path: '/api/v1/auth/google' }) // sekali pakai, apa pun hasilnya
  return v
}
export async function setSignupCookie(value: string) {
  (await cookies()).set(SIGNUP_COOKIE, value, { ...base, maxAge: 900, path: '/' })
}
export async function readSignupCookieValue(): Promise<string | undefined> {
  return (await cookies()).get(SIGNUP_COOKIE)?.value
}
export async function clearSignupCookie() {
  (await cookies()).delete({ name: SIGNUP_COOKIE, path: '/' })
}
