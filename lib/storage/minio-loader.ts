// Custom next/image loader for MinIO-hosted images (non-sensitive, e.g. hotel photos).
// Sensitive documents must use getPresignedUrl() from lib/storage/minio.ts instead.
type LoaderProps = { src: string; width: number; quality?: number }

export default function minioLoader({ src }: LoaderProps): string {
  const base = process.env.NEXT_PUBLIC_MINIO_PUBLIC_URL ?? ''
  return `${base}/${src}`
}
