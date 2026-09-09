# M4 — Booking Wizard: Implementation Plan

## State Management Strategy

Wizard state disimpan di `localStorage` (key: `snd-booking-draft`) sebagai JSON.  
**Tidak ada DB write sampai Step 7 submit** — hanya saat final submit state di-serialize ke `POST /api/v1/bookings`.

```typescript
type BookingDraft = {
  // Step 1
  departureDate:  string         // ISO date
  returnDate:     string         // ISO date
  season:         'regular' | 'ramadan' | 'hajj'
  bookingType:    'individual' | 'group'
  groupName?:     string
  totalPilgrims:  number         // 1–4 individual, 5+ group

  // Step 2
  hotelMakkah?:  { hotelId: string; roomId: string; quotaId: string; nights: number; numRooms: number }
  hotelMadinah?: { hotelId: string; roomId: string; quotaId: string; nights: number; numRooms: number }

  // Step 3
  transport?: { quotaId: string; isCharter: boolean; numPassengers: number }[]

  // Step 4
  muthowif?: { muthowifId: string; startDate: string; endDate: string }

  // Step 5
  catering?:  { cateringOptionId: string; startDate: string; endDate: string }
  tours?:     { heritageTourId: string; tourDate: string; numPeople: number }[]
  services?:  { hotelServiceId: string; serviceDate: string; quantity: number }[]

  // Step 6
  pilgrims: PilgrimDraft[]

  // Computed
  totalAmount: number
}

type PilgrimDraft = {
  tempId:   string   // client-side UUID
  fullName: string
  gender:   string
  email:    string
  phone:    string
  visaType: 'umroh' | 'visit' | 'business' | 'work'
  // Documents uploaded via separate endpoint after booking created
}
```

## File Structure

```
app/[locale]/(pilgrim)/bookings/new/
  layout.tsx          ← WizardShell: progress bar, price sidebar, Next/Back buttons
  dates/page.tsx      ← Step 1
  hotel/page.tsx      ← Step 2
  transport/page.tsx  ← Step 3
  muthowif/page.tsx   ← Step 4
  addons/page.tsx     ← Step 5
  pilgrims/page.tsx   ← Step 6
  payment/page.tsx    ← Step 7

app/[locale]/(pilgrim)/bookings/
  [id]/page.tsx       ← Booking confirmation + status

components/booking/
  WizardShell.tsx     ← progress bar + sidebar layout (client component)
  PriceSidebar.tsx    ← running total, item breakdown
  useDraft.ts         ← custom hook: read/write localStorage draft
  HotelPicker.tsx     ← Step 2 component
  TransportPicker.tsx ← Step 3 component
  MuthowifPicker.tsx  ← Step 4 component
  PilgrimForm.tsx     ← Step 6 component
  DocumentUploader.tsx← Step 6 document upload

lib/validators/booking.ts  ← Zod schemas for booking API
app/api/v1/bookings/route.ts           ← POST: create booking
app/api/v1/bookings/[id]/route.ts      ← GET: booking detail
app/api/v1/bookings/[id]/payment/bukti/route.ts ← POST: upload bukti
```

## Step-by-step Implementation Order

### Task 1 — `useDraft` hook + WizardShell
- `useDraft.ts`: getter/setter localStorage, type-safe, auto-compute `totalAmount`
- `WizardShell.tsx`: progress bar (7 steps), price sidebar, layout wrapper
- Estimasi: ~90 min

### Task 2 — Step 1: Tanggal & Grup
- Date range picker (min 7 hari)
- Individual (1–4 orang) / Group toggle
- Auto-detect season dari tanggal → badge "Harga Ramadan berlaku"
- Estimasi: ~45 min

### Task 3 — Step 2: Hotel
- Fetch hotels by city + dates dari catalog API
- Pilih hotel Makkah (card grid) → pilih tipe kamar
- Pilih hotel Madinah (optional, tapi recommended)
- Show quota remaining per kamar
- Estimasi: ~60 min

### Task 4 — Step 3: Transportasi
- Tampilkan rute tersedia berdasarkan tanggal departure
- Toggle: per kursi (individual) vs charter (group ≥10)
- Multi-trip selection (bisa pilih beberapa rute)
- Estimasi: ~60 min

### Task 5 — Step 4: Muthowif
- Card grid guides dengan rating, bahasa, harga
- Check availability pada tanggal perjalanan
- "Skip" option (opsional)
- Estimasi: ~30 min

### Task 6 — Step 5: Add-ons
- Katering: pilih paket (full/half board, menu style)
- Heritage tours: pilih paket + tanggal dalam trip
- In-hotel services: pilih per hotel
- Estimasi: ~45 min

### Task 7 — Step 6: Data Jamaah
- Form per pilgrim: nama, gender, email, phone, visa type
- Untuk group: form tersedia untuk semua jamaah sekaligus
- Document upload ditunda → handled di M5 post-booking
  (Simplification: dokumen diupload dari dashboard, bukan di wizard)
- Estimasi: ~60 min

### Task 8 — Step 7: Pembayaran
- Summary lengkap dengan itemized pricing
- Display nomor rekening bank
- Display QRIS (gambar dari DB/config)
- Upload bukti transfer (file input → `POST /api/v1/bookings/[id]/payment/bukti`)
- Payment deadline: NOW + 24 jam
- Estimasi: ~45 min

### Task 9 — `POST /api/v1/bookings` API
- Zod validation lengkap
- `prisma.$transaction()`:
  - Check semua quota masih tersedia
  - Create `Booking` + semua line items
  - Increment `pendingQuota` untuk hotel, transport, muthowif
  - Set `paymentDeadline = NOW + 24h`
- Return `bookingCode`
- Estimasi: ~90 min (paling kompleks)

### Task 10 — Booking Confirmation Page
- `/bookings/[id]` — tampilkan booking code, status timeline
- Items summary
- Payment instruction + upload bukti form
- Estimasi: ~30 min

## Edge Cases yang Harus Dihandle

| Case | Handling |
|------|----------|
| Quota habis saat submit | Prisma transaction catch → return 409, user kembali ke Step 2 |
| Draft kadaluarsa (tanggal sudah lewat) | `useDraft` validasi tanggal saat load, clear jika kadaluarsa |
| User tidak login saat klik "Pesan" | Redirect ke login, setelah login redirect kembali ke wizard |
| User refresh di tengah wizard | State dari localStorage — tidak hilang |
| Muthowif skip | `muthowif: undefined` di draft — tidak required |
| Group tapi total < 5 | Warning, tapi tidak diblokir (pilihan user) |

## Keputusan UX: Step-by-step, tidak memaksa

**Prinsip utama M4:**
- Setiap step disimpan otomatis ke localStorage → tidak ada data hilang
- Jamaah bisa tutup browser, kembali besok, draft masih ada
- Dokumen (paspor, KTP, dll.) **tidak diupload di wizard** → diupload dari dashboard setelah booking
- Booking bisa dibuat tanpa dokumen → status jamaah: `pending_documents`
- Ini mencegah UX buruk: jamaah setengah jalan tapi belum punya dokumen, form hilang

**Flow yang benar:**
```
Wizard (7 step) → Booking terbuat → Bayar → Upload dokumen dari dashboard (santai, kapan saja)
```

**Step 6 (Data Jamaah) hanya collect:**
- Nama lengkap, gender, email, phone WA, jenis visa
- TIDAK ada file upload di wizard
- Catatan ditampilkan: "Dokumen dapat diupload setelah booking dikonfirmasi"
