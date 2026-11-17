import sharp from 'sharp'
import jsQR from 'jsqr'
import { isUsableQrisPayload } from './emv'

// Baca payload QRIS dari foto QRIS statis yang diunggah admin (Fase 8 K8-3: gambar TIDAK disimpan — hanya payload-nya). Porting Facport `qris-decode.ts`.
// `jsQR` butuh piksel RGBA mentah → `sharp().ensureAlpha().raw()`. Gambar diperkecil (≤ 2000 px) dulu supaya ukuran piksel terbatas.
// null (bukan galat) bila bukan gambar / tanpa QR / QR bukan QRIS — admin tetap bisa menempel payload manual.
export async function decodeQrisPayload(buffer: Buffer): Promise<string | null> {
  try {
    // Jenis dibaca dari ISI berkas (bukan MIME/nama klien): hanya JPEG/PNG/WebP.
    const meta = await sharp(buffer, { limitInputPixels: 16_000_000 }).metadata()
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) return null
    const { data, info } = await sharp(buffer, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const qr = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height)
    const text = qr?.data.trim()
    return text && isUsableQrisPayload(text) ? text : null
  } catch {
    return null
  }
}
