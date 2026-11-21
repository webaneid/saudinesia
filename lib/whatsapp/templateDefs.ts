// Template pesan WhatsApp yang bisa diedit superadmin (docs/rencana-gowa-self-host.md §4.2–4.3, keputusan K1/K2). MURNI — aman di server
// dan klien (editor memakai renderTemplate/templateProblem yang sama untuk pratinjau). Teks bawaan = teks yang dipakai sebelum F3.
// Hanya 7 notifikasi (K1); balasan verifikasi nomor tetap di lib/notifications/templates/whatsapp.ts.
// Variabel TIDAK pernah memuat data pribadi (nama, email, nomor, NIK) — isi pesan masuk notification_logs.messagePreview.

export const WA_TEMPLATE_KEYS = [
  'invoice_issued',
  'payment_reminder_unpaid',
  'payment_reminder_partial',
  'payment_confirmed_full',
  'payment_confirmed_partial',
  'payment_rejected',
  'departure_reminder',
] as const
export type WaTemplateKey = (typeof WA_TEMPLATE_KEYS)[number]

export const WA_VARS = ['kodeBooking', 'nomorInvoice', 'total', 'jatuhTempo', 'tautanInvoice', 'batasWaktu', 'tagihan', 'sisaTagihan', 'hariLagi', 'tanggalBerangkat'] as const
export type WaVar = (typeof WA_VARS)[number]
export type WaValues = Partial<Record<WaVar, string>>

export const WA_VAR_LABEL: Record<WaVar, string> = {
  kodeBooking: 'Kode booking',
  nomorInvoice: 'Nomor invoice',
  total: 'Total tagihan',
  jatuhTempo: 'Jatuh tempo',
  tautanInvoice: 'Tautan invoice',
  batasWaktu: 'Batas waktu bayar',
  tagihan: 'Tagihan (bila diketahui)',
  sisaTagihan: 'Sisa tagihan',
  hariLagi: '"besok" / "7 hari lagi"',
  tanggalBerangkat: 'Tanggal berangkat',
}

/** Contoh nilai untuk pratinjau editor (bukan data sungguhan). */
export const WA_SAMPLE: Record<WaVar, string> = {
  kodeBooking: 'SND-0042',
  nomorInvoice: 'INV/2026/0042',
  total: 'Rp 35.500.000',
  jatuhTempo: '28 November 2026',
  tautanInvoice: 'https://app.saudinesia.id/id/invoice/contoh',
  batasWaktu: '28 November 2026 23.59',
  tagihan: 'Rp 35.500.000',
  sisaTagihan: 'Rp 20.500.000',
  hariLagi: '7 hari lagi',
  tanggalBerangkat: '5 Desember 2026',
}

export type WaTemplateDef = {
  label: string
  /** Kapan dikirim — tampil di editor. */
  when: string
  defaultBody: string
  vars: readonly WaVar[]
  /** Wajib ada di teks (tanpa ini pesan tak bisa dikenali pelanggan). */
  required: readonly WaVar[]
}

export const WA_TEMPLATE_DEFS: Record<WaTemplateKey, WaTemplateDef> = {
  invoice_issued: {
    label: 'Invoice terbit',
    when: 'Saat invoice booking diterbitkan (checkout pelanggan atau terbit dari admin). Tautan invoice kosong bila tak bisa dibuat — barisnya hilang sendiri.',
    defaultBody: 'Invoice *{{nomorInvoice}}* untuk booking *{{kodeBooking}}* sudah terbit.\nTotal tagihan: *{{total}}*\nJatuh tempo: *{{jatuhTempo}}*\n\nLihat & unduh invoice: {{tautanInvoice}}',
    vars: ['kodeBooking', 'nomorInvoice', 'total', 'jatuhTempo', 'tautanInvoice'],
    required: ['kodeBooking'],
  },
  payment_reminder_unpaid: {
    label: 'Pengingat bayar — belum ada pembayaran',
    when: 'H-1 dan hari jatuh tempo, bila belum ada pembayaran terverifikasi.',
    defaultBody: 'Reminder: Pembayaran booking *{{kodeBooking}}* belum kami terima.\nTagihan: *{{tagihan}}*\nBatas waktu: *{{batasWaktu}}*\n\nSegera lakukan pembayaran agar tempat Anda tetap aman.',
    vars: ['kodeBooking', 'tagihan', 'batasWaktu'],
    required: ['kodeBooking'],
  },
  payment_reminder_partial: {
    label: 'Pengingat bayar — masih ada sisa',
    when: 'H-1 dan hari jatuh tempo, bila sudah ada DP/cicilan tetapi belum lunas.',
    defaultBody: 'Reminder: Booking *{{kodeBooking}}* masih memiliki sisa tagihan *{{sisaTagihan}}*.\nBatas waktu: *{{batasWaktu}}*\n\nBukti pelunasan dapat dikirim dari halaman booking.',
    vars: ['kodeBooking', 'sisaTagihan', 'batasWaktu'],
    required: ['kodeBooking', 'sisaTagihan'],
  },
  payment_confirmed_full: {
    label: 'Pembayaran diterima — lunas',
    when: 'Saat pembayaran diverifikasi dan tagihan lunas.',
    defaultBody: 'Pembayaran booking *{{kodeBooking}}* telah dikonfirmasi. Terima kasih!\n\nDokumen perjalanan akan kami kirimkan segera setelah visa diproses.',
    vars: ['kodeBooking'],
    required: ['kodeBooking'],
  },
  payment_confirmed_partial: {
    label: 'Pembayaran diterima — sebagian',
    when: 'Saat DP/cicilan diverifikasi dan masih ada sisa tagihan.',
    defaultBody: 'Pembayaran booking *{{kodeBooking}}* telah kami terima. Terima kasih!\n\nSisa tagihan: *{{sisaTagihan}}*. Bukti pelunasan dapat dikirim dari halaman booking.',
    vars: ['kodeBooking', 'sisaTagihan'],
    required: ['kodeBooking', 'sisaTagihan'],
  },
  payment_rejected: {
    label: 'Bukti bayar ditolak',
    when: 'Saat admin menolak bukti pembayaran.',
    defaultBody: 'Bukti pembayaran untuk booking *{{kodeBooking}}* tidak dapat diverifikasi.\nMohon upload ulang bukti transfer yang jelas.',
    vars: ['kodeBooking'],
    required: ['kodeBooking'],
  },
  departure_reminder: {
    label: 'Pengingat keberangkatan',
    when: 'H-7 dan H-1 sebelum tanggal berangkat.',
    defaultBody: 'Persiapkan diri Anda! Keberangkatan booking *{{kodeBooking}}* {{hariLagi}}, *{{tanggalBerangkat}}*.\n\nSemoga perjalanan ibadah Anda lancar dan mabrur.',
    vars: ['kodeBooking', 'hariLagi', 'tanggalBerangkat'],
    required: ['kodeBooking'],
  },
}

export const WA_TEMPLATE_MAX = 1000
const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

export const isWaTemplateKey = (k: string): k is WaTemplateKey => (WA_TEMPLATE_KEYS as readonly string[]).includes(k)

/** Nama variabel yang dipakai di teks (urutan muncul, tanpa duplikat). */
export function templateVars(body: string): string[] {
  return [...new Set([...body.matchAll(VAR)].map(m => m[1]!))]
}

/** Masalah pertama teks template, atau null bila sah. Dipakai server (penolak) dan editor (pratinjau). */
export function templateProblem(key: WaTemplateKey, body: string): string | null {
  const def = WA_TEMPLATE_DEFS[key]
  if (!body.trim()) return 'Teks tidak boleh kosong.'
  if (body.length > WA_TEMPLATE_MAX) return `Teks maksimal ${WA_TEMPLATE_MAX} karakter.`
  const used = templateVars(body)
  const unknown = used.filter(v => !(def.vars as readonly string[]).includes(v))
  if (unknown.length) return `Variabel tidak dikenal untuk template ini: ${unknown.map(v => `{{${v}}}`).join(', ')}.`
  const missing = def.required.filter(v => !used.includes(v))
  if (missing.length) return `Variabel wajib belum ada: ${missing.map(v => `{{${v}}}`).join(', ')}.`
  return null
}

/**
 * Isi variabel — penggantian string satu lintasan (nilai yang berisi `{{…}}` tidak diproses ulang, tak pernah eval). Baris yang memuat variabel
 * dan SEMUA variabelnya kosong dibuang (mis. "Tagihan: **" saat tagihan tak diketahui); baris kosong beruntun diringkas.
 */
export function renderTemplate(body: string, values: WaValues): string {
  const get = (name: string): string => ((WA_VARS as readonly string[]).includes(name) ? (values[name as WaVar] ?? '').trim() : '')
  const lines = body.replace(/\r\n?/g, '\n').split('\n').flatMap(line => {
    const names = [...line.matchAll(VAR)].map(m => m[1]!)
    if (names.length > 0 && names.every(n => get(n) === '')) return []
    return [line.replace(VAR, (_, n: string) => get(n))]
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
