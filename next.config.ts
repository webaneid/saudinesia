import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['node-cron'],
  images: {
    loader: 'custom',
    loaderFile: './lib/storage/minio-loader.ts',
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
