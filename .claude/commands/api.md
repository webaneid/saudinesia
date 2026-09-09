Generate a complete, production-ready Next.js 15 Route Handler for the Saudinesia API.

Endpoint description: $ARGUMENTS

---

Follow the Saudinesia conventions from CLAUDE.md exactly. Produce the full file content — no placeholders, no TODOs unless the business logic genuinely requires a future step.

## Requirements

**File location**: derive the correct path under `app/api/v1/` from the endpoint description.

**Every handler must include:**

1. **Zod schema** — defined at the top of the file for all inputs (query params, body, path params). Use schemas from `lib/validators/` if they already exist; extend or create new ones as needed.

2. **Auth check** — call the appropriate helper from `lib/auth/session.ts` at the very top of the handler body:
   - Public: no check
   - Pilgrim: `requireSession()`
   - Admin: `requireAdmin()`
   - Super Admin: `requireSuperAdmin()`
   - Internal cron: check `request.headers.get('x-cron-secret') === process.env.CRON_SECRET`

3. **Input parsing** — parse and validate with Zod before any DB call. On failure: return `NextResponse.json(err('...'), { status: 400 })` with field-level details.

4. **Business logic** — implement the actual Prisma queries, quota operations, or MinIO calls as described. Quota writes inside `prisma.$transaction()`. No `$queryRaw` unless ORM cannot express it (add a comment why).

5. **Response shape** — always use `ok()` / `err()` from `lib/validators/`:
   ```ts
   return NextResponse.json(ok(data))          // 200
   return NextResponse.json(ok(data), { status: 201 })  // 201 Created
   return NextResponse.json(err('Not found'), { status: 404 })
   ```

6. **try/catch** — wrap the entire handler body. In the catch block:
   - Log the error server-side: `console.error('[route] description:', error)`
   - Never return internal error details, Prisma messages, or stack traces to the client
   - Return: `NextResponse.json(err('Internal server error'), { status: 500 })`

7. **HTTP method exports** — only export the methods that the endpoint actually needs (GET, POST, PUT, DELETE, PATCH).

## Output format

Produce:
1. The complete route file with all imports
2. Any new Zod schemas that should be added to `lib/validators/` (as a separate block)
3. A one-line description of what to add to docs/progress.md once this is implemented
