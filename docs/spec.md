> **Catatan 2026-10-22:** butir spesifikasi auth berbasis **OTP WhatsApp** di dokumen ini (login/registrasi OTP, hitung mundur OTP, rate limit OTP, "OTP login | Yes | No") **sudah digantikan**:
> daftar/masuk jamaah = email + password dengan tautan verifikasi **atau Google**; staf = password; WhatsApp hanya kanal notifikasi ke nomor terverifikasi. Lihat ADR-0001/0002,
> `docs/arsitektur-auth.md`, `docs/auth-flow.md`. Dokumen ini adalah spesifikasi awal (arsip) untuk bagian tersebut.

# Saudinesia — Product Specification

**Platform:** Web PWA (Progressive Web App)
**Runtime:** Bun + Next.js 14 App Router
**Target users:** WNI (Indonesian citizens) planning Umrah or Ziarah to Saudi Arabia
**Operator model:** Curated — Saudinesia negotiates all contracts directly, holds all liability, and receives all funds before settling with vendors.

---

## Scope

Saudi hospitality layer covering the full Umrah journey:

| Domain | Included in Phase 1 |
|--------|---------------------|
| Visa documentation collection | Yes |
| Hotel (Makkah + Madinah) | Yes |
| Transport (charter + individual quota) | Yes |
| Muthowif (guide) | Yes |
| Catering (full board / half board) | Yes |
| Heritage / Ziyarah tours | Yes |
| In-hotel services (spa, laundry, etc.) | Yes — pre-booking only |
| Flight booking | No — Phase 2 |
| Raudah permit management | No — informational only |
| Loyalty / rewards program | No — Phase 2 |

---

## Seasons

Three fixed pricing seasons defined by ops in the admin panel:

| Season | Notes |
|--------|-------|
| Regular | Default dates outside Ramadan and Hajj |
| Ramadan | Premium pricing |
| Hajj | Premium pricing |

The system auto-detects the applicable season from the user's selected travel dates.

---

## User Roles

| Role | Description |
|------|-------------|
| **Guest** | Browse packages, pricing, and availability without an account |
| **Pilgrim (Jamaah)** | Registered user; can book, pay, upload documents, track status |
| **Group Leader (Agen)** | Books for a group; sees all member statuses; consolidated invoice |
| **Ops Admin** | Confirms payments, handles visa docs, updates booking statuses, manages notifications |
| **Super Admin** | Controls pricing, quotas, vendor catalog, cancellation rules, financial reports |

---

## Feature Checklist

### 1. Authentication

- [ ] Phone number entry screen (Indonesian +62 format)
- [ ] OTP sent via WhatsApp (go-whatsapp-web-multidevice)
- [ ] OTP input screen with 60-second resend countdown
- [ ] OTP expires after 5 minutes
- [ ] Rate limit: max 3 OTP requests per phone number per 10 minutes
- [ ] Session stored as JWT in httpOnly cookie
- [ ] Auto-redirect after login based on role (pilgrim → dashboard, admin → admin panel)
- [ ] Logout clears session
- [ ] Guest browsing: all public catalog pages accessible without login
- [ ] Registration: on first OTP verify, user is prompted to enter full name and email

---

### 2. Public Catalog (Guest-accessible)

- [ ] Landing page with featured packages and value propositions
- [ ] Hotel catalog page
  - [ ] Filter by city (Makkah / Madinah), star rating, price range
  - [ ] Sort by distance to Haram, price, rating
  - [ ] Hotel card: name, stars, city, distance to Haram, price/night (per season), availability badge
  - [ ] Hotel detail page: photos, room types, amenities, quota status
- [ ] Transport catalog page
  - [ ] Filter by route (Makkah / Madinah / Full Trip), vehicle type
  - [ ] Charter vs. individual seat options
  - [ ] Price per vehicle (charter) and per seat (individual)
- [ ] Muthowif catalog page
  - [ ] Guide profile cards: photo, name, languages, rating, daily capacity
  - [ ] Filter by language, availability on a given date
  - [ ] Muthowif detail page: bio, reviews, price/day
- [ ] Catering options page
  - [ ] Full board / half board options
  - [ ] Menu styles: Asian, Arabic, Western
  - [ ] Price per person per day per season
- [ ] Heritage tours page
  - [ ] Tour cards: name, city, duration, price, max group size
- [ ] Season-aware pricing display throughout (prices reflect selected travel dates)
- [ ] "Book Now" CTA redirects to login if unauthenticated

---

### 3. Booking Wizard (7 Steps)

The wizard saves draft state to `localStorage` so the user can resume after a page refresh. Draft is not persisted to the database until final submission.

#### Step 1 — Travel Dates & Group

- [ ] Date range picker (departure → return)
- [ ] Minimum trip: 7 days
- [ ] Auto-detect season badge from selected dates ("Ramadan pricing applies")
- [ ] Booking type: **Individual** (1–4 people) or **Group** (5+ people)
- [ ] For Group: enter group name and total headcount
- [ ] Proceed button locked until both dates and group type are set

#### Step 2 — Hotel Selection

- [ ] Select hotel for **Makkah** stay period (check-in / check-out within trip)
- [ ] Select hotel for **Madinah** stay period (same)
- [ ] For each hotel: choose room type (single / double / triple / quad) and number of rooms
- [ ] Show available quota per room type for selected dates
- [ ] Rooms with zero available quota shown as greyed out
- [ ] Price summary updates in sidebar as selections change

#### Step 3 — Transport Selection

- [ ] Route options: Makkah only / Madinah only / Full Trip (5 trips)
- [ ] For **Individual** bookings: seat-based quota per route per date; show remaining seats
- [ ] For **Group** bookings (10+ passengers): charter whole vehicle; choose vehicle type
  - Bus (49), Coaster (20), Hiace (10), Staria/H1 (7), GMC/Suburban (6), Innova/Traverse (5), Sedan (3)
- [ ] Skip transport option (pilgrim arranges own)
- [ ] Charter vehicles with insufficient capacity warn user to split across multiple vehicles

#### Step 4 — Muthowif (Guide)

- [ ] Browse muthowif catalog filtered to guides available on trip dates
- [ ] Guide card: photo, name, languages, rating, price/day, remaining capacity on those dates
- [ ] Select one guide for the full trip duration
- [ ] Skip option (optional module)

#### Step 5 — Add-ons

- [ ] **Catering:** select board type + menu style; shown per person per day; applies to full trip
- [ ] **Heritage tours:** add one or more tours; each requires a date selection within the trip
- [ ] **In-hotel services:** add spa/laundry/room service per hotel per date (pre-booked only)
- [ ] Running total sidebar with itemized breakdown

#### Step 6 — Pilgrims & Documents

- [ ] For each pilgrim, collect:
  - Full name
  - Gender
  - Email
  - Phone (WhatsApp)
- [ ] **Document uploads per pilgrim** (stored in MinIO; passport data entered by admin after review):
  - [ ] Passport scan (required) — JPG, PNG, or PDF; max 5 MB
  - [ ] KTP / national ID (required)
  - [ ] Kartu Keluarga / KK (required)
  - [ ] E-Vaccine certificate (required)
  - [ ] E-ticket round trip (required for visa)
  - [ ] Iqomah / penjamin Saudi (optional)
  - [ ] Hotel booking proof (optional)
- [ ] Accepted formats: JPG, PNG, PDF; max 5 MB per file; validated server-side
- [ ] Progress indicator per pilgrim (X of Y documents uploaded)
- [ ] **Group data entry modes:**
  - Mode A — Leader fills all data now (single session)
  - Mode B — Leader enters names only; system generates a unique link per pilgrim; pilgrims fill their own documents; leader can track completion
- [ ] Visa type selection per pilgrim: Umroh / Visit / Business / Work

#### Step 7 — Review & Payment

- [ ] Full booking summary: itemized list of all selected services with prices
- [ ] Total amount in IDR
- [ ] **Payment options:**
  - Bank transfer: display bank name, account number, account holder name
  - QRIS: display static QRIS code image for scan-to-pay via GoPay, OVO, Dana, ShopeePay, etc.
- [ ] Payment deadline: 24 hours from booking submission
- [ ] Upload bukti pembayaran (payment proof): file upload (image/PDF)
- [ ] Submit booking button creates the booking record and starts the payment deadline timer
- [ ] After submission: redirect to booking confirmation page with booking code

---

### 4. Booking Status & Tracking

- [ ] Booking status flow:

  ```
  Draft → Awaiting Payment → Payment Under Review → Confirmed → Active (travel started) → Completed → Cancelled
  ```

- [ ] Booking detail page accessible from pilgrim dashboard:
  - Booking code (e.g. `SND-2026-00123`)
  - Current status with timeline
  - Itemized summary
  - Pilgrim list with document status per person
  - Visa status per pilgrim
  - Payment status
  - Download invoice (PDF)

- [ ] Pilgrim dashboard: list of all bookings with status badges, most recent first

---

### 5. Group Booking Management

- [ ] Group leader dashboard: list of all groups and their overall status
- [ ] Group detail page:
  - Member list with per-member document completion status
  - Per-member visa status
  - Invite link management (generate / revoke per member)
  - Overall payment status
- [ ] Single consolidated invoice for the entire group
- [ ] Group leader can add or remove members before booking is confirmed
- [ ] After confirmation, member changes require ops admin approval

---

### 6. Visa Documentation Module

- [ ] Visa status per pilgrim displayed in booking detail:
  ```
  Pending Documents → Documents Complete → Submitted to Syarikah → In Review → Issued / Rejected
  ```
- [ ] System auto-advances to **Documents Complete** when all required docs are uploaded
- [ ] WhatsApp + email notification sent to pilgrim on each status change
- [ ] Ops admin can view per-pilgrim documents in admin panel
- [ ] Ops admin: download ZIP of all documents for a booking (one zip per booking)
- [ ] Ops admin: manually update visa status per pilgrim
- [ ] Rejected visa: rejection reason field (shown to pilgrim)
- [ ] Force-majeure flag: ops can mark a visa rejection as force-majeure for refund consideration

---

### 7. Payment & Financials

- [ ] Payment confirmation flow (ops admin):
  1. View bukti transfer image
  2. Check amount matches booking total
  3. Click Confirm (→ booking status: Confirmed) or Reject (→ pilgrim re-uploads)

- [ ] Auto-cancel job (runs hourly via cron):
  - Finds all bookings in `Awaiting Payment` state where `payment_deadline < NOW()`
  - Sets status to `Cancelled`
  - Releases all held quotas
  - Sends WhatsApp + email cancellation notification to pilgrim

- [ ] Payment reminder notifications:
  - T+12 hours: WhatsApp reminder with payment details
  - T+22 hours: Final WhatsApp reminder (urgent)

- [ ] **Cancellation policy** (enforced by ops admin at time of cancel request):

  | Time before departure | Refund |
  |-----------------------|--------|
  | > 60 days | 100% |
  | 30–60 days | 50% |
  | < 30 days | 0% |

- [ ] Force-majeure exceptions: ops can override refund amount (visa rejection, medical emergency, Saudi government policy change); requires super admin approval above 50% of booking value

- [ ] Refund tracking per booking: amount, reason, force-majeure flag, status (pending / approved / paid / rejected), approved by

- [ ] PDF invoice generation per booking (downloadable by pilgrim and admin):
  - Booking code, pilgrim names, itemized services, total amount, payment date

- [ ] Super admin financial report:
  - Revenue by date range
  - Revenue by season
  - Pending payments (unconfirmed)
  - Confirmed revenue
  - Cancellations and refunds
  - Breakdown by service type (hotel / transport / muthowif / etc.)

---

### 8. Notifications

All notifications are sent via WhatsApp (go-whatsapp-web-multidevice) with email as secondary for formal documents.

| Trigger | WhatsApp | Email |
|---------|----------|-------|
| OTP login | Yes | No |
| Booking submitted (awaiting payment) | Yes | Yes |
| Payment proof uploaded | Yes | No |
| Payment confirmed | Yes | Yes (with PDF invoice) |
| Payment rejected (re-upload prompt) | Yes | No |
| Payment deadline reminder (T+12h) | Yes | No |
| Payment deadline reminder (T+22h) | Yes | No |
| Auto-cancel (deadline passed) | Yes | Yes |
| Visa status: each stage change | Yes | Yes |
| Document request (member invite link) | Yes | No |
| Departure reminder (7 days before) | Yes | No |
| Departure reminder (1 day before) | Yes | No |
| Booking cancelled by user | Yes | Yes |
| Refund approved | Yes | Yes |

- [ ] Notification delivery log per booking (channel, type, status, timestamp)
- [ ] Ops admin can manually trigger re-send of any notification

---

### 9. Admin Panel (Ops)

- [ ] Booking list: search by booking code, pilgrim name, phone; filter by status, date range, visa status, payment status
- [ ] Booking detail: full view of all pilgrim data, documents, services, payment, and visa status
- [ ] Payment queue: list of bookings with uploaded bukti awaiting confirmation; confirm/reject action
- [ ] Visa management: per-booking pilgrim list with document viewer and status update
  - [ ] Inline document preview (passport scan, KTP, etc.) rendered from MinIO presigned URL
  - [ ] Admin manually inputs passport data per pilgrim: full name, passport number, expiry date, nationality
  - [ ] Passport data saved to the pilgrim record; used for visa submission to syarikah
- [ ] Download ZIP of documents per booking (one-click)
- [ ] Manual cancellation: select booking → enter reason → system applies cancellation policy → generates refund amount → requires super admin sign-off for refunds
- [ ] Quota dashboard: view remaining availability per hotel, per transport route, per muthowif per date
- [ ] Notification log: searchable history of all sent notifications
- [ ] Manual WhatsApp send: compose and send ad-hoc message to a pilgrim phone

---

### 10. Super Admin Panel

- [ ] **Season management:** define name, start date, end date for Regular / Ramadan / Hajj
- [ ] **Hotel management:**
  - [ ] Add / edit / deactivate hotels (name, city, stars, distance to Haram, images, description)
  - [ ] Add / edit room types per hotel (capacity, amenities)
  - [ ] Set prices per room type per season
  - [ ] Set quota allocation per room type per period
- [ ] **Transport management:**
  - [ ] Add / edit vehicle types (name, type, capacity)
  - [ ] Define routes (origin → destination)
  - [ ] Set prices per vehicle per season (charter rate + per-seat rate)
  - [ ] Set quota per route per date
- [ ] **Muthowif management:**
  - [ ] Add / edit guide profiles (name, bio, photo, languages, daily capacity)
  - [ ] Set price per guide per day per season
  - [ ] View daily availability calendar
- [ ] **Catering management:** add / edit catering options with per-season pricing
- [ ] **Heritage tour management:** add / edit tours with pricing
- [ ] **In-hotel service management:** add / edit services per hotel
- [ ] **User management:** view all users, search by phone/name, suspend accounts, change roles
- [ ] **Refund approval:** approve or reject refund requests (especially force-majeure overrides)
- [ ] **Financial reports** (as described in section 7)
- [ ] **QRIS management:** upload/update static QRIS image shown during checkout
- [ ] **Bank account management:** set/update bank account details shown at payment step

---

### 11. Localization

- [ ] Bahasa Indonesia (primary, default)
- [ ] English (secondary)
- [ ] Language toggle in header
- [ ] All UI strings use next-intl translation keys
- [ ] Date format: `DD MMMM YYYY` in Bahasa; `MMMM DD, YYYY` in English
- [ ] Currency format: `Rp 1.250.000` (IDR, no decimals)
- [ ] Timezone: WIB (Asia/Jakarta) for all display times

---

### 12. PWA & Performance

- [ ] `manifest.json` with app name, icons, theme color
- [ ] Installable as PWA on Android and iOS
- [ ] Service worker for basic offline caching (public pages only)
- [ ] Core Web Vitals target: LCP < 2.5s on mobile 4G
- [ ] Lazy-load images in catalog pages
- [ ] Skeleton loading states for all data-fetching pages

---

### 13. Security

- [ ] All API routes validate JWT from httpOnly cookie
- [ ] Role-based middleware on all protected routes and admin routes
- [ ] File uploads: validate MIME type server-side (not just extension); max 5 MB enforced server-side
- [ ] Document files served via signed URLs (presigned MinIO URLs, 15-minute expiry)
- [ ] Zod schema validation on all API route inputs
- [ ] Rate limiting on OTP and payment endpoints (Redis-backed)
- [ ] XSS protection: all user content rendered escaped (React default)
- [ ] CSRF protection via SameSite=Strict cookie attribute
- [ ] UU PDP (Indonesian Personal Data Protection Law) compliance notice on registration and document upload screens
- [ ] No pilgrim PII stored in application logs

---

## Out of Scope (Phase 1)

- Flight booking / GDS integration
- Raudah / Rawdah timed permit booking (shown as informational content only)
- Real-time tracking / GPS guide
- In-trip service ordering (post-arrival ordering via app)
- Loyalty / points program
- Air Zamzam cargo service
- Mobile native app (iOS / Android) — PWA only
- Multi-currency (IDR only)
- Third-party vendor portal / vendor self-service
