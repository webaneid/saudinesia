import QRCode from 'qrcode'

/** Gambar QR (SVG) dari payload QRIS dinamis — dibuat di server; tanpa skrip/tautan, aman disisipkan sebagai gambar. */
export async function qrisSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 })
}
