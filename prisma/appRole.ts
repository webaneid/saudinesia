// Peran database aplikasi (docs/rencana-audit-golive.md §5, SEC-303). Proses web TIDAK BOLEH memakai peran pemilik skema/superuser:
// pemilik bisa mematikan trigger append-only/beku (buku kas, snapshot harga, jejak) dan superuser bisa `COPY … TO PROGRAM`.
// Peran pemilik (`POSTGRES_USER`, dipakai HANYA kontainer `migrate`) membuat/memperbarui peran aplikasi: LOGIN, bukan superuser,
// bukan pemilik apa pun, hanya SELECT/INSERT/UPDATE/DELETE + sekuens. Idempoten — dijalankan sesudah SETIAP `prisma migrate deploy`.
// Modul murni (tanpa impor): dipakai `prisma/apply-app-role.ts` (image migrate) dan diuji `scripts/test-db-roles.ts`.

export const APP_ROLE = 'saudinesia_app'

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/
/** Sandi dari `scripts/buat-env-production.sh` (heksa acak). Dibatasi alfanumerik supaya aman ditempel ke SQL (ALTER ROLE tak menerima parameter). */
const PASSWORD = /^[A-Za-z0-9]{32,128}$/

/** Pernyataan SQL peran aplikasi, satu per elemen (uji menjalankannya satu per satu lewat koneksi pemilik). */
export function appRoleStatements(role: string, password: string): string[] {
  if (!IDENT.test(role)) throw new Error('nama peran aplikasi tidak sah')
  if (!PASSWORD.test(password)) throw new Error('APP_DB_PASSWORD wajib 32–128 karakter alfanumerik')
  return [
    `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} LOGIN; END IF;
END $$`,
    `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD '${password}'`,
    `DO $$ BEGIN EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO ${role}', current_database()); END $$`,
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC',
    `REVOKE CREATE ON SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
    `DO $$ BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON TABLE public._prisma_migrations FROM ${role}; END IF;
END $$`,
  ]
}

