import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { getOnboardingState, updateContact } from '@/lib/auth/contact'
import { contactSchema } from '@/lib/validators/auth'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { notify } from '@/lib/notifications/notify'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'

// Lengkapi data / ubah nomor telepon & WhatsApp (docs/arsitektur-auth.md §3.5).
export async function PUT(request: Request) {
  try {
    const session = await requireSession()
    const limit = await consume(policy('contactUpdateUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const parsed = contactSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return zodFailure(parsed.error)

    // Akun buatan admin lahir tanpa persetujuan Kebijakan Privasi: pemilik harus memberikannya sendiri di langkah ini (dicek SEBELUM menyimpan apa pun).
    const { privacyConsent } = parsed.data
    const state = await getOnboardingState(session.userId)
    if (state && !state.privacyConsent && privacyConsent !== true) return apiErrorJson('privacyConsentRequired', 400)

    const result = await updateContact(session.userId, parsed.data) // privasi dicatat di dalam transaksi yang sama (atomik)
    if (!result.ok) {
      return result.reason === 'consent_required'
        ? apiErrorJson('whatsappConsentRequired', 400)
        : apiErrorJson('accountNotFound', 404)
    }
    // Nomor tak terverifikasi bisa diarahkan ke orang lain — pemilik akun diberi tahu lewat email bila nomor yang sudah ada berganti.
    if (result.changed) void notify({ userId: session.userId, event: { type: 'contact_changed' } })
    return NextResponse.json(ok({ saved: true }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return apiErrorJson('unauthorized', 401)
    console.error('[auth/contact]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
