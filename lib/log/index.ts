// SATU pintu pencatatan galat di log aplikasi (docs/rencana-audit-golive.md §1, SEC-228). Aturan CLAUDE.md § Security: data pribadi jamaah/pelanggan
// tak boleh masuk log. Objek galat TIDAK pernah dicetak utuh — pesan galat Prisma memuat SELURUH argumen query (email, nomor HP, isian jamaah), dan pesan
// lain bisa menggemakan URL/tautan/masukan. Yang dicatat: nama + kode + pesan yang sudah disamarkan + lokasi kode teratas. Modul murni (tanpa impor server).

const MAX_MESSAGE = 300
const STACK_FRAMES = 3

/** Samarkan pola data pribadi/kredensial dalam teks bebas: email, deret angka ≥ 8 digit (HP, NIK, rekening), token panjang (tautan invoice, kunci, hash). */
export function redactPii(text: string): string {
  // UUID (id baris) dan tanggal/jam ISO bukan data pribadi dan penting untuk diagnosis: disisihkan dulu, dikembalikan sesudah penyamaran.
  const kept: string[] = []
  const keep = (m: string) => `\u0000${kept.push(m) - 1}\u0000`
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, keep)
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?\b/g, keep)
    .replace(/[^\s@"'`<>(){}[\],;:]+@[^\s@"'`<>(){}[\],;:]+\.[A-Za-z]{2,}/g, '[email]')
    // Token/hash: 32+ karakter base64url/heksa berturut (tautan invoice, kunci, hash).
    .replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
    // Angka panjang (boleh berspasi/strip/titik, boleh +): HP 08…/+62…, NIK 16 digit, rekening.
    .replace(/(?<![\w-])\+?\d[\d .-]{6,}\d(?![\w-])/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[angka]' : m))
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? '')
}

/** Pesan aman satu baris. Galat Prisma: hanya baris alasan terakhir (mis. "Unique constraint failed on the fields: (`email`)"); galat validasi Prisma dibuang total. */
function safeMessage(name: string, message: string): string {
  if (name === 'PrismaClientValidationError') return `validasi Prisma gagal${prismaCall(message)}`
  if (name.startsWith('PrismaClient')) {
    const reason = message.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? ''
    return `${redactPii(reason).slice(0, MAX_MESSAGE)}${prismaCall(message)}`
  }
  return redactPii(message.replace(/\s+/g, ' ').trim()).slice(0, MAX_MESSAGE)
}

/** "prisma.user.create()" dari pesan Prisma — nama model/operasi, bukan data. */
function prismaCall(message: string): string {
  const m = /`(prisma\.\w+\.\w+)\(\)`/.exec(message)
  return m ? ` (${m[1]})` : ''
}

/** Ringkasan galat untuk log: `Nama [kode]: pesan disamarkan | at lokasi ← … `. Tak pernah melempar. */
export function errorSummary(e: unknown): string {
  try {
    if (typeof e === 'string') return redactPii(e).slice(0, MAX_MESSAGE)
    if (!(e instanceof Error)) return `galat non-Error (${e === null ? 'null' : typeof e})`
    const code = (e as { code?: unknown }).code
    const tag = typeof code === 'string' || typeof code === 'number' ? ` [${code}]` : ''
    const frames = (e.stack ?? '').split('\n').filter((l) => l.trimStart().startsWith('at ')).slice(0, STACK_FRAMES).map((l) => redactPii(l.trim().slice(3)))
    return `${e.name}${tag}: ${safeMessage(e.name, e.message)}${frames.length ? ` | at ${frames.join(' ← ')}` : ''}`
  } catch {
    return 'galat (ringkasan gagal dibuat)'
  }
}

/** Konteks tambahan HANYA id/kode/angka/flag — tipe sengaja sempit supaya objek (body, data pengguna) tak bisa ikut. */
export type LogContext = Record<string, string | number | boolean | null | undefined>

function formatContext(ctx: LogContext): string {
  return Object.entries(ctx).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'string' ? redactPii(v) : String(v)}`).join(' ')
}

/** Catat galat: `[tag] ringkasan konteks`. Pengganti `console.error('[tag]', e)`. */
export function logError(tag: string, e: unknown, ctx?: LogContext): void {
  console.error(`[${tag}] ${errorSummary(e)}${ctx ? ` ${formatContext(ctx)}` : ''}`)
}

/** Peringatan dengan galat: sama seperti `logError`, tingkat warn. */
export function logWarn(tag: string, e: unknown, ctx?: LogContext): void {
  console.warn(`[${tag}] ${errorSummary(e)}${ctx ? ` ${formatContext(ctx)}` : ''}`)
}

/** Pesan event log Prisma (`$on('error'|'warn')`): bisa memuat argumen query, jadi hanya baris alasan terakhir yang disamarkan + nama operasi. */
export function prismaEventSummary(message: string): string {
  return safeMessage('PrismaClientEvent', message)
}

