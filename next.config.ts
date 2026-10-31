import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  // Folder keluaran bisa dipisah (NEXT_DIST_DIR=.next-verify) supaya `next build` untuk verifikasi tidak menimpa .next milik `next dev` yang sedang berjalan.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false, // jangan umumkan framework (X-Powered-By)
  serverExternalPackages: ['node-cron'],
  images: {
    loader: 'custom',
    loaderFile: './lib/storage/minio-loader.ts',
  },
  // Invoice publik (tautan bertoken, docs/arsitektur-booking-engine-v2.md §10.4 6c): jangan diindeks, jangan disimpan cache, jangan bocorkan tautan lewat Referer.
  async headers() {
    const privateDoc = [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ]
    return [
      { source: '/:locale/invoice/:token*', headers: privateDoc },
      { source: '/api/v1/invoice/:token*', headers: privateDoc },
    ]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb', // allow up to 5 MB uploads + multipart overhead
    },
  },
  webpack(config, { isServer }) {
    if (isServer) {
      const prev = Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []
      config.externals = [...prev, 'node-cron']
    }
    return config
  },
}

export default withNextIntl(nextConfig)
