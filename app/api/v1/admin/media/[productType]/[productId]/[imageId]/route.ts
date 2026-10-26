import { createMediaHandlers } from '@/lib/media/handlers'

// PATCH `{ alt?, isFeatured? }` (menjadikan sampul) dan DELETE satu foto.
const h = createMediaHandlers()
export const PATCH = h.itemPATCH
export const DELETE = h.itemDELETE
