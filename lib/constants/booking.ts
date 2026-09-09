// Single source of truth for booking & visa status labels and colors.
// Update here → reflected everywhere in the app.

export const BOOKING_STATUS = {
  awaiting_payment: { label: 'Menunggu Pembayaran',    badge: 'warning'     },
  payment_review:   { label: 'Pembayaran Diverifikasi', badge: 'secondary'   },
  confirmed:        { label: 'Dikonfirmasi',            badge: 'success'     },
  active:           { label: 'Dalam Perjalanan',        badge: 'default'     },
  completed:        { label: 'Selesai',                 badge: 'success'     },
  cancelled:        { label: 'Dibatalkan',              badge: 'destructive' },
} as const satisfies Record<string, { label: string; badge: string }>

export const VISA_STATUS = {
  pending_documents:      { label: 'Menunggu Dokumen',   badge: 'warning'   },
  documents_complete:     { label: 'Dokumen Lengkap',    badge: 'secondary' },
  submitted_to_syarikah:  { label: 'Dikirim Syarikah',  badge: 'secondary' },
  in_review:              { label: 'Sedang Diproses',    badge: 'secondary' },
  issued:                 { label: 'Visa Terbit',        badge: 'success'   },
  rejected:               { label: 'Ditolak',            badge: 'destructive' },
} as const satisfies Record<string, { label: string; badge: string }>

export const VISA_TYPE_LABEL: Record<string, string> = {
  umroh:    'Visa Umroh',
  visit:    'Visa Ziarah / Kunjungan',
  business: 'Visa Bisnis',
  work:     'Visa Kerja',
}

export const REQUIRED_DOCUMENTS = ['passport', 'ktp', 'kk', 'evaksin', 'etiket'] as const
export type DocType = (typeof REQUIRED_DOCUMENTS)[number]

export const DOC_LABEL: Record<DocType | string, string> = {
  passport: 'Paspor (scan)',
  ktp:      'KTP / NIK',
  kk:       'Kartu Keluarga',
  evaksin:  'Sertifikat Vaksin',
  etiket:   'E-Tiket Pesawat PP',
  iqomah:   'Iqomah / Penjamin Saudi',
}

export const PAYMENT_DEADLINE_HOURS = 24
export const CANCELLATION_POLICY = {
  full:    { daysMin: 61, refundPct: 100, label: '>60 hari: refund penuh' },
  partial: { daysMin: 30, daysMax: 60, refundPct: 50, label: '30–60 hari: refund 50%' },
  none:    { daysMax: 29, refundPct: 0, label: '<30 hari: tidak ada refund' },
} as const
