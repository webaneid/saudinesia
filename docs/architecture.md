# Saudinesia — Architecture

> **Catatan modularisasi (2026-07-08):** dokumen ini adalah desain arsitektur awal dan sebagian sudah basi dibanding implementasi aktual. Setiap modul produk kini punya dokumen arsitektur tersendiri yang jadi **source of truth** untuk modul itu, menggantikan bagian terkait di sini: `docs/arsitektur-visa.md`, `docs/arsitektur-transportasi.md`, `docs/arsitektur-muthowif.md`, `docs/arsitektur-umroh.md` (booking core — wizard, pembayaran, pembatalan, cron). Modul lain (Hotel, Haji sebagai produk katalog, Katering & Tour, Paket, Group Booking) belum punya dokumen terpisah. Lihat `CLAUDE.md` bagian "Dokumentasi Arsitektur per Modul".
>
> **`docs/arsitektur-booking.md`** — rencana (belum diimplementasikan) untuk booking engine universal yang menggantikan orkestrasi per-tipe hand-written (§ "New Booking (Happy Path)" dan "Auto-Cancel" di bawah) dengan satu adapter registry + satu fungsi cancel + satu invoice generik.

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Runtime | **Bun** | Fast startup, native TypeScript, built-in test runner |
| Frontend + API | **Next.js 14 (App Router)** | SSR for SEO, Route Handlers for API, single repo |
| UI components | **shadcn/ui + Tailwind CSS** | Accessible primitives, easy to customise |
| ORM | **Prisma** | Type-safe, mature ecosystem, first-class migration tooling |
| Database | **PostgreSQL** (self-hosted on Hostinger VPS) | Relational transactions critical for quota management |
| Cache + rate-limit | **Redis** (self-hosted on Hostinger VPS) | OTP storage, rate limiting, session cache |
| File storage | **MinIO** (self-hosted on Hostinger VPS) | S3-compatible, presigned URLs for private PII documents |
| Auth | Custom JWT in httpOnly cookie | No external auth dependency; OTP via WhatsApp |
| WhatsApp | **go-whatsapp-web-multidevice / GOWA** (Sumopod) | External WA gateway by aldinokemal; called via HTTP from main VPS |
| Email | **Resend** (transactional) | Simple SDK, reliable delivery, free tier sufficient |
| i18n | **next-intl** | App Router–compatible, type-safe translation keys |
| Validation | **Zod** | Schema validation on API inputs + shared with frontend forms |
| PDF | **@react-pdf/renderer** | Server-side invoice generation |
| Cron jobs | **node-cron** in a dedicated Next.js Route or separate Bun script | Auto-cancel expired bookings, send reminders |

---

## Folder Structure

```
saudinesia/
├── app/
│   ├── [locale]/                        # next-intl locale prefix (/id, /en)
│   │   ├── (public)/                    # No auth required
│   │   │   ├── page.tsx                 # Landing page
│   │   │   ├── hotels/
│   │   │   │   ├── page.tsx             # Hotel catalog
│   │   │   │   └── [id]/page.tsx        # Hotel detail
│   │   │   ├── transport/page.tsx
│   │   │   ├── muthowif/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── catering/page.tsx
│   │   │   └── tours/page.tsx
│   │   │
│   │   ├── (auth)/                      # Unauthenticated-only routes
│   │   │   ├── login/page.tsx           # Phone entry + OTP verify
│   │   │   └── register/page.tsx        # Name + email after first OTP
│   │   │
│   │   ├── (pilgrim)/                   # Role: pilgrim or agent
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── profile/page.tsx
│   │   │   ├── bookings/
│   │   │   │   ├── page.tsx             # Booking list
│   │   │   │   ├── [id]/page.tsx        # Booking detail + status
│   │   │   │   └── new/                 # Booking wizard
│   │   │   │       ├── layout.tsx       # Wizard shell (progress bar, sidebar total)
│   │   │   │       ├── dates/page.tsx   # Step 1
│   │   │   │       ├── hotel/page.tsx   # Step 2
│   │   │   │       ├── transport/page.tsx # Step 3
│   │   │   │       ├── muthowif/page.tsx  # Step 4
│   │   │   │       ├── addons/page.tsx    # Step 5
│   │   │   │       ├── pilgrims/page.tsx  # Step 6
│   │   │   │       └── payment/page.tsx   # Step 7
│   │   │   └── groups/
│   │   │       ├── page.tsx             # Group list
│   │   │       └── [id]/page.tsx        # Group dashboard
│   │   │
│   │   ├── admin/                       # Role: admin
│   │   │   ├── layout.tsx               # Admin shell
│   │   │   ├── page.tsx                 # Admin overview
│   │   │   ├── bookings/
│   │   │   │   ├── page.tsx             # Booking list with filters
│   │   │   │   └── [id]/page.tsx        # Booking detail + actions
│   │   │   ├── payments/page.tsx        # Payment confirmation queue
│   │   │   ├── visa/page.tsx            # Visa document manager
│   │   │   ├── quotas/page.tsx          # Availability dashboard
│   │   │   └── notifications/page.tsx   # Notification log
│   │   │
│   │   └── superadmin/                  # Role: superadmin
│   │       ├── layout.tsx
│   │       ├── hotels/
│   │       │   ├── page.tsx
│   │       │   └── [id]/page.tsx
│   │       ├── transport/page.tsx
│   │       ├── muthowif/page.tsx
│   │       ├── catering/page.tsx
│   │       ├── tours/page.tsx
│   │       ├── seasons/page.tsx
│   │       ├── pricing/page.tsx
│   │       ├── users/page.tsx
│   │       ├── refunds/page.tsx
│   │       └── reports/page.tsx
│   │
│   └── api/                             # Route Handlers (JSON API)
│       ├── auth/
│       │   ├── otp/request/route.ts     # POST — send OTP to phone
│       │   ├── otp/verify/route.ts      # POST — verify OTP, set cookie
│       │   └── logout/route.ts          # POST — clear session cookie
│       │
│       ├── bookings/
│       │   ├── route.ts                 # GET (list mine), POST (create)
│       │   └── [id]/
│       │       ├── route.ts             # GET (detail), DELETE (cancel)
│       │       ├── payment/
│       │       │   └── bukti/route.ts   # POST — upload payment proof
│       │       └── invoice/route.ts     # GET — download PDF invoice
│       │
│       ├── pilgrims/[bookingId]/
│       │   ├── route.ts                 # GET (list), POST (add pilgrim)
│       │   └── [pilgrimId]/
│       │       ├── route.ts             # PUT (update pilgrim data)
│       │       └── documents/route.ts   # POST (upload doc), GET (list docs)
│       │
│       ├── groups/
│       │   ├── route.ts                 # GET, POST
│       │   └── [id]/
│       │       ├── route.ts             # GET, PUT
│       │       └── invite/route.ts      # POST — generate member invite link
│       │
│       ├── catalog/
│       │   ├── hotels/route.ts          # GET — with availability
│       │   ├── transport/route.ts       # GET — with quota
│       │   ├── muthowif/route.ts        # GET — with availability by date
│       │   ├── catering/route.ts        # GET
│       │   └── tours/route.ts           # GET
│       │
│       └── admin/
│           ├── bookings/
│           │   ├── route.ts             # GET all bookings
│           │   └── [id]/
│           │       ├── status/route.ts  # PUT — update status
│           │       └── documents/zip/route.ts  # GET — download ZIP
│           ├── payments/
│           │   └── [id]/confirm/route.ts # POST — confirm or reject
│           ├── visa/
│           │   └── [pilgrimId]/status/route.ts # PUT — update visa status
│           ├── quotas/route.ts          # GET — quota overview
│           ├── notifications/route.ts   # GET log, POST manual send
│           ├── hotels/route.ts          # CRUD
│           ├── transport/route.ts       # CRUD
│           ├── muthowif/route.ts        # CRUD
│           ├── seasons/route.ts         # CRUD
│           └── reports/route.ts         # GET financial report
│
├── components/
│   ├── ui/                              # shadcn/ui base components
│   ├── booking/                         # Wizard step components
│   │   ├── WizardShell.tsx
│   │   ├── PriceSidebar.tsx
│   │   ├── HotelPicker.tsx
│   │   ├── TransportPicker.tsx
│   │   ├── MuthowifPicker.tsx
│   │   ├── PilgrimForm.tsx
│   │   └── DocumentUploader.tsx
│   ├── admin/                           # Admin-specific components
│   └── shared/                          # Layout, header, footer, locale switcher
│
├── prisma/
│   ├── schema.prisma                    # All model definitions (source of truth)
│   └── migrations/                      # Prisma migration files
│
├── lib/
│   ├── db/
│   │   └── index.ts                     # Prisma client singleton
│   ├── auth/
│   │   ├── session.ts                   # JWT sign/verify, cookie helpers
│   │   └── otp.ts                       # Generate OTP, store/check in Redis
│   ├── whatsapp/
│   │   └── client.ts                    # HTTP client for go-whatsapp-web-multidevice API
│   ├── storage/
│   │   └── minio.ts                     # MinIO client, upload, presigned URL
│   ├── notifications/
│   │   ├── send.ts                      # Dispatch function (WA + email)
│   │   ├── templates/whatsapp.ts        # WA message templates (Bahasa + English)
│   │   └── templates/email.tsx          # React Email templates
│   ├── pdf/
│   │   └── invoice.tsx                  # @react-pdf/renderer invoice template
│   ├── quota/
│   │   └── index.ts                     # Quota check, reserve, release helpers
│   ├── cron/
│   │   └── autocancelJob.ts             # Hourly cron: cancel expired bookings
│   └── utils/
│       ├── season.ts                    # Detect season from date range
│       ├── cancellationPolicy.ts        # Compute refund amount from departure delta
│       └── bookingCode.ts               # Generate SND-YYYY-NNNNN codes
│
├── middleware.ts                        # Auth + role guard for all protected routes
├── i18n/
│   ├── messages/id.json
│   └── messages/en.json
├── next.config.ts
├── package.json
└── bunfig.toml
```

---

## Data Flow

### A. New Booking (Happy Path)

> Diagram di bawah adalah desain asli — sebagian besar masih akurat (transaksi atomik, reserve kuota Hotel/Transport/Muthowif, upload bukti → `payment_review`), tapi **tidak menyebutkan Haji** (yang ternyata tidak bisa dibooking sama sekali) dan langkah "muthowif pending→booked" (baris di bawah) memang didesain tapi tidak pernah diimplementasikan. Detail lengkap + gap kritis lain (self-cancel tidak melepas kuota, refund tidak pernah tercatat, totalAmount dipercaya dari klien): `docs/arsitektur-umroh.md` §7.

```
User (browser)                    Next.js API              PostgreSQL         Redis / MinIO / WA
─────────────────────────────────────────────────────────────────────────────────────────────
1. Wizard steps 1-6 saved to localStorage (client-side draft, no DB write)

2. Step 7: POST /api/bookings
   { wizard_state }        ──────────────────►  Validate Zod schema
                                                Check quotas available    ──► SELECT hotel_quotas...
                                                Begin transaction:
                                                  INSERT bookings
                                                  INSERT booking_hotels
                                                  INSERT booking_transports
                                                  INSERT booking_muthowif
                                                  INSERT booking_catering
                                                  INSERT booking_tours
                                                  INSERT booking_pilgrims
                                                  INSERT visa_applications (per pilgrim)
                                                  UPDATE hotel_quotas: pending_quota++
                                                  UPDATE transport_quotas: pending_seats++
                                                  UPDATE muthowif_availability: pending_count++
                                                  SET bookings.payment_deadline = NOW() + 24h
                                                Commit transaction
                           ◄──────────────────  { booking_id, booking_code }
3. User sees payment screen

4. User uploads bukti
   POST /api/bookings/{id}/payment/bukti
   { file }                ──────────────────►  Upload to MinIO             ──► PUT /documents/bukti/...
                                                INSERT payments { status: pending }
                                                UPDATE bookings { status: payment_review }
                           ◄──────────────────  { ok }
                                                Send WA: "Bukti diterima"   ──► WA gateway

5. Ops admin confirms
   POST /api/admin/payments/{id}/confirm
                           ──────────────────►  UPDATE payments { status: confirmed }
                                                UPDATE bookings { status: confirmed }
                                                UPDATE hotel_quotas: pending→booked
                                                UPDATE transport_quotas: pending→booked
                                                UPDATE muthowif_availability: pending→booked
                                                -- ⚠ BELUM DIIMPLEMENTASI: lihat docs/arsitektur-muthowif.md §7
                                                -- Gap #1 (kritis) — confirmMuthowifQuota() tidak ada,
                                                -- langkah ini didesain tapi tidak pernah ditulis di kode.
                           ◄──────────────────  { ok }
                                                Send WA + email with invoice ──► WA gateway, Resend
```

### B. Auto-Cancel (24h Deadline Missed)

> *(basi — bukan HTTP endpoint dengan cron-secret. Mekanisme aktual: `instrumentation.ts` menjalankan `startAutoCancelJob()`/`startPaymentReminderJob()` — node-cron in-process saat server startup. Ada stub route `/api/v1/internal/autocancel` & `/api/v1/internal/reminders` tapi keduanya dead code, tidak dipanggil. Lihat `docs/arsitektur-umroh.md` §6.2-6.3.)*

```
Cron job (every hour)             Next.js API              PostgreSQL
──────────────────────────────────────────────────────────────────────
1. GET /api/admin/cron/autocancel (internal, cron-secret header)

2. SELECT bookings WHERE status = 'awaiting_payment'
                         AND payment_deadline < NOW()

3. For each expired booking:
   UPDATE bookings { status: cancelled }
   UPDATE hotel_quotas: pending_quota--  (quota returned)
   UPDATE transport_quotas: pending_seats--
   UPDATE muthowif_availability: pending_count--
   INSERT notification_logs

4. Send WA + email cancellation notice to each pilgrim
```

### C. WhatsApp OTP Login

```
User                    Next.js API              Redis              WA Gateway
───────────────────────────────────────────────────────────────────────────────
1. POST /api/auth/otp/request { phone }
                   ──────────►  Rate check       ──► GET rate:{phone}
                                Generate 6-digit OTP
                                Store in Redis     ──► SET otp:{phone} { code, attempts } EX 300
                                                   ──► POST /send-message { phone, otp_template }
                   ◄──────────  { ok }

2. POST /api/auth/otp/verify { phone, code }
                   ──────────►  Fetch from Redis  ──► GET otp:{phone}
                                Validate code + not expired
                                DEL otp:{phone}    ──► DEL
                                Find or create user in DB
                                Sign JWT
                                Set httpOnly cookie
                   ◄──────────  { user, role }     (redirect based on role)
```

### D. Document Upload & Presigned URL

```
User                    Next.js API              MinIO
──────────────────────────────────────────────────────
1. POST /api/pilgrims/{bookingId}/{pilgrimId}/documents
   { file, doc_type }  ──────────►  Validate MIME + size
                                    Upload to MinIO     ──► PUT /saudinesia-docs/{booking_id}/{pilgrim_id}/{doc_type}.pdf
                                    INSERT documents { file_path }
                       ◄──────────  { doc_id }

2. GET (when admin views)
   GET /api/admin/...  ──────────►  Fetch documents record
                                    Generate presigned URL ──► Presign (15 min TTL)
                       ◄──────────  { presigned_url }
   (URL expires after 15 minutes — docs are never publicly accessible)
```

---

## Database Schema

```sql
-- ─────────────────────────────────────────────────────────────
-- USERS & AUTH
-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20)  UNIQUE NOT NULL,
  email         VARCHAR(255),
  full_name     VARCHAR(255),
  role          VARCHAR(20)  NOT NULL DEFAULT 'pilgrim',
  -- 'pilgrim' | 'agent' | 'admin' | 'superadmin'
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE otp_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20)  NOT NULL,
  code          VARCHAR(6)   NOT NULL,
  expires_at    TIMESTAMPTZ  NOT NULL,
  used          BOOLEAN      NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- Actual OTP validity lives in Redis (key: otp:{phone}).
-- This table is an audit log only.

-- ─────────────────────────────────────────────────────────────
-- SEASONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE seasons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(50)  NOT NULL, -- 'regular' | 'ramadan' | 'hajj'
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- HOTELS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE hotels (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    VARCHAR(255)  NOT NULL,
  city                    VARCHAR(20)   NOT NULL, -- 'makkah' | 'madinah'
  stars                   SMALLINT,
  distance_to_haram_m     INT,
  description             TEXT,
  images                  JSONB         NOT NULL DEFAULT '[]',
  is_active               BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE hotel_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type       VARCHAR(50)   NOT NULL, -- 'single' | 'double' | 'triple' | 'quad'
  capacity        SMALLINT      NOT NULL,
  amenities       JSONB         NOT NULL DEFAULT '[]',
  price_regular   NUMERIC(12,2) NOT NULL,
  price_ramadan   NUMERIC(12,2) NOT NULL,
  price_hajj      NUMERIC(12,2) NOT NULL
);

CREATE TABLE hotel_quotas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_room_id   UUID    NOT NULL REFERENCES hotel_rooms(id) ON DELETE CASCADE,
  period_start    DATE    NOT NULL,
  period_end      DATE    NOT NULL,
  total_quota     INT     NOT NULL,
  pending_quota   INT     NOT NULL DEFAULT 0,
  booked_quota    INT     NOT NULL DEFAULT 0,
  CONSTRAINT hotel_quotas_no_overlap EXCLUDE USING gist (
    hotel_room_id WITH =,
    daterange(period_start, period_end) WITH &&
  )
);

CREATE TABLE hotel_services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  service_name    VARCHAR(255)  NOT NULL,
  service_type    VARCHAR(50),  -- 'spa' | 'laundry' | 'room_service'
  price           NUMERIC(12,2) NOT NULL,
  description     TEXT,
  is_active       BOOLEAN       NOT NULL DEFAULT true
);

-- ─────────────────────────────────────────────────────────────
-- TRANSPORT
-- ─────────────────────────────────────────────────────────────
-- BASI — ini desain v1 (harga nempel di vehicle, transport_routes origin/destination flat).
-- Skema aktual (TransportPricing junction trip×vehicle, TransportTrip, pricingId di quota)
-- ada di `docs/arsitektur-transportasi.md` §2. Dipertahankan sebagai arsip saja.

CREATE TABLE transport_vehicles (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(100)  NOT NULL,
  vehicle_type              VARCHAR(50)   NOT NULL,
  -- 'bus' | 'coaster' | 'hiace' | 'staria' | 'gmc' | 'innova' | 'sedan'
  capacity                  SMALLINT      NOT NULL,
  price_charter_regular     NUMERIC(12,2),
  price_charter_ramadan     NUMERIC(12,2),
  price_charter_hajj        NUMERIC(12,2),
  price_per_seat_regular    NUMERIC(12,2),
  price_per_seat_ramadan    NUMERIC(12,2),
  price_per_seat_hajj       NUMERIC(12,2),
  is_active                 BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE transport_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin          VARCHAR(100) NOT NULL,
  destination     VARCHAR(100) NOT NULL,
  trip_type       VARCHAR(50)  NOT NULL
  -- 'makkah_only' | 'madinah_only' | 'full_trip_5'
);

CREATE TABLE transport_quotas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      UUID    NOT NULL REFERENCES transport_vehicles(id),
  route_id        UUID    NOT NULL REFERENCES transport_routes(id),
  travel_date     DATE    NOT NULL,
  is_charter      BOOLEAN NOT NULL DEFAULT false,
  total_seats     INT     NOT NULL,
  pending_seats   INT     NOT NULL DEFAULT 0,
  booked_seats    INT     NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────
-- MUTHOWIF (GUIDES)
-- ─────────────────────────────────────────────────────────────
-- Skema di bawah masih representatif (cocok dengan Prisma aktual), tapi endpoint API
-- dan alur konfirmasi pembayaran sudah tidak sesuai — lihat `docs/arsitektur-muthowif.md`.

CREATE TABLE muthowif (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255)  NOT NULL,
  bio             TEXT,
  photo_url       VARCHAR(500),
  languages       JSONB         NOT NULL DEFAULT '[]',
  rating          NUMERIC(3,2)  NOT NULL DEFAULT 5.00,
  daily_capacity  INT           NOT NULL DEFAULT 50,
  price_regular   NUMERIC(12,2) NOT NULL,
  price_ramadan   NUMERIC(12,2) NOT NULL,
  price_hajj      NUMERIC(12,2) NOT NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE muthowif_availability (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muthowif_id     UUID    NOT NULL REFERENCES muthowif(id) ON DELETE CASCADE,
  date            DATE    NOT NULL,
  pending_count   INT     NOT NULL DEFAULT 0,
  booked_count    INT     NOT NULL DEFAULT 0,
  UNIQUE (muthowif_id, date)
);

-- ─────────────────────────────────────────────────────────────
-- CATERING & TOURS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE catering_options (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        VARCHAR(255)  NOT NULL,
  board_type                  VARCHAR(20)   NOT NULL, -- 'full_board' | 'half_board'
  menu_style                  VARCHAR(20)   NOT NULL, -- 'asian' | 'arabic' | 'western'
  price_per_person_regular    NUMERIC(12,2) NOT NULL,
  price_per_person_ramadan    NUMERIC(12,2) NOT NULL,
  price_per_person_hajj       NUMERIC(12,2) NOT NULL,
  is_active                   BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE heritage_tours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255)  NOT NULL,
  description     TEXT,
  city            VARCHAR(20),
  duration_hours  NUMERIC(4,1),
  max_group_size  INT,
  price_per_person NUMERIC(12,2) NOT NULL,
  images          JSONB         NOT NULL DEFAULT '[]',
  is_active       BOOLEAN       NOT NULL DEFAULT true
);

-- ─────────────────────────────────────────────────────────────
-- GROUPS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code      VARCHAR(20)   UNIQUE NOT NULL,
  group_name      VARCHAR(255),
  leader_user_id  UUID          NOT NULL REFERENCES users(id),
  total_members   INT           NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- BOOKINGS (MASTER)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code      VARCHAR(20)   UNIQUE NOT NULL, -- SND-2026-00001
  user_id           UUID          NOT NULL REFERENCES users(id),
  group_id          UUID          REFERENCES groups(id),
  status            VARCHAR(30)   NOT NULL DEFAULT 'awaiting_payment',
  -- 'awaiting_payment' | 'payment_review' | 'confirmed'
  -- | 'active' | 'completed' | 'cancelled'
  departure_date    DATE          NOT NULL,
  return_date       DATE          NOT NULL,
  season            VARCHAR(20)   NOT NULL, -- detected at creation time
  total_amount      NUMERIC(14,2) NOT NULL,
  notes             TEXT,
  payment_deadline  TIMESTAMPTZ,            -- set to created_at + 24h
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- PILGRIMS PER BOOKING
-- ─────────────────────────────────────────────────────────────

CREATE TABLE booking_pilgrims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id           UUID          REFERENCES users(id), -- NULL if not a registered user
  full_name         VARCHAR(255)  NOT NULL,
  gender            VARCHAR(10),
  email             VARCHAR(255),
  phone             VARCHAR(20),
  -- Passport fields filled by admin after reviewing uploaded passport scan:
  passport_number   VARCHAR(50),
  passport_expiry   DATE,
  nationality       VARCHAR(50)   NOT NULL DEFAULT 'Indonesian',
  date_of_birth     DATE,
  is_leader         BOOLEAN       NOT NULL DEFAULT false
);

-- BASI — skema visa_applications & documents aktual (VisaProduct, requirements JSON,
-- visaProductId, camelCase Prisma) ada di `docs/arsitektur-visa.md` §2. Blok di bawah
-- adalah desain v1 sebelum VisaProduct/visaType free-text ada, dipertahankan sebagai arsip saja.
CREATE TABLE visa_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_pilgrim_id    UUID        NOT NULL REFERENCES booking_pilgrims(id) ON DELETE CASCADE,
  visa_type             VARCHAR(20) NOT NULL,
  -- 'umroh' | 'visit' | 'business' | 'work'
  status                VARCHAR(40) NOT NULL DEFAULT 'pending_documents',
  -- 'pending_documents' | 'documents_complete' | 'submitted_to_syarikah'
  -- | 'in_review' | 'issued' | 'rejected'
  submitted_at          TIMESTAMPTZ,
  issued_at             TIMESTAMPTZ,
  rejection_reason      TEXT,
  is_force_majeure      BOOLEAN     NOT NULL DEFAULT false,
  notes                 TEXT
);

CREATE TABLE documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_pilgrim_id    UUID          NOT NULL REFERENCES booking_pilgrims(id) ON DELETE CASCADE,
  doc_type              VARCHAR(50)   NOT NULL,
  -- 'passport' | 'ktp' | 'kk' | 'evaksin' | 'etiket' | 'iqomah' | 'other'
  file_name             VARCHAR(255)  NOT NULL,
  file_path             VARCHAR(500)  NOT NULL, -- MinIO object key
  file_size_bytes       INT,
  uploaded_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- BOOKING COMPONENTS (line items)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE booking_hotels (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_quota_id    UUID          NOT NULL REFERENCES hotel_quotas(id),
  hotel_room_id     UUID          NOT NULL REFERENCES hotel_rooms(id),
  check_in          DATE          NOT NULL,
  check_out         DATE          NOT NULL,
  nights            INT           NOT NULL,
  num_rooms         INT           NOT NULL DEFAULT 1,
  num_guests        INT           NOT NULL,
  price_per_night   NUMERIC(12,2) NOT NULL,
  total_price       NUMERIC(14,2) NOT NULL
);

CREATE TABLE booking_transports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  transport_quota_id    UUID          NOT NULL REFERENCES transport_quotas(id),
  travel_date           DATE          NOT NULL,
  num_passengers        INT           NOT NULL,
  is_charter            BOOLEAN       NOT NULL DEFAULT false,
  total_price           NUMERIC(14,2) NOT NULL
);

CREATE TABLE booking_muthowif (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  muthowif_id     UUID          NOT NULL REFERENCES muthowif(id),
  start_date      DATE          NOT NULL,
  end_date        DATE          NOT NULL,
  num_days        INT           NOT NULL,
  num_people      INT           NOT NULL,
  total_price     NUMERIC(14,2) NOT NULL
);

CREATE TABLE booking_catering (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  catering_option_id    UUID          NOT NULL REFERENCES catering_options(id),
  start_date            DATE          NOT NULL,
  end_date              DATE          NOT NULL,
  num_days              INT           NOT NULL,
  num_people            INT           NOT NULL,
  total_price           NUMERIC(14,2) NOT NULL
);

CREATE TABLE booking_tours (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  heritage_tour_id  UUID          NOT NULL REFERENCES heritage_tours(id),
  tour_date         DATE          NOT NULL,
  num_people        INT           NOT NULL,
  total_price       NUMERIC(14,2) NOT NULL
);

CREATE TABLE booking_services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  hotel_service_id  UUID          NOT NULL REFERENCES hotel_services(id),
  service_date      DATE,
  quantity          INT           NOT NULL DEFAULT 1,
  total_price       NUMERIC(14,2) NOT NULL
);

-- ─────────────────────────────────────────────────────────────
-- PAYMENTS & REFUNDS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE payments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                  UUID          NOT NULL REFERENCES bookings(id),
  amount                      NUMERIC(14,2) NOT NULL,
  method                      VARCHAR(20)   NOT NULL, -- 'bank_transfer' | 'qris'
  status                      VARCHAR(20)   NOT NULL DEFAULT 'pending',
  -- 'pending' | 'confirmed' | 'rejected'
  bukti_transfer_path         VARCHAR(500),            -- MinIO object key
  bukti_transfer_uploaded_at  TIMESTAMPTZ,
  confirmed_by                UUID          REFERENCES users(id),
  confirmed_at                TIMESTAMPTZ,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID          NOT NULL REFERENCES bookings(id),
  amount          NUMERIC(14,2) NOT NULL,
  reason          TEXT          NOT NULL,
  is_force_majeure BOOLEAN      NOT NULL DEFAULT false,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'paid' | 'rejected'
  approved_by     UUID          REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE notification_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id),
  booking_id      UUID        REFERENCES bookings(id),
  channel         VARCHAR(20) NOT NULL, -- 'whatsapp' | 'email'
  type            VARCHAR(50) NOT NULL,
  -- 'otp' | 'booking_submitted' | 'payment_reminder_12h'
  -- | 'payment_reminder_22h' | 'payment_confirmed' | 'payment_rejected'
  -- | 'auto_cancelled' | 'visa_status_change' | 'departure_reminder'
  -- | 'refund_approved'
  recipient       VARCHAR(255) NOT NULL, -- phone or email
  message_preview TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'sent',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error           TEXT
);

-- ─────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────

CREATE INDEX idx_bookings_user_id      ON bookings(user_id);
CREATE INDEX idx_bookings_status       ON bookings(status);
CREATE INDEX idx_bookings_deadline     ON bookings(payment_deadline) WHERE status = 'awaiting_payment';
CREATE INDEX idx_booking_pilgrims_bid  ON booking_pilgrims(booking_id);
CREATE INDEX idx_visa_pilgrim_id       ON visa_applications(booking_pilgrim_id);
CREATE INDEX idx_documents_pilgrim_id  ON documents(booking_pilgrim_id);
CREATE INDEX idx_payments_booking_id   ON payments(booking_id);
CREATE INDEX idx_notif_user_id         ON notification_logs(user_id);
CREATE INDEX idx_notif_booking_id      ON notification_logs(booking_id);
```

---

## API Design

All endpoints return `{ data, error }` JSON. HTTP status codes follow REST conventions.
Authentication is via JWT in an httpOnly cookie (`snd-session`). Admin routes additionally require the user's `role` claim.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/otp/request` | None | Send OTP to phone. Body: `{ phone }` |
| POST | `/api/auth/otp/verify` | None | Verify OTP. Body: `{ phone, code }`. Sets cookie. |
| POST | `/api/auth/logout` | Any | Clear session cookie |

### Catalog (public)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/catalog/hotels` | None | Query: `city`, `check_in`, `check_out`, `guests` → returns hotels with quota status |
| GET | `/api/catalog/hotels/:id` | None | Hotel detail with rooms and availability |
| GET | `/api/catalog/transport` | None | *(basi — path & query params aktual di `docs/arsitektur-transportasi.md` §3: `/api/v1/catalog/transport?category&date`)* |
| GET | `/api/catalog/muthowif` | None | *(path basi, harusnya `/api/v1/catalog/muthowif` — tapi query params & behavior masih akurat, lihat `docs/arsitektur-muthowif.md` §3)* |
| GET | `/api/catalog/catering` | None | All active catering options |
| GET | `/api/catalog/tours` | None | All active heritage tours |

### Bookings (pilgrim)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bookings` | Pilgrim | List my bookings |
| POST | `/api/bookings` | Pilgrim | Create booking from wizard state. Atomic — quotas reserved in a transaction. |
| GET | `/api/bookings/:id` | Pilgrim (owner) | Full booking detail |
| DELETE | `/api/bookings/:id` | Pilgrim (owner) | Request cancellation. Refund computed, status → cancelled. *(refund amount dihitung tapi TIDAK PERNAH disimpan sebagai record, dan kuota TIDAK PERNAH dilepas — gap kritis, lihat `docs/arsitektur-umroh.md` §7 Gap #2 & #3)* |
| POST | `/api/bookings/:id/payment/bukti` | Pilgrim (owner) | Upload payment proof. Multipart form. |
| GET | `/api/bookings/:id/invoice` | Pilgrim (owner) | *(belum diimplementasikan — selalu return null, lihat `docs/arsitektur-umroh.md` §7)* |

### Pilgrims & Documents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/pilgrims/:bookingId` | Pilgrim (owner) | List pilgrims in booking |
| POST | `/api/pilgrims/:bookingId` | Pilgrim (owner) | Add a pilgrim |
| PUT | `/api/pilgrims/:bookingId/:pilgrimId` | Pilgrim (owner) | Update pilgrim data |
| POST | `/api/pilgrims/:bookingId/:pilgrimId/documents` | Pilgrim or invite token | Upload a document. Multipart. |
| GET | `/api/pilgrims/:bookingId/:pilgrimId/documents` | Pilgrim (owner) | List docs + presigned URLs |

### Groups

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/groups` | Agent | List my groups |
| POST | `/api/groups` | Agent | Create group |
| GET | `/api/groups/:id` | Agent (owner) | Group detail with member list |
| POST | `/api/groups/:id/invite` | Agent (owner) | Generate invite link for a member slot |

### Admin — Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/bookings` | Admin | List all bookings. Query: `status`, `date_from`, `date_to`, `search` |
| GET | `/api/admin/bookings/:id` | Admin | Full booking detail |
| PUT | `/api/admin/bookings/:id/status` | Admin | Manually update status |
| GET | `/api/admin/bookings/:id/documents/zip` | Admin | Stream ZIP of all pilgrim docs |

### Admin — Payments & Visa

> Endpoint visa aktual (path, auth guard, dan route yang ternyata tidak pernah dibuat sebagai Route Handler) ada di `docs/arsitektur-visa.md` §4 — tabel di bawah ini basi (prefix `/api/` bukan `/api/v1/`, dan `GET /api/admin/visa` tidak pernah diimplementasikan sebagai API route).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/payments/:id/confirm` | Admin | Body: `{ action: 'confirm' \| 'reject', notes }` |
| GET | `/api/admin/visa` | Admin | List all visa applications with filters |
| PUT | `/api/admin/visa/:pilgrimId/status` | Admin | Body: `{ status, notes, rejection_reason? }` |

### Admin — Notifications & Quotas

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/notifications` | Admin | Notification log with search/filter |
| POST | `/api/admin/notifications/send` | Admin | Manual WA send. Body: `{ user_id, message }` |
| GET | `/api/admin/quotas` | Admin | Availability overview: hotels, transport, muthowif for a date range |

### Super Admin — Catalog Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET/POST | `/api/admin/hotels` | Superadmin | List / create hotels |
| PUT/DELETE | `/api/admin/hotels/:id` | Superadmin | Update / deactivate hotel |
| POST | `/api/admin/hotels/:id/rooms` | Superadmin | Add room type |
| POST | `/api/admin/hotels/:id/quotas` | Superadmin | Set quota for a period |
| GET/POST | `/api/admin/transport` | Superadmin | *(basi — endpoint aktual terpisah per entitas: `/api/v1/admin/products/transport/{vehicles,trips,pricing}`, guard `requireManager()`, lihat `docs/arsitektur-transportasi.md` §3)* |
| POST | `/api/admin/transport/quotas` | Superadmin | *(basi — quota transport di-seed langsung, tidak ada endpoint alokasi terpisah per audit terakhir)* |
| GET/POST/PUT | `/api/admin/muthowif` | Superadmin | *(basi — endpoint aktual `/api/v1/admin/products/muthowif`, guard `requireManager()`, dan PUT sebenarnya tidak pernah dibuat — hanya GET/POST, lihat `docs/arsitektur-muthowif.md` §3 Gap #4)* |
| GET/POST/PUT | `/api/admin/seasons` | Superadmin | Season date definitions |
| GET | `/api/admin/reports` | Superadmin | Financial report. Query: `from`, `to`, `group_by` |

### Internal (Cron)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/internal/autocancel` | CRON_SECRET header | *(basi — endpoint ini dead stub, tidak dipanggil. Mekanisme aktual: node-cron in-process via `instrumentation.ts`, lihat `docs/arsitektur-umroh.md` §6.2)* |
| POST | `/api/internal/reminders` | CRON_SECRET header | *(basi — dead stub juga, lihat `docs/arsitektur-umroh.md` §6.3)* |

---

## Quota Concurrency

Hotel, transport, and muthowif quotas must handle concurrent bookings (e.g., 10 users completing checkout simultaneously during Ramadan season launch).

**Strategy: optimistic locking with availability re-check inside a serializable transaction.**

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;

-- Re-check quota inside the transaction
SELECT total_quota - pending_quota - booked_quota AS available
FROM hotel_quotas
WHERE id = $1
FOR UPDATE; -- row lock

-- If available >= requested rooms, proceed
UPDATE hotel_quotas
SET pending_quota = pending_quota + $rooms
WHERE id = $1;

-- ... repeat for transport and muthowif ...

INSERT INTO bookings ...;
COMMIT;
```

If a serialization failure occurs (concurrent write detected), the API returns HTTP 409 and the client re-submits (quota may now be insufficient, in which case the user is shown an "unavailable" error).

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/saudinesia

# Redis
REDIS_URL=redis://localhost:6379

# MinIO (self-hosted)
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=saudinesia-docs

# Auth
JWT_SECRET=...                        # 64-char random hex
CRON_SECRET=...                       # Header value for internal cron routes

# WhatsApp gateway (go-whatsapp-web-multidevice)
WA_GATEWAY_URL=https://wa.yourdomain.com  # GOWA instance hosted on Sumopod (external service)
WA_GATEWAY_TOKEN=...

# Email (Resend)
RESEND_API_KEY=...
RESEND_FROM=noreply@saudinesia.com

# App
NEXT_PUBLIC_APP_URL=https://saudinesia.com
NODE_ENV=production
```

---

## Deployment

```
Hostinger VPS (main)                    Sumopod (external service)
────────────────────────────────        ──────────────────────────
Docker Compose                          GOWA (go-whatsapp-web-multidevice)
├── next-app   (port 3001, Bun)    ───► HTTP calls to GOWA API for OTP
├── postgres   (port 5432)              and notification sends
├── redis      (port 6379)
└── minio      (port 9000 / 9001)
                 │
Nginx (reverse proxy)
├── saudinesia.com → next-app:3001
└── TLS via Let's Encrypt (certbot)
```

Cron jobs run as a `node-cron` scheduler inside the Next.js app, calling the internal `/api/internal/*` routes. No external cron service needed.
