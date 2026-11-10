'use client'

import type { ComponentProps } from 'react'
import { ClipboardList, FolderOpen, IdCard, Plane, Users } from 'lucide-react'
import { MetaBox } from '@/components/admin/editor/MetaBox'

// MetaBox untuk halaman Kelola jamaah (komponen server): ikon dipilih dengan nama, karena fungsi komponen ikon tak bisa dikirim dari server ke klien.
const ICONS = { card: IdCard, data: ClipboardList, personal: FolderOpen, trip: Plane, users: Users } as const

type Props = Omit<ComponentProps<typeof MetaBox>, 'icon'> & { icon?: keyof typeof ICONS }

export function ManageBox({ icon, ...rest }: Props) {
  return <MetaBox {...rest} icon={icon ? ICONS[icon] : undefined} />
}
