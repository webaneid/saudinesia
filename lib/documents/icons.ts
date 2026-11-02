import {
  BookOpen, IdCard, Users, Syringe, Plane, Hotel, Bus, FileText, FileBadge, FileCheck, Camera, Stethoscope, GraduationCap, Heart, Landmark, ScrollText,
  type LucideIcon,
} from 'lucide-react'

// Daftar putih ikon jenis dokumen (docs/arsitektur-jamaah.md §7.1). `DocumentType.icon` menyimpan NAMA di sini — validator server menolak nama lain,
// jadi UI tidak pernah merender komponen dari teks bebas. Aman untuk klien (tanpa impor server).
export const DOCUMENT_ICONS = {
  BookOpen, IdCard, Users, Syringe, Plane, Hotel, Bus, FileText, FileBadge, FileCheck, Camera, Stethoscope, GraduationCap, Heart, Landmark, ScrollText,
} as const satisfies Record<string, LucideIcon>

export type DocumentIconName = keyof typeof DOCUMENT_ICONS
export const DOCUMENT_ICON_NAMES = Object.keys(DOCUMENT_ICONS) as DocumentIconName[]

export const isDocumentIconName = (v: string): v is DocumentIconName => Object.hasOwn(DOCUMENT_ICONS, v)
export const documentIcon = (name: string): LucideIcon => (isDocumentIconName(name) ? DOCUMENT_ICONS[name] : FileText)
