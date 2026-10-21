-- Login Google (docs/arsitektur-auth.md §3.4): identitas Google per akun.
ALTER TABLE "users" ADD COLUMN "googleSub" TEXT;
CREATE UNIQUE INDEX "users_googleSub_key" ON "users"("googleSub");
