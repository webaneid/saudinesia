import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { MAX_INPUT_PIXELS, MAX_UPLOAD_BYTES, sniffImage } from '@/lib/media/image'

// Pemeriksa + pengolah berkas dokumen jamaah (docs/arsitektur-jamaah.md §7.3, menutup D3). Nama berkas dan MIME dari klien TIDAK dipercaya:
// jenis ditentukan dari ISI berkas. Gambar (JPG/PNG/WebP) didekode sungguhan lalu DIENKODE ULANG ke WebP — EXIF/GPS dan muatan tersisip
// tidak ikut tersimpan; sisi terpanjang 2000 px menjaga baris MRZ paspor tetap terbaca. PDF diterima apa adanya (C3) setelah bentuknya dicek.

export const DOCUMENT_MAX_SIDE = 2000
const WEBP_QUALITY = 85
// Pagar kasar terhadap PDF berisi aksi aktif (skrip, menjalankan program, berkas tersemat). Token di stream terkompresi tak terlihat di sini —
// ini lapis tambahan, bukan sandbox; berkas dibuka lewat URL presigned di origin MinIO, bukan origin aplikasi. Nama PDF boleh memakai escape
// `#xx` (`/J#61vaScript`), jadi nama didekode dulu sebelum dicocokkan (SEC-183). `/OpenAction`/`/AA` sendiri tidak ditolak (lazim di PDF
// hasil pindai untuk tampilan awal) — aksi berbahaya di dalamnya tetap tertangkap lewat namanya.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|SubmitForm|ImportData|GoToR|GoToE|XFA)\b/
const pdfNames = (raw: string) => raw.replace(/\/[^\s/<>[\]()]+/g, n => n.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))))

export class DocumentFileRejected extends Error {}

export type PreparedDocument = { body: Buffer; mimeType: 'image/webp' | 'application/pdf'; ext: 'webp' | 'pdf'; sha256: string; sizeBytes: number }

function isPdf(buf: Buffer): boolean {
  if (buf.length < 64 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return false
  return buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1').includes('%%EOF')
}

export async function prepareDocumentFile(input: Buffer): Promise<PreparedDocument> {
  if (input.length === 0) throw new DocumentFileRejected('Berkas kosong.')
  if (input.length > MAX_UPLOAD_BYTES) throw new DocumentFileRejected('Ukuran berkas maksimal 5 MB.')
  let body: Buffer
  let mimeType: PreparedDocument['mimeType']
  if (sniffImage(input)) {
    try {
      body = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // terapkan orientasi EXIF sebelum metadata dibuang
        .resize({ width: DOCUMENT_MAX_SIDE, height: DOCUMENT_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
    } catch {
      throw new DocumentFileRejected('Berkas bukan gambar yang valid.')
    }
    mimeType = 'image/webp'
  } else if (isPdf(input)) {
    if (PDF_ACTIVE.test(pdfNames(input.toString('latin1')))) throw new DocumentFileRejected('PDF berisi skrip atau lampiran tidak diterima. Simpan ulang sebagai PDF biasa atau unggah foto.')
    body = input
    mimeType = 'application/pdf'
  } else {
    throw new DocumentFileRejected('Gunakan foto (JPG, PNG, WebP) atau PDF.')
  }
  if (body.length > MAX_UPLOAD_BYTES) throw new DocumentFileRejected('Ukuran berkas maksimal 5 MB.')
  return { body, mimeType, ext: mimeType === 'image/webp' ? 'webp' : 'pdf', sha256: createHash('sha256').update(body).digest('hex'), sizeBytes: body.length }
}
