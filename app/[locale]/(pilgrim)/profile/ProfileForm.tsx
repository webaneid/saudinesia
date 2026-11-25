'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CheckCircle2, Contact, Loader2, MapPin, Save, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { ContactPicker, contactFromStored, type ContactValue } from '@/components/shared/ContactPicker'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { EMPTY_PILGRIM_FORM, bodyFromForm, formFromCard, hasCardOnlyData, missingRequired, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import { useFieldLabel } from '@/components/shared/pilgrims/useFieldLabel'
import type { CardField } from '@/components/shared/pilgrims/cardFields'
import type { ManifestRole } from '@/lib/manifest/roles'
import type { PilgrimWarning, SavedPilgrimView } from '@/lib/pilgrims/service'
import { e164FromCountry } from '@/lib/utils/phone'
import { useApiError } from '@/components/shared/useApiError'

// Profil = SATU formulir untuk akun dan kartu "Saya sendiri" (docs/rencana-profil-jamaah.md P3). Wajib: nama lengkap dan alamat (+ nomor kontak akun);
// kolom jamaah lain mengikuti katalog Data Jamaah dan boleh kosong. Kartu disimpan bila sudah ada atau bila ada data jamaah yang diisi.
type Props = {
  needsConsent: boolean
  account: { fullName: string; email: string; phone: string; whatsapp: string }
  address: AddressValue | null
  card: SavedPilgrimView | null
  fields: CardField[]
}

/** Sudah ada di bagian akun formulir ini. */
const ACCOUNT_ROLES: readonly ManifestRole[] = ['display_name', 'phone', 'whatsapp', 'email', 'address']
const CARDS_API = '/api/v1/account/pilgrims'

type ApiJson = { success?: boolean; data?: unknown; error?: string; meta?: { warnings?: PilgrimWarning[] } } | null

async function send(method: 'POST' | 'PUT', url: string, body: unknown): Promise<{ ok: boolean; json: ApiJson }> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => null) as ApiJson
  return { ok: res.ok && json?.success === true, json }
}

export function ProfileForm({ needsConsent, account, address: initialAddress, card: initialCard, fields }: Props) {
  const router = useRouter()
  const t = useTranslations('pilgrimArea.profile')
  const tw = useTranslations('shared.pilgrims.warning')
  const errorText = useApiError()
  const labelOf = useFieldLabel()
  const [fullName, setFullName] = useState(initialCard?.fullName ?? account.fullName)
  const [address, setAddress] = useState<AddressValue>(initialAddress ?? EMPTY_ADDRESS)
  const [contact, setContact] = useState<ContactValue>(() => contactFromStored(account.phone, account.whatsapp))
  const [pilgrim, setPilgrim] = useState<SavedPilgrimFormValue>(() => (initialCard ? formFromCard(initialCard) : { ...EMPTY_PILGRIM_FORM, isSelf: true }))
  const [cardId, setCardId] = useState(initialCard?.id ?? null)
  const [consent, setConsent] = useState(!needsConsent)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Kartu yang akan disimpan: data jamaah + data akun dari formulir yang sama.
  const cardForm: SavedPilgrimFormValue = { ...pilgrim, fullName, address, contact, email: pilgrim.email || account.email, isSelf: true }
  const missing = missingRequired(cardForm, fields)

  function problem(): string | null {
    if (fullName.trim().length < 2) { nameRef.current?.focus(); return t('nameRequired') }
    if (!address.fullAddress.trim() || (address.type === 'domestic' ? !address.provinceId : !address.countryCode)) return t('addressRequired')
    if (!e164FromCountry(contact.phoneCountryCode, contact.phone) || !e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)) return t('phoneRequired')
    if (!cardId && !hasCardOnlyData(pilgrim)) return null
    if (!pilgrim.birthDate) return t('birthDateRequired')
    if ((pilgrim.passportIssuedAt || pilgrim.passportExpiry) && !pilgrim.passportNumber.trim() && !pilgrim.passportMask) return t('passportNumberRequired')
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const p = problem()
    if (p) { setNotice({ text: p, error: true }); return }
    setBusy(true); setNotice(null)
    try {
      let warnings: PilgrimWarning[] = []
      if (cardId || hasCardOnlyData(pilgrim)) {
        const r = await send(cardId ? 'PUT' : 'POST', cardId ? `${CARDS_API}/${cardId}` : CARDS_API, bodyFromForm(cardForm))
        if (!r.ok) { setNotice({ text: errorText(r.json, t('saveFailed')), error: true }); return }
        const saved = r.json!.data as SavedPilgrimView
        warnings = r.json!.meta?.warnings ?? []
        setCardId(saved.id); setPilgrim(formFromCard(saved))
      }
      const prof = await send('PUT', '/api/v1/auth/profile', { fullName: fullName.trim(), address })
      if (!prof.ok) { setNotice({ text: errorText(prof.json, t('saveFailed')), error: true }); return }

      const phone = e164FromCountry(contact.phoneCountryCode, contact.phone)
      const whatsapp = e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)
      // Kirim ulang hanya bila nomor diubah: menyimpan nama/alamat tidak boleh menulis ulang nomor (mis. nomor lama berkode panggilan di luar
      // daftar negara, atau menghabiskan batas ubah-nomor) — dan tidak memicu email "nomor diubah".
      if (phone !== account.phone || whatsapp !== account.whatsapp) {
        const c = await send('PUT', '/api/v1/auth/contact', { phone, whatsapp, ...(needsConsent ? { whatsappConsent: consent } : {}) })
        if (!c.ok) { setNotice({ text: errorText(c.json, t('phoneFailed')), error: true }); return }
      }
      setNotice({ text: [t('saved'), ...warnings.map(w => tw(w))].join(' '), error: false })
      router.refresh() // status verifikasi WhatsApp bergantung pada nomor yang baru disimpan
    } catch {
      setNotice({ text: t('error'), error: true })
    } finally {
      setBusy(false)
    }
  }

  const heading = (Icon: typeof UserRound, text: string) => (
    <h2 className="flex items-center gap-2.5 font-semibold">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden /></span> {text}
    </h2>
  )

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
        {heading(UserRound, t('mainTitle'))}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pf-name">{t('fullName')} <span className="text-destructive" aria-hidden>*</span></Label>
            <Input id="pf-name" ref={nameRef} value={fullName} onChange={e => setFullName(e.target.value)} maxLength={100} required autoComplete="name" />
            <p className="text-xs text-muted-foreground">{t('fullNameHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-email">{t('email')}</Label>
            <Input id="pf-email" value={account.email} disabled className="opacity-60" />
            <p className="text-xs text-muted-foreground">{t('emailFixed')}</p>
          </div>
        </div>
        <div className="space-y-3 border-t pt-5">
          <p className="flex items-center gap-2 text-sm font-medium"><Contact className="h-4 w-4 text-muted-foreground" aria-hidden /> {t('contactTitle')} <span className="text-destructive" aria-hidden>*</span></p>
          <ContactPicker value={contact} onChange={setContact} showEmail={false} />
          <p className="text-xs text-muted-foreground">{t('waNote')}</p>
          {needsConsent && (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 rounded border-input" required />
              <span>{t('consent')}</span>
            </label>
          )}
        </div>
        <div className="space-y-3 border-t pt-5">
          <p className="flex items-center gap-2 text-sm font-medium"><MapPin className="h-4 w-4 text-muted-foreground" aria-hidden /> {t('address')} <span className="text-destructive" aria-hidden>*</span></p>
          <AddressPicker value={address} onChange={setAddress} />
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {heading(CheckCircle2, t('pilgrimTitle'))}
            {missing.length === 0 && <Badge variant="success">{t('complete')}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{t('pilgrimIntro')}</p>
          {missing.length > 0 && <p className="text-xs text-amber-800">{t('missing', { fields: missing.map(f => labelOf(f.role as ManifestRole | null, f)).join(', ') })}</p>}
        </div>
        <SavedPilgrimFields value={pilgrim} onChange={setPilgrim} showSelf={false} idPrefix="pf" fields={fields} omit={ACCOUNT_ROLES} relaxed />
      </section>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
        <p role="status" className={`min-w-0 flex-1 text-sm ${notice?.error ? 'text-destructive' : 'text-green-700'}`}>{notice?.text}</p>
        <Button type="submit" disabled={busy || !consent}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />} {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  )
}
