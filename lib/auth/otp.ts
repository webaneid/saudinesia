import { Redis } from 'ioredis'
import { randomInt } from 'crypto'
import { prisma } from '@/lib/db'

const OTP_TTL = 300 // 5 minutes

let _redis: Redis | null = null
let _redisOk: boolean | null = null

async function getRedis(): Promise<Redis | null> {
  if (_redisOk === false) return null
  try {
    if (!_redis) {
      const url = process.env.REDIS_URL
      if (!url) return null
      _redis = new Redis(url, { lazyConnect: true, connectTimeout: 2000 })
      _redis.on('error', () => { _redisOk = false; _redis = null })
      await _redis.connect()
    }
    _redisOk = true
    return _redis
  } catch {
    _redisOk = false
    _redis = null
    if (process.env.NODE_ENV !== 'production') return null
    throw new Error('Redis connection failed')
  }
}

export function generateOtp(): string {
  return randomInt(100000, 999999).toString()
}

export async function storeOtp(phone: string, code: string): Promise<void> {
  const r = await getRedis()
  if (r) {
    // Redis available — store there for fast lookup
    await r.setex(`otp:${phone}`, OTP_TTL, code)
  }
  // No Redis → OTP already in otp_requests table (inserted by the route handler).
  // verifyAndConsumeOtp will fall back to DB.
}

export async function verifyAndConsumeOtp(phone: string, code: string): Promise<boolean> {
  const r = await getRedis()

  if (r) {
    const stored = await r.get(`otp:${phone}`)
    if (!stored || stored !== code) return false
    await r.del(`otp:${phone}`)
    return true
  }

  // No Redis — verify from otp_requests table (works in dev without Redis)
  const record = await prisma.otpRequest.findFirst({
    where: {
      phone,
      code,
      used: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!record) return false

  await prisma.otpRequest.update({
    where: { id: record.id },
    data: { used: true },
  })

  return true
}

/** Batalkan OTP aktif untuk nomor ini (dipakai saat terlalu banyak percobaan salah). */
export async function invalidateOtp(phone: string): Promise<void> {
  const r = await getRedis().catch(() => null)
  if (r) await r.del(`otp:${phone}`)
  await prisma.otpRequest.updateMany({ where: { phone, used: false }, data: { used: true } })
}
