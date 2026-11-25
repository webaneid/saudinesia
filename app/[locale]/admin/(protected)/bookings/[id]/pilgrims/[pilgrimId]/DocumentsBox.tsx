'use client'

import { useRouter } from 'next/navigation'
import { DocumentRepeater } from '@/components/shared/documents/DocumentRepeater'
import type { RequirementInfo } from '@/components/shared/documents/documentRows'

// Pengunggah dokumen jamaah di halaman Kelola jamaah — komponen bersama DocumentRepeater, sesudah berubah halaman dimuat ulang supaya ringkasan
// kelengkapan di samping (dihitung server) ikut berganti.
type Props = { endpoint: string; onlyTypeIds?: string[]; readOnly: boolean; typeInfo: RequirementInfo }

export function DocumentsBox({ endpoint, onlyTypeIds, readOnly, typeInfo }: Props) {
  const router = useRouter()
  return <DocumentRepeater endpoint={endpoint} onlyTypeIds={onlyTypeIds} readOnly={readOnly} typeInfo={typeInfo} onChange={() => router.refresh()} />
}
