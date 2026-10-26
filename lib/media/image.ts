import sharp from 'sharp'

// Validasi dan pemrosesan gambar unggahan (docs/arsitektur-media.md §2 poin 4-5). MIME dari klien TIDAK dipercaya: isi berkas diperiksa
// (magic bytes) lalu didekode sungguhan oleh sharp; hasilnya DIENKODE ULANG ke webp sehingga metadata EXIF (termasuk GPS) dan muatan
// tersisip tidak ikut tersimpan. Dua keluaran: tampilan (≤1600 px) dan kartu (≤640 px).

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_INPUT_PIXELS = 40_000_000 // cegah bom dekompresi (gambar kecil di berkas, ratusan megapiksel saat dibuka)
export const DISPLAY_WIDTH = 1600
export const CARD_WIDTH = 640

export class ImageRejectedError extends Error {}

function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

export type ProcessedImage = { display: Buffer; card: Buffer; width: number; height: number }

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageRejectedError('Berkas kosong.')
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageRejectedError('Ukuran file maksimal 5 MB.')
  if (!sniff(input)) throw new ImageRejectedError('Gunakan format JPG, PNG, atau WebP.')
  try {
    const base = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate() // rotate() menerapkan orientasi EXIF sebelum metadata dibuang
    const display = await base().resize({ width: DISPLAY_WIDTH, height: DISPLAY_WIDTH, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
    const card = await base().resize({ width: CARD_WIDTH, height: CARD_WIDTH, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
    return { display: display.data, card, width: display.info.width, height: display.info.height }
  } catch {
    throw new ImageRejectedError('Berkas bukan gambar yang valid.')
  }
}
