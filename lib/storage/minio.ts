// All MinIO SDK interactions live here. Never import minio SDK outside this file.
import { Client } from 'minio'

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export const BUCKET = process.env.MINIO_BUCKET ?? 'saudinesia-docs'
// Region bucket (dipakai makeBucket) — juga region tanda tangan presigned, harus sama dengan MINIO_SITE_REGION di server.
const BUCKET_REGION = 'ap-southeast-1'

let _client: Client | null = null
let _publicClient: Client | null = null

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

// URL presigned harus bisa dibuka BROWSER. Di production MINIO_ENDPOINT = nama service Docker ("minio") yang tidak
// terjangkau dari luar, jadi tanda tangan dibuat atas host publik (MINIO_PUBLIC_URL, mis. https://berkas.domain.com
// lewat Caddy). Menandatangani itu operasi offline, tapi SDK menanyakan region ke host bila `region` tidak diberikan —
// maka region diisi eksplisit. Tanpa MINIO_PUBLIC_URL (dev lokal) dipakai client internal seperti semula.
function presignClient(): Client {
  const raw = process.env.MINIO_PUBLIC_URL
  if (!raw) return client()
  if (!_publicClient) {
    const u = new URL(raw)
    const useSSL = u.protocol === 'https:'
    _publicClient = new Client({
      endPoint: u.hostname,
      port: u.port ? parseInt(u.port, 10) : useSSL ? 443 : 80,
      useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY ?? '',
      secretKey: process.env.MINIO_SECRET_KEY ?? '',
      region: BUCKET_REGION,
    })
  }
  return _publicClient
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
  return presignClient().presignedGetObject(BUCKET, objectKey, expirySeconds)
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
    await client().makeBucket(BUCKET, BUCKET_REGION)
    console.log(`[minio] Created bucket: ${BUCKET}`)
  }
}
