import type { CashComponent, CashDirection } from '@prisma/client'

// Label buku kas (murni — aman di klien; jangan menaruhnya di query.ts yang mengimpor Prisma Client).
export const CASH_COMPONENT_LABEL: Record<CashComponent, string> = {
  pokok: 'Pokok', ppn: 'PPN', kode_unik: 'Kode unik', kelebihan: 'Kelebihan bayar', refund: 'Refund', biaya_vendor: 'Biaya vendor', koreksi: 'Koreksi', biaya_layanan: 'Biaya layanan', mdr: 'MDR gateway',
}
export const CASH_DIRECTION_LABEL: Record<CashDirection, string> = { in: 'Masuk', out: 'Keluar' }
