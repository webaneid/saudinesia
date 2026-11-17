'use client'

import type { ComponentProps } from 'react'
import { ArrowLeftRight, History, Landmark, ListChecks, ReceiptText } from 'lucide-react'
import { MetaBox } from '@/components/admin/editor/MetaBox'

// MetaBox untuk halaman detail refund (komponen server): ikon dipilih dengan nama — fungsi komponen ikon tak bisa dikirim dari server ke klien.
const ICONS = { summary: ReceiptText, flow: ArrowLeftRight, recipient: Landmark, history: History, actions: ListChecks } as const

type Props = Omit<ComponentProps<typeof MetaBox>, 'icon'> & { icon?: keyof typeof ICONS }

export function ManageBox({ icon, ...rest }: Props) {
  return <MetaBox {...rest} icon={icon ? ICONS[icon] : undefined} />
}
