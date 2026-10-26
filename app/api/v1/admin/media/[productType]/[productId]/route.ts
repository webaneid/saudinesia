import { createMediaHandlers } from '@/lib/media/handlers'

// Media produk universal (docs/arsitektur-media.md): GET daftar, POST unggah (multipart `file` + `alt`), PATCH urutan `{ order: [imageId…] }`.
const h = createMediaHandlers()
export const GET = h.listGET
export const POST = h.listPOST
export const PATCH = h.orderPATCH
