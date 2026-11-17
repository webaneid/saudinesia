// QRIS EMV (docs/arsitektur-booking-engine-v2.md §8, §10.11 Fase 8) — porting logika murni Facport `apps/api/src/lib/qris-emv.ts`
// (asal: jalajogja, terbukti produksi). QRIS = teks TLV: Tag (2 digit) + Panjang (2 digit desimal) + Nilai; diakhiri Tag 63 = CRC16-CCITT.
// QRIS statis milik merchant dijadikan DINAMIS di sini (Tag 01 → "12", Tag 54 = nominal, Tag 62/05 = referensi) tanpa API acquirer.
// Murni: tanpa I/O, aman di server dan klien.

type Tlv = { tag: string; value: string }

function parseTlv(str: string): Tlv[] {
  const out: Tlv[] = []
  let i = 0
  while (i + 4 <= str.length) {
    const tag = str.slice(i, i + 2)
    if (tag === '63') break // CRC dihitung ulang terpisah
    const len = Number.parseInt(str.slice(i + 2, i + 4), 10)
    if (!/^\d{2}$/.test(str.slice(i + 2, i + 4)) || i + 4 + len > str.length) break
    out.push({ tag, value: str.slice(i + 4, i + 4 + len) })
    i += 4 + len
  }
  return out
}

const makeTlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`
const buildFromTlvs = (tlvs: Tlv[]) => tlvs.map(t => makeTlv(t.tag, t.value)).join('')

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) — varian yang DITETAPKAN spesifikasi EMV QR. */
export function crc16(str: string): string {
  let crc = 0xffff
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Bentuk QRIS sah: diawali "000201", ASCII cetak, diakhiri "6304"+CRC yang COCOK, dan TLV terurai tanpa sisa. */
export function isValidQrisPayload(payload: string): boolean {
  if (payload.length > 1000 || !/^000201[\x20-\x7E]+6304[0-9A-Fa-f]{4}$/.test(payload)) return false
  const body = payload.slice(0, -4)
  if (crc16(body) !== payload.slice(-4).toUpperCase()) return false
  const tlvs = parseTlv(payload.slice(0, -8))
  return buildFromTlvs(tlvs) === payload.slice(0, -8)
}

/** QRIS sah DAN bisa dijadikan dinamis (punya Tag 53 mata uang, tempat Tag 54 nominal disisipkan) — syarat payload yang boleh disimpan/dipakai. */
export function isUsableQrisPayload(payload: string): boolean {
  return isValidQrisPayload(payload) && parseTlv(payload.slice(0, -8)).some(t => t.tag === '53' || t.tag === '54')
}

/** Nama merchant (Tag 59) — untuk tampilan admin; null bila tak ada. */
export function qrisMerchantName(payload: string): string | null {
  return parseTlv(payload.replace(/6304[0-9A-Fa-f]{4}$/, '')).find(t => t.tag === '59')?.value ?? null
}

// Tag 62 sub-tag 05 (Reference Label) dibatasi 25 karakter oleh spesifikasi.
const MAX_REFERENCE_LENGTH = 25
export const MAX_QRIS_AMOUNT = 9_999_999_999 // Tag 54 maks 13 karakter; rupiah bulat

export class QrisError extends Error {
  constructor(message: string) { super(message); this.name = 'QrisError' }
}

/** QRIS dinamis: nominal (rupiah bulat > 0) dikunci di Tag 54, referensi di Tag 62/05, CRC baru. Payload rusak / tanpa Tag 53 & 54 → QrisError (jangan diam-diam tanpa nominal). */
export function buildDynamicQris(staticPayload: string, amount: number, reference: string): string {
  if (!isValidQrisPayload(staticPayload)) throw new QrisError('Payload QRIS tidak sah')
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_QRIS_AMOUNT) throw new QrisError('Nominal QRIS harus rupiah bulat lebih dari 0')
  const ref = reference.replace(/[^\x20-\x7E]/g, '').slice(0, MAX_REFERENCE_LENGTH)
  const src = parseTlv(staticPayload.slice(0, -8))
  const srcHas54 = src.some(t => t.tag === '54') // sudah bernominal: Tag 54 yang ada DIGANTI di tempatnya, bukan disisipkan lagi sesudah 53
  const out: Tlv[] = []
  let has54 = false
  let has62 = false
  for (const { tag, value } of src) {
    if (tag === '01') out.push({ tag: '01', value: '12' })
    else if (tag === '54') { out.push({ tag: '54', value: String(amount) }); has54 = true }
    else if (tag === '53') {
      out.push({ tag, value })
      if (!srcHas54) { out.push({ tag: '54', value: String(amount) }); has54 = true } // urutan EMV: 54 tepat sesudah 53
    } else if (tag === '62') {
      const subs = parseTlv(value)
      const next = subs.some(s => s.tag === '05') ? subs.map(s => (s.tag === '05' ? { tag: '05', value: ref } : s)) : [{ tag: '05', value: ref }, ...subs]
      out.push({ tag: '62', value: buildFromTlvs(next) })
      has62 = true
    } else if (tag === '55' || tag === '56' || tag === '57') {
      // tip/biaya layanan merchant DIBUANG: nominal yang dibayar harus persis Tag 54 (K8-4 tanpa biaya tambahan; pencocokan mutasi)
    } else out.push({ tag, value })
  }
  if (!has62 && ref) out.push({ tag: '62', value: makeTlv('05', ref) })
  if (!has54) throw new QrisError('Payload QRIS tidak berisi Tag 53/54 — tak bisa dijadikan dinamis')
  const withoutCrc = `${buildFromTlvs(out)}6304`
  return withoutCrc + crc16(withoutCrc)
}
