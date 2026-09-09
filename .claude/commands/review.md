Review the following code (or the current git diff if no argument is given) against the Saudinesia conventions defined in CLAUDE.md.

Target: $ARGUMENTS

---

Work through each checklist section below. For every violation found, quote the exact offending line and explain the fix. If a section is clean, write "OK" next to it. Do not skip sections.

## 1. TypeScript
- [ ] No `any` — use `unknown` + narrowing or proper types
- [ ] Prisma-generated types used directly — not re-declared
- [ ] API shapes defined as Zod schemas in `lib/validators/`; types inferred with `z.infer<>`
- [ ] `strict` and `noUncheckedIndexedAccess` would not be violated

## 2. Styling
- [ ] Tailwind utility classes only — no `style={{}}`, no CSS Modules
- [ ] No arbitrary values (`w-[743px]`) unless no Tailwind scale equivalent
- [ ] No magic numbers or hardcoded hex colors
- [ ] Repeated class combos extracted to `@layer components` in `globals.css`, not inlined repeatedly

## 3. Icons & UI
- [ ] Only Lucide React icons used — no other icon libraries
- [ ] Zero emojis anywhere in JSX, strings, or template literals
- [ ] shadcn/ui primitives used as the base for interactive elements

## 4. Components
- [ ] Server Component by default; `"use client"` present only when interactivity or browser API is needed
- [ ] Prop drilling stops at 2 levels — Context or Zustand used beyond that
- [ ] One component per file; filename matches exported component name (PascalCase)
- [ ] No imports crossing role boundaries (e.g. `admin/` imported inside `(pilgrim)/`)

## 5. API Route Handlers
- [ ] Every response matches `{ success: boolean, data?: T, error?: string, meta?: Record<string, unknown> }`
- [ ] HTTP status codes correct: 200 OK, 201 Created, 400 bad input, 401 unauth, 403 forbidden, 404 not found, 409 quota conflict, 422 unprocessable, 500 internal
- [ ] `requireSession()` / `requireAdmin()` / `requireSuperAdmin()` called at the top of every protected handler
- [ ] Zod schema validates all inputs before any DB call; field-level errors returned on 400
- [ ] No Prisma errors, stack traces, or internal model names returned to the client
- [ ] Admin/superadmin role check inside the handler — not relying on middleware alone

## 6. Prisma & Database
- [ ] All quota writes inside `prisma.$transaction()`
- [ ] No `$queryRaw` without a comment explaining why ORM cannot express it
- [ ] No `prisma db push` usage (migrations only)

## 7. MinIO & Storage
- [ ] No MinIO SDK calls outside `lib/storage/minio.ts`
- [ ] Object keys stored in DB — never full URLs
- [ ] Presigned URLs generated at read time, not stored

## 8. WhatsApp (GOWA)
- [ ] No direct `fetch` to GOWA outside `lib/whatsapp/client.ts`
- [ ] WA failures do not throw to the caller (best-effort)

## 9. Security
- [ ] No secrets or env vars logged or returned to client
- [ ] File uploads validated server-side (MIME type + size) regardless of client checks
- [ ] No pilgrim PII in `console.log` / application logs

## 10. General
- [ ] Package manager: only `bun add` / `bun run` — no npm or yarn references
- [ ] No `any` types introduced
- [ ] No inline comments explaining WHAT code does — only WHY if non-obvious

---

After completing all sections, write a short **Summary** listing:
- Total violations found
- The 1–3 most critical issues to fix first
