-- Konten Situs (docs/arsitektur-frontend-publik.md §6.5 C2): satu baris per halaman publik, isi suntingan admin di `content`.
-- Kosong = teks bawaan berkas pesan. Ditulis HANYA oleh lib/public-content/service.ts.

-- CreateTable
CREATE TABLE "public_page_contents" (
    "id" TEXT NOT NULL,
    "pageKey" VARCHAR(40) NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, -- tz-ok
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "public_page_contents_pkey" PRIMARY KEY ("id"),
    -- Bentuk dasar dijaga DB juga; isi rinci divalidasi Zod di layanan.
    CONSTRAINT "public_page_contents_content_object" CHECK (jsonb_typeof("content") = 'object'),
    CONSTRAINT "public_page_contents_page_key_format" CHECK ("pageKey" ~ '^[a-z][a-z0-9_]*$')
);

-- CreateIndex
CREATE UNIQUE INDEX "public_page_contents_pageKey_key" ON "public_page_contents"("pageKey");
