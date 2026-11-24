'use client'

import { useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ManifestRole } from '@/lib/manifest/roles'
import type { CardField } from './cardFields'

const ROLE_KEY = {
  display_name: 'fullName', gender: 'gender', birth_place: 'birthPlace', birth_date: 'birthDate', nationality: 'nationality', nik: 'nik',
  passport_number: 'passportNumber', passport_issued: 'issued', passport_expiry: 'expiry', phone: 'contact', whatsapp: 'contact', email: 'email', address: 'address',
} as const satisfies Record<ManifestRole, string>

/** Label kolom kartu: katalog ditulis admin dalam bahasa Indonesia → di bahasa lain kolom bawaan memakai terjemahan; kolom buatan admin apa adanya. */
export function useFieldLabel(): (role: ManifestRole | null, def: CardField | null | undefined) => string {
  const t = useTranslations('shared.pilgrims.fields')
  const locale = useLocale()
  return useCallback((role, def) => (role && (locale !== 'id' || !def) ? t(ROLE_KEY[role]) : def?.label ?? ''), [t, locale])
}
