import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '../lib/manifest/constants'

const prisma = new PrismaClient()

// ─── Helpers ──────────────────────────────────────────────────
const d = (iso: string) => new Date(iso)
function addDays(date: Date, days: number) {
  const r = new Date(date)
  r.setDate(r.getDate() + days)
  return r
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding Saudinesia...\n')

  // ── 1. Superadmin ────────────────────────────────────────────
  const email = process.env.SUPERADMIN_EMAIL ?? 'admin@saudinesia.local'
  const password = process.env.SUPERADMIN_PASSWORD ?? 'Admin@1234'
  const passwordHash = await hash(password, 12)

  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, fullName: process.env.SUPERADMIN_NAME ?? 'Super Admin', role: 'superadmin', isActive: true },
    update: { passwordHash, role: 'superadmin', isActive: true },
  })
  console.log('✓ Superadmin:', email)

  // ── 1b. Contoh akun manager & admin ──────────────────────────
  // (hanya dibuat jika belum ada — untuk keperluan demo role-based access)
  const managerEmail = 'manager@saudinesia.local'
  const adminEmail   = 'ops@saudinesia.local'
  const demoHash     = await hash('Admin@1234', 12)

  await prisma.user.upsert({
    where: { email: managerEmail },
    create: { email: managerEmail, passwordHash: demoHash, fullName: 'Manajer Produk', role: 'manager', isActive: true },
    update: {},
  })
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, passwordHash: demoHash, fullName: 'Staff Operasional', role: 'admin', isActive: true },
    update: {},
  })
  console.log('✓ Demo users: manager@saudinesia.local, ops@saudinesia.local (password: Admin@1234)')

  // ── 2. Seasons ───────────────────────────────────────────────
  await prisma.season.deleteMany()
  const seasons = await prisma.season.createManyAndReturn({
    data: [
      { name: 'ramadan',  startDate: d('2026-02-20'), endDate: d('2026-03-20') },
      { name: 'hajj',     startDate: d('2026-05-01'), endDate: d('2026-06-30') },
      { name: 'regular',  startDate: d('2026-01-01'), endDate: d('2026-12-31') },
    ],
  })
  console.log('✓ Seasons:', seasons.length)

  // ── 3. Hotels ────────────────────────────────────────────────
  // Jadwal kamar (tipe × periode × HPP) TIDAK di-seed di sini secara sengaja — beda dari
  // sebelumnya (dulu harga manual per 3 musim ikut di-seed langsung). Sekarang harga lewat
  // arsitektur HPP universal (Vendor/ProductCost/computeSellPrice), diisi admin lewat UI
  // "Jadwal Kamar" setelah hotel dibuat — sama pola Visa/Flight yang juga tidak seed HPP
  // fiktif. docs/arsitektur-hotel.md §10.
  await prisma.hotel.deleteMany()

  const hotelData = [
    // MAKKAH
    {
      name: 'Makkah Clock Royal Tower – A Fairmont Hotel',
      city: 'makkah', stars: 5, distanceToHaramM: 50,
      description: 'Hotel ikonik dengan pemandangan langsung ke Masjidil Haram. Fasilitas bintang 5 dengan restoran premium dan spa.',
      facilities: ['wifi', 'breakfast', 'ac', 'pool', 'gym', 'restaurant', 'prayer_room', 'front_desk_24h'],
    },
    {
      name: 'Dar Al Tawhid Intercontinental Makkah',
      city: 'makkah', stars: 5, distanceToHaramM: 200,
      description: 'Hotel mewah bersejarah di Abraj Al-Bait, akses mudah ke Masjidil Haram via jembatan.',
      facilities: ['wifi', 'breakfast', 'ac', 'restaurant', 'prayer_room', 'elevator', 'front_desk_24h'],
    },
    {
      name: 'Ajyad Makkah Makarim Hotel',
      city: 'makkah', stars: 4, distanceToHaramM: 600,
      description: 'Hotel nyaman dengan harga terjangkau, shuttle ke Haram tersedia setiap 30 menit.',
      facilities: ['wifi', 'breakfast', 'ac', 'airport_shuttle', 'prayer_room'],
    },
    // MADINAH
    {
      name: 'Anwar Al Madinah Mövenpick Hotel',
      city: 'madinah', stars: 5, distanceToHaramM: 300,
      description: 'Hotel bintang 5 premium dengan pemandangan Masjid Nabawi, dilengkapi roof-top pool dan restoran fine dining.',
      facilities: ['wifi', 'breakfast', 'ac', 'pool', 'restaurant', 'prayer_room', 'front_desk_24h'],
    },
    {
      name: 'Saja Al Madinah Hotel',
      city: 'madinah', stars: 4, distanceToHaramM: 550,
      description: 'Hotel bintang 4 strategis dekat Masjid Nabawi, populer di kalangan jamaah Indonesia.',
      facilities: ['wifi', 'breakfast', 'ac', 'laundry', 'prayer_room'],
    },
  ]

  for (const h of hotelData) {
    await prisma.hotel.create({
      data: {
        name: h.name, city: h.city, stars: h.stars,
        distanceToHaramM: h.distanceToHaramM,
        description: h.description, images: [], facilities: h.facilities,
      },
    })
  }
  console.log('✓ Hotels:', hotelData.length, '(jadwal kamar & HPP diisi lewat admin UI)')

  // ── 4. Transport ─────────────────────────────────────────────
  await prisma.transportQuota.deleteMany()
  await prisma.transportPricing.deleteMany()
  await prisma.transportTrip.deleteMany()
  await prisma.transportVehicle.deleteMany()

  // 4a. Kendaraan — tanpa harga (harga ada di TransportPricing)
  const vehicles = await prisma.transportVehicle.createManyAndReturn({
    data: [
      { name: 'Bus Pariwisata 49',   vehicleType: 'bus',     capacity: 49, fleetCount: 3 },
      { name: 'Coaster 20',          vehicleType: 'coaster', capacity: 20, fleetCount: 4 },
      { name: 'Hiace Premio 10',     vehicleType: 'hiace',   capacity: 10, fleetCount: 6 },
      { name: 'Staria / H1 (7 Pax)', vehicleType: 'staria',  capacity: 7,  fleetCount: 5 },
      { name: 'GMC Suburban 6',      vehicleType: 'gmc',     capacity: 6,  fleetCount: 3 },
    ],
  })
  const bus    = vehicles.find(v => v.vehicleType === 'bus')!
  const coaster = vehicles.find(v => v.vehicleType === 'coaster')!
  const hiace  = vehicles.find(v => v.vehicleType === 'hiace')!
  const staria = vehicles.find(v => v.vehicleType === 'staria')!
  const gmc    = vehicles.find(v => v.vehicleType === 'gmc')!

  // 4b. Trip (paket perjalanan) — origin/destination wajib (docs/arsitektur-transportasi.md §9)
  const trips = await prisma.transportTrip.createManyAndReturn({
    data: [
      {
        name: 'Airport Transfer — Bandara ke Hotel',
        category: 'airport',
        description: 'Jemput dari bandara langsung ke hotel penginapan. Tersedia untuk semua bandara di Arab Saudi.',
        origin: 'Bandara King Abdulaziz Jeddah',
        destination: 'Hotel Makkah/Madinah',
      },
      {
        name: 'Airport Transfer — Hotel ke Bandara',
        category: 'airport',
        description: 'Antar dari hotel ke bandara untuk keberangkatan pulang.',
        origin: 'Hotel Makkah/Madinah',
        destination: 'Bandara King Abdulaziz Jeddah',
      },
      {
        name: 'City Transfer — Madinah ke Makkah',
        category: 'intercity',
        description: 'Perjalanan antar kota dari Madinah menuju Makkah.',
        origin: 'Hotel di Madinah',
        destination: 'Hotel di Makkah',
      },
      {
        name: 'City Transfer — Makkah ke Madinah',
        category: 'intercity',
        description: 'Perjalanan antar kota dari Makkah menuju Madinah.',
        origin: 'Hotel di Makkah',
        destination: 'Hotel di Madinah',
      },
      {
        name: 'City Tour Makkah — Ziarah 4 Tempat',
        category: 'city_tour',
        description: 'Tur ziarah sehari penuh: Jabal Nur, Jabal Tsur, Mina, Arafah. Dipandu muthowif.',
        origin: 'Hotel di Makkah',
        destination: '4 Tempat Ziarah Makkah',
      },
      {
        name: 'City Tour Madinah — Masjid & Makam',
        category: 'city_tour',
        description: 'Tur ziarah Madinah: Masjid Quba, Qiblatain, Kebun Kurma, Makam Uhud, Masjid Khandaq.',
        origin: 'Hotel di Madinah',
        destination: 'Masjid Nabawi & Makam Baqi',
      },
    ],
  })
  const tripAirportIn  = trips.find(t => t.name.includes('Bandara ke Hotel'))!
  const tripAirportOut = trips.find(t => t.name.includes('Hotel ke Bandara'))!
  const tripMadMak     = trips.find(t => t.name.includes('Madinah ke Makkah'))!
  const tripMakMad     = trips.find(t => t.name.includes('Makkah ke Madinah'))!
  const tripTourMak    = trips.find(t => t.name.includes('City Tour Makkah'))!
  const tripTourMad    = trips.find(t => t.name.includes('City Tour Madinah'))!

  // 4c. Pricing (trip × kendaraan) — harga & HPP diisi lewat admin UI (docs/arsitektur-transportasi.md §9.3),
  // di sini cuma bikin kombinasi rute×kendaraan yang tersedia, price default 0.
  const pricingData = [
    { tripId: tripAirportIn.id,  vehicleId: hiace.id },
    { tripId: tripAirportIn.id,  vehicleId: staria.id },
    { tripId: tripAirportIn.id,  vehicleId: gmc.id },
    { tripId: tripAirportIn.id,  vehicleId: bus.id },
    { tripId: tripAirportOut.id, vehicleId: hiace.id },
    { tripId: tripAirportOut.id, vehicleId: staria.id },
    { tripId: tripAirportOut.id, vehicleId: gmc.id },
    { tripId: tripAirportOut.id, vehicleId: bus.id },
    { tripId: tripMadMak.id, vehicleId: bus.id },
    { tripId: tripMadMak.id, vehicleId: coaster.id },
    { tripId: tripMadMak.id, vehicleId: hiace.id },
    { tripId: tripMakMad.id, vehicleId: bus.id },
    { tripId: tripMakMad.id, vehicleId: coaster.id },
    { tripId: tripMakMad.id, vehicleId: hiace.id },
    { tripId: tripTourMak.id, vehicleId: bus.id },
    { tripId: tripTourMak.id, vehicleId: coaster.id },
    { tripId: tripTourMak.id, vehicleId: hiace.id },
    { tripId: tripTourMad.id, vehicleId: bus.id },
    { tripId: tripTourMad.id, vehicleId: coaster.id },
    { tripId: tripTourMad.id, vehicleId: hiace.id },
  ]
  const pricingRows = await prisma.transportPricing.createManyAndReturn({ data: pricingData })

  // 4d. Quota — setiap 3 hari untuk 90 hari ke depan, untuk pricing bus + intercity/airport
  const busAirportIn  = pricingRows.find(p => p.tripId === tripAirportIn.id  && p.vehicleId === bus.id)!
  const busAirportOut = pricingRows.find(p => p.tripId === tripAirportOut.id && p.vehicleId === bus.id)!
  const busMadMak     = pricingRows.find(p => p.tripId === tripMadMak.id     && p.vehicleId === bus.id)!
  const busMakMad     = pricingRows.find(p => p.tripId === tripMakMad.id     && p.vehicleId === bus.id)!
  const hiaceMadMak   = pricingRows.find(p => p.tripId === tripMadMak.id     && p.vehicleId === hiace.id)!
  const hiaceMakMad   = pricingRows.find(p => p.tripId === tripMakMad.id     && p.vehicleId === hiace.id)!

  const quotaInserts = []
  for (let i = 0; i <= 90; i += 3) {
    const date = addDays(d('2026-05-11'), i)
    for (const pricing of [busAirportIn, busAirportOut, busMadMak, busMakMad, hiaceMadMak, hiaceMakMad]) {
      quotaInserts.push({ pricingId: pricing.id, travelDate: date, totalSeats: pricing.vehicleId === bus.id ? 49 : 10 })
    }
  }
  await prisma.transportQuota.createMany({ data: quotaInserts })
  console.log('✓ Transport:', vehicles.length, 'kendaraan,', trips.length, 'trip,', pricingRows.length, 'pricing,', quotaInserts.length, 'slot quota')

  // ── 5. Muthowif ──────────────────────────────────────────────
  await prisma.muthowifAvailability.deleteMany()
  await prisma.muthowif.deleteMany()

  const muthowifs = await prisma.muthowif.createManyAndReturn({
    data: [
      {
        name: 'Ustaz Abdullah Rahman, Lc.',
        bio: '15 tahun pengalaman memandu jamaah umrah dan haji. Alumnus Universitas Islam Madinah. Fasih berbahasa Arab dan Indonesia.',
        languages: ['Bahasa Indonesia', 'Arab', 'English'],
        rating: 5.0, dailyCapacity: 50,
      },
      {
        name: 'Ustaz Muhammad Fauzi, S.Ag.',
        bio: '10 tahun mendampingi jamaah dari berbagai daerah Indonesia. Spesialis sejarah Islam dan tempat ziarah di Makkah dan Madinah.',
        languages: ['Bahasa Indonesia', 'Arab'],
        rating: 4.8, dailyCapacity: 40,
      },
      {
        name: 'Ustaz Ahmad Sholeh',
        bio: '7 tahun membimbing jamaah umrah. Komunikatif, sabar, dan berpengalaman mendampingi jamaah lanjut usia.',
        languages: ['Bahasa Indonesia'],
        rating: 4.6, dailyCapacity: 35,
      },
    ],
  })

  // Harga layanan muthowif — satu baris flat, harga & HPP diisi lewat admin UI (docs/arsitektur-muthowif.md §10)
  await prisma.muthowifServicePrice.upsert({
    where: { id: 'seed-muthowif-service-price' },
    create: { id: 'seed-muthowif-service-price', price: 300_000 },
    update: {},
  })

  // Create availability for next 90 days
  const availInserts = []
  for (const m of muthowifs) {
    for (let i = 0; i <= 90; i++) {
      availInserts.push({ muthowifId: m.id, date: addDays(d('2026-05-11'), i) })
    }
  }
  await prisma.muthowifAvailability.createMany({ data: availInserts })
  console.log('✓ Muthowif:', muthowifs.length, '(+', availInserts.length, 'slot ketersediaan)')

  // ── 6. Catering ──────────────────────────────────────────────
  await prisma.cateringOption.deleteMany()
  await prisma.cateringOption.createMany({
    data: [
      {
        name: 'Full Board – Menu Asia (3x sehari)',
        boardType: 'full_board', menuStyle: 'asian',
        pricePerPersonRegular: 150_000, pricePerPersonRamadan: 200_000, pricePerPersonHajj: 250_000,
      },
      {
        name: 'Full Board – Menu Arab (3x sehari)',
        boardType: 'full_board', menuStyle: 'arabic',
        pricePerPersonRegular: 165_000, pricePerPersonRamadan: 220_000, pricePerPersonHajj: 275_000,
      },
      {
        name: 'Half Board – Menu Asia (sarapan + makan siang)',
        boardType: 'half_board', menuStyle: 'asian',
        pricePerPersonRegular: 100_000, pricePerPersonRamadan: 140_000, pricePerPersonHajj: 175_000,
      },
      {
        name: 'Half Board – Menu Arab (sarapan + makan malam)',
        boardType: 'half_board', menuStyle: 'arabic',
        pricePerPersonRegular: 110_000, pricePerPersonRamadan: 155_000, pricePerPersonHajj: 195_000,
      },
    ],
  })
  console.log('✓ Catering: 4 paket')

  // ── 7. Ziarah: TourismSite + TourPackage (docs/arsitektur-ziarah.md §8) ────
  // Menggantikan HeritageTour — paket ziarah sekarang referensi TransportTrip city_tour
  // yang sudah dibuat di section Transport di atas (tripTourMak/tripTourMad), bukan harga
  // kendaraan independen. Harga & komponen biaya tambahan diisi lewat admin UI.
  await prisma.tourPackageSite.deleteMany()
  await prisma.tourPackage.deleteMany()
  await prisma.tourismSite.deleteMany()

  const sites = await prisma.tourismSite.createManyAndReturn({
    data: [
      { name: 'Jabal Nur (Gua Hira)', city: 'makkah', description: 'Gunung tempat Rasulullah menerima wahyu pertama.' },
      { name: 'Jabal Tsur', city: 'makkah', description: 'Gua persembunyian Rasulullah dan Abu Bakar saat hijrah.' },
      { name: 'Mina', city: 'makkah', description: 'Lokasi lempar jumrah saat haji.' },
      { name: 'Arafah', city: 'makkah', description: 'Tempat wukuf, puncak ibadah haji.' },
      { name: 'Masjid Quba', city: 'madinah', description: 'Masjid pertama yang dibangun Rasulullah.' },
      { name: 'Masjid Qiblatain', city: 'madinah', description: 'Masjid tempat perubahan arah kiblat.' },
      { name: 'Makam Syuhada Uhud', city: 'madinah', description: 'Makam para syuhada Perang Uhud.' },
      { name: 'Masjid Khandaq', city: 'madinah', description: 'Lokasi Perang Khandaq (parit).' },
    ],
  })
  const site = (name: string) => sites.find(s => s.name === name)!

  const tourPackages = await prisma.tourPackage.createManyAndReturn({
    data: [
      {
        name: 'Ziarah Makkah — Sejarah Islam',
        description: 'Tur ziarah sehari penuh: Jabal Nur, Jabal Tsur, Mina, Arafah. Dipandu guide lokal.',
        transportTripId: tripTourMak.id,
      },
      {
        name: 'Ziarah Madinah — Masjid & Makam',
        description: 'Tur ziarah Madinah: Masjid Quba, Qiblatain, Makam Uhud, Masjid Khandaq.',
        transportTripId: tripTourMad.id,
      },
    ],
  })
  const pkgMakkah = tourPackages.find(p => p.name.includes('Makkah'))!
  const pkgMadinah = tourPackages.find(p => p.name.includes('Madinah'))!

  await prisma.tourPackageSite.createMany({
    data: [
      { tourPackageId: pkgMakkah.id, tourismSiteId: site('Jabal Nur (Gua Hira)').id, order: 1 },
      { tourPackageId: pkgMakkah.id, tourismSiteId: site('Jabal Tsur').id, order: 2 },
      { tourPackageId: pkgMakkah.id, tourismSiteId: site('Mina').id, order: 3 },
      { tourPackageId: pkgMakkah.id, tourismSiteId: site('Arafah').id, order: 4 },
      { tourPackageId: pkgMadinah.id, tourismSiteId: site('Masjid Quba').id, order: 1 },
      { tourPackageId: pkgMadinah.id, tourismSiteId: site('Masjid Qiblatain').id, order: 2 },
      { tourPackageId: pkgMadinah.id, tourismSiteId: site('Makam Syuhada Uhud').id, order: 3 },
      { tourPackageId: pkgMadinah.id, tourismSiteId: site('Masjid Khandaq').id, order: 4 },
    ],
  })
  console.log('✓ Ziarah: ', sites.length, 'situs wisata,', tourPackages.length, 'paket (harga & komponen biaya diisi lewat admin UI)')

  // ── Manifest "core" — field generik lepas dari produk apa pun (docs/arsitektur-booking.md
  // §6 Step 6a) — dipakai checkout pendek yang tidak mewajibkan produk lain (mis. Transport-only).
  // Scoped delete, BUKAN prisma.manifestFieldRequirement.deleteMany() polos — 9 baris visa dari
  // Step 4 (productType='visa') tidak boleh ikut terhapus.
  await prisma.manifestFieldRequirement.deleteMany({
    where: { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID },
  })
  await prisma.manifestFieldRequirement.createMany({
    data: [
      { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID, fieldKey: 'fullName', label: 'Nama Lengkap', fieldType: 'text', required: true, order: 0, role: 'display_name' },
      { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID, fieldKey: 'gender', label: 'Jenis Kelamin', fieldType: 'select', options: [{ value: 'male', label: 'Laki-laki' }, { value: 'female', label: 'Perempuan' }], required: true, order: 1, role: null },
      { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID, fieldKey: 'email', label: 'Email', fieldType: 'email', required: false, order: 2, role: 'email' },
      { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID, fieldKey: 'phone', label: 'Nomor HP', fieldType: 'phone', required: true, order: 3, role: 'phone' },
      { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID, fieldKey: 'whatsapp', label: 'Nomor WhatsApp', fieldType: 'phone', required: false, order: 4, role: 'whatsapp' },
    ],
  })
  console.log('✓ Manifest core: 5 field generik (checkout pendek non-visa)')

  // ── Room Types (Hotel) — docs/arsitektur-hotel.md §10.2 ────────
  for (const rt of [
    { name: 'Single', defaultCapacity: 1 },
    { name: 'Double', defaultCapacity: 2 },
    { name: 'Triple', defaultCapacity: 3 },
    { name: 'Quad', defaultCapacity: 4 },
    { name: 'Quint', defaultCapacity: 5 },
  ]) {
    await prisma.roomType.upsert({ where: { name: rt.name }, create: rt, update: rt })
  }
  console.log('✓ Room Types: Single/Double/Triple/Quad/Quint')

  // ── Summary ──────────────────────────────────────────────────
  console.log('\n✅ Seed selesai!')
  console.log('─────────────────────────────────')
  console.log('Admin login: /id/admin/login')
  console.log('  Email   :', email)
  console.log('  Password: Admin@1234 (atau cek .env.local)')
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
