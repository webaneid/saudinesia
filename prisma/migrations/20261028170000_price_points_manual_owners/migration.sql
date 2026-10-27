-- Fase 3 harga terpadu (docs/arsitektur-harga-terpadu.md §16): Katering dan Layanan Hotel menjadi pemilik titik harga "manual-only". Harga jual yang sudah diisi admin di
-- kolom lama disalin sebagai HARGA MANUAL (modal NULL = belum diisi). Idempoten (ON CONFLICT DO NOTHING). Katering: tiga varian musim bila harga > 0; layanan: satu varian.

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "manualSellIdr", "sellIdr", "manualNote", "manualAt", "updatedAt")
SELECT gen_random_uuid()::text, 'catering', c."id", v.vk, 'person_day', v.price, v.price, 'Harga awal dari kolom lama (Fase 3 harga terpadu)', now(), now()
FROM "catering_options" c
CROSS JOIN LATERAL (VALUES ('season:regular', c."pricePerPersonRegular"), ('season:ramadan', c."pricePerPersonRamadan"), ('season:hajj', c."pricePerPersonHajj")) AS v(vk, price)
WHERE v.price > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;

INSERT INTO "price_points" ("id", "ownerType", "ownerId", "variantKey", "unit", "manualSellIdr", "sellIdr", "manualNote", "manualAt", "updatedAt")
SELECT gen_random_uuid()::text, 'hotel_service', s."id", '', 'service', s."price", s."price", 'Harga awal dari kolom lama (Fase 3 harga terpadu)', now(), now()
FROM "hotel_services" s WHERE s."price" > 0
ON CONFLICT ("ownerType", "ownerId", "variantKey") DO NOTHING;
