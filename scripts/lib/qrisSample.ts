import { crc16 } from '@/lib/qris/emv'

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`

/** Payload QRIS STATIS contoh yang sah (CRC cocok, ada Tag 53) — untuk uji; bukan merchant sungguhan. */
export function sampleStaticQris(merchant = 'TOKO UJI'): string {
  const body = [
    tlv('00', '01'), tlv('01', '11'),
    tlv('26', tlv('00', 'ID.CO.QRIS.WWW') + tlv('01', '936000000000000001') + tlv('02', 'ID1020000000001') + tlv('03', 'UMI')),
    tlv('52', '4722'), tlv('53', '360'), tlv('58', 'ID'), tlv('59', merchant), tlv('60', 'JAKARTA'), tlv('61', '10110'),
  ].join('') + '6304'
  return body + crc16(body)
}
