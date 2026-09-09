// All MinIO SDK interactions live here. Never import minio SDK outside this file.
import { Client } from 'minio'

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export const BUCKET = process.env.MINIO_BUCKET ?? 'saudinesia-docs'

let _client: Client | null = null

function client(): Client {
  if (!_client) {
    _client = new Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
    })
  }
  return _client
}

// Object key: {entity}/{entityId}/{docType}/{timestampMs}-{sanitizedName}
export function buildObjectKey(
  entity: string,
  entityId: string,
  docType: string,
  filename: string,
): string {
  const safe = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_').toLowerCase()
  return `${entity}/${entityId}/${docType}/${Date.now()}-${safe}`
}

export function validateUpload(mimeType: string, sizeBytes: number): void {
  if (!ALLOWED_MIMES.has(mimeType)) {
    throw new Error('File type not allowed. Use JPG, PNG, or PDF.')
  }
  if (sizeBytes > MAX_BYTES) {
    throw new Error('File exceeds the 5 MB limit.')
  }
}

export async function uploadBuffer(
  objectKey: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  await client().putObject(BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': mimeType,
  })
}

// Default 15 min for document preview; pass 3600 for ZIP downloads
export async function getPresignedUrl(
  objectKey: string,
  expirySeconds = 900,
): Promise<string> {
  return client().presignedGetObject(BUCKET, objectKey, expirySeconds)
}

export async function deleteObject(objectKey: string): Promise<void> {
  await client().removeObject(BUCKET, objectKey)
}

// Download object as a Buffer (used for ZIP generation)
export async function getObjectBuffer(objectKey: string): Promise<Buffer> {
  const stream = await client().getObject(BUCKET, objectKey)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export async function ensureBucketExists(): Promise<void> {
  const exists = await client().bucketExists(BUCKET)
  if (!exists) {
    await client().makeBucket(BUCKET, 'ap-southeast-1')
    console.log(`[minio] Created bucket: ${BUCKET}`)
  }
}
