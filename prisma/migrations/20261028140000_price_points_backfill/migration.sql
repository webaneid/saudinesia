-- Fase 2 harga terpadu (docs/arsitektur-harga-terpadu.md §15): titik harga untuk SEMUA baris yang sudah berharga di kolom cache lama, supaya pembaca yang
-- pindah ke `price_points` aman SEGERA setelah `migrate deploy`. Hanya jual (modal NULL = "belum lengkap"); `repriceAll()` saat boot server mengisi modal dan
-- memperbaiki cache yang basi. Idempoten (ON CONFLICT DO NOTHING — titik yang sudah ditulis mesin tak pernah ditimpa). Aturan sama dengan mesin:
-- modul dasar hanya bila harga > 0; komposit (Haji, paket) SELALU, termasuk 0; Visa dari rentang tier `durationFeeRules`.

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'flight', "id", '', 'person', "price", "price", now() FROM "flight_schedules" WHERE "price" > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'hotel', "id", '', 'room_night', "price", "price", now() FROM "hotel_room_schedules" WHERE "price" > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'transport', "id", '', 'vehicle', "price", "price", now() FROM "transport_pricing" WHERE "price" > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'muthowif', "id", '', 'person_day', "price", "price", now() FROM "muthowif_service_price" WHERE "price" > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'haji', "id", '', 'package', "price", "price", now() FROM "haji_products"
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'package', "id", '', 'package', "price", "price", now() FROM "packages"
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'tour_package', "id", '', 'package', "price", "price", now() FROM "tour_packages"
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "autoSellIdr", "sellIdr", "updatedAt")
SELECT gen_random_uuid()::text, 'visa', v."id", 'days:' || (r.rule ->> 'minDays') || '-' || (r.rule ->> 'maxDays'), 'person',
       (r.rule ->> 'fee')::numeric, (r.rule ->> 'fee')::numeric, now()
FROM "visa_products" v
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v."durationFeeRules") = 'array' THEN v."durationFeeRules" ELSE '[]'::jsonb END) AS r(rule)
WHERE (r.rule ->> 'fee')::numeric > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;
