import { buildObjectKey, uploadBuffer, deleteObject, getPresignedUrl } from '@/lib/storage/minio'

// Batas ke MinIO — satu-satunya pintu (CLAUDE.md "MinIO"). Antarmuka kecil ini memungkinkan layanan media diuji dengan penyimpanan memori.
export type MediaStorage = {
  put: (key: string, body: Buffer, mime: string) => Promise<void>
  remove: (key: string) => Promise<void>
  url: (key: string, ttlSeconds: number) => Promise<string>
  newKey: (entity: string, entityId: string, name: string) => string
}

export const minioMediaStorage: MediaStorage = {
  put: uploadBuffer,
  remove: deleteObject,
  url: getPresignedUrl,
  newKey: (entity, entityId, name) => buildObjectKey(entity, entityId, 'images', name),
}
