import { getHomeData } from '@/lib/catalog/home'
import { HomeHero } from './_home/HomeHero'
import { HomeServices } from './_home/HomeServices'
import { HomePackages } from './_home/HomePackages'
import { HomeVisa } from './_home/HomeVisa'
import { HomeHotels } from './_home/HomeHotels'
import { HomeMuthowif } from './_home/HomeMuthowif'
import { HomeSteps } from './_home/HomeSteps'
import { HomeCta } from './_home/HomeCta'

// Homepage publik (docs/arsitektur-frontend-publik.md §3): halaman ini hanya menyusun; data di lib/catalog/home.ts, bagian tanpa data tersembunyi.
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const data = await getHomeData()
  return (
    <div className="space-y-14">
      <HomeHero locale={locale} />
      <HomeServices locale={locale} />
      <HomePackages locale={locale} packages={data.packages} />
      <HomeVisa locale={locale} visas={data.visas} />
      <HomeHotels locale={locale} hotels={data.hotels} />
      <HomeMuthowif locale={locale} pricePerDay={data.muthowif?.pricePerDay ?? null} />
      <HomeSteps locale={locale} />
      <HomeCta locale={locale} />
    </div>
  )
}
