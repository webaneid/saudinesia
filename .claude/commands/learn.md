A better pattern or architectural decision has been discovered. Record it permanently.

What was learned: $ARGUMENTS

---

Follow these steps in order. Complete all three before responding.

## Step 1 — Understand the decision

Identify:
- Which section of CLAUDE.md this affects (TypeScript, API Conventions, Prisma, MinIO, etc.)
- Whether this supersedes an existing rule or adds a new one
- Whether any currently scaffolded code violates the new pattern (list files if so)

## Step 2 — Update CLAUDE.md

Edit the relevant section in CLAUDE.md:
- If it supersedes an existing bullet: replace it in-place
- If it is a new rule: append it to the correct section
- Keep the bullet concise — one line, imperative mood
- Do not add explanatory prose inside CLAUDE.md (that belongs in decisions.md)

## Step 3 — Append to docs/decisions.md

Append a new entry at the bottom of docs/decisions.md using exactly this format:

```
## YYYY-MM-DD — <short title>
**Decision:** <what was decided, one or two sentences>
**Rationale:** <why — the constraint, incident, or insight that drove this>
**Alternatives considered:** <what else was evaluated and why it was rejected>
**Affects:** <CLAUDE.md section(s) updated>
```

Use today's date. If docs/decisions.md does not exist yet, create it with this entry as the first content (no other header needed beyond the entry itself).

## Step 4 — Confirm

Report back:
- The exact line(s) changed in CLAUDE.md (show old → new)
- The full text of the new decisions.md entry
- Any existing files that now need to be updated to comply with the new pattern
