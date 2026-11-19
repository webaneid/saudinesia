import { PrismaClient } from '@prisma/client'
import { prismaEventSummary } from '@/lib/log'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

// Galat/peringatan Prisma dipancarkan sebagai EVENT, bukan dicetak Prisma sendiri: pesannya memuat seluruh argumen query (email, nomor, isian jamaah) —
// dibuktikan 2026-11-19, juga dengan errorFormat 'minimal' (docs/rencana-audit-golive.md §1, SEC-228). Kita mencatat ringkasan tersamar saja.
// Development tetap mencetak query (SQL tanpa nilai parameter) untuk diagnosis lokal.
function createClient(): PrismaClient {
  const dev = process.env.NODE_ENV === 'development'
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      ...(dev ? [{ emit: 'stdout' as const, level: 'query' as const }] : []),
    ],
  })
  client.$on('error', (e) => console.error(`[prisma] ${prismaEventSummary(e.message)}`))
  client.$on('warn', (e) => console.warn(`[prisma] ${prismaEventSummary(e.message)}`))
  return client
}

export const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
