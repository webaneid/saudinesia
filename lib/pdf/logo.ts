import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { getObjectBuffer } from '@/lib/storage/minio'
import { SETTINGS_ID } from '@/lib/invoice/settings'

// Logo kop invoice = logo TERKINI di Pengaturan Invoice (merek, bukan data tagihan; tak dibekukan). Media universal menyimpan webp,
// sedangkan @react-pdf hanya menerima PNG/JPEG → dikonversi ke PNG kecil. Gagal apa pun (tak ada logo, MinIO mati, berkas rusak) → null: invoice tetap terbit tanpa logo.
export async function loadInvoiceLogo(): Promise<Buffer | null> {
  try {
    const img = await prisma.productImage.findFirst({
      where: { productType: 'invoice_settings', productId: SETTINGS_ID },
      orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: { key: true },
    })
    if (!img) return null
    return await sharp(await getObjectBuffer(img.key)).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  } catch (e) {
    console.error('[invoice-logo] logo tidak dapat dimuat:', e instanceof Error ? e.name : 'unknown')
    return null
  }
}
