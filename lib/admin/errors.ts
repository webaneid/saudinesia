import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'

/**
 * Prisma `P2025` = baris yang mau di-update/delete tidak ada. Untuk id dari URL itu artinya 404, bukan 500 (SEC-61).
 * Dicek lewat `code` (bukan `instanceof PrismaClientKnownRequestError`) supaya tahan terhadap salinan Prisma ganda di bundel.
 */
export function isRecordNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2025'
}

/** Galat dari `requireSession/requireAdmin/requireManager/...` (lib/auth/session.ts). */
export function isAuthError(e: unknown): boolean {
  return e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')
}

/**
 * Untuk `try { await requireManager() } catch (e) { return authFailureResponse(e, 'tag') }`: galat auth → 403, SEMUA galat lain
 * (DB mati saat membaca sesi, bug) → dicatat + 500. Jangan pernah `catch { return 403 }` polos (SEC-08): itu menyamarkan kegagalan
 * infrastruktur sebagai "tidak berwenang" dan menyembunyikannya dari log.
 */
export function authFailureResponse(e: unknown, tag: string): NextResponse {
  if (isAuthError(e)) return NextResponse.json(err('Forbidden'), { status: 403 })
  console.error(`[${tag}]`, e instanceof Error ? e.name : e)
  return NextResponse.json(err('Internal server error'), { status: 500 })
}
