import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/seo/site'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = siteOrigin()

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/*/admin', '/api'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
