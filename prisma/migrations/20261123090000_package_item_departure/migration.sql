-- K1 F3 (docs/arsitektur-paket-umroh.md §8.5): item Paket Umroh di masukan pesan memakai `departureId` (keberangkatan), bukan `departureDate` bebas.
-- Draf tersimpan (`bookings.draft`, JSON masukan pesan) berbentuk lama tak lagi lolos validasi dan tak bisa diterbitkan — migrasi BERHENTI (fail-closed)
-- bila masih ada draf berisi item paket, alih-alih membiarkannya rusak diam-diam. Tidak ada perubahan skema.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM "bookings" b, jsonb_array_elements(COALESCE(b."draft"->'items', '[]'::jsonb)) AS e
  WHERE b."draft" IS NOT NULL AND e->>'itemType' = 'package' AND NOT (e ? 'departureId');
  IF n > 0 THEN
    RAISE EXCEPTION 'K1: % item paket di draf booking belum punya keberangkatan — hapus/terbitkan draf itu dulu', n;
  END IF;
END $$;
