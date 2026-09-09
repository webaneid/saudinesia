// Daftar standar fasilitas hotel Umroh/Haji — checkbox di admin, level Hotel (bukan per tipe kamar).
// docs/arsitektur-hotel.md §10.3.
export const HOTEL_FACILITIES = [
  { code: 'wifi',            label: 'WiFi Gratis' },
  { code: 'breakfast',       label: 'Sarapan' },
  { code: 'ac',              label: 'AC' },
  { code: 'tv',              label: 'TV' },
  { code: 'pool',            label: 'Kolam Renang' },
  { code: 'gym',             label: 'Pusat Kebugaran' },
  { code: 'parking',         label: 'Parkir' },
  { code: 'room_service',    label: 'Layanan Kamar 24 Jam' },
  { code: 'prayer_room',     label: 'Ruang Sholat' },
  { code: 'airport_shuttle', label: 'Antar-Jemput Bandara' },
  { code: 'laundry',         label: 'Laundry' },
  { code: 'elevator',        label: 'Lift' },
  { code: 'restaurant',      label: 'Restoran' },
  { code: 'front_desk_24h',  label: 'Resepsionis 24 Jam' },
  { code: 'family_room',     label: 'Kamar Keluarga' },
  // Meal plan — sengaja jadi checkbox fasilitas, bukan dimensi harga terpisah.
  // docs/arsitektur-hotel.md §11.1 poin 2.
  { code: 'full_board',      label: 'Full Board' },
  { code: 'half_board',      label: 'Half Board' },
  { code: 'room_only',       label: 'Tanpa Sarapan (Room Only)' },
] as const

export type HotelFacilityCode = typeof HOTEL_FACILITIES[number]['code']
