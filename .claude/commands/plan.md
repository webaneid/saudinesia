Read docs/progress.md and identify the next unchecked milestone — the first section that still has at least one `[ ]` item.

Then produce an actionable implementation plan for that milestone only. Do not plan ahead to future milestones.

---

## Step 1 — Identify the milestone

Read docs/progress.md. Find the first section (M1, M2, …) that contains one or more unchecked `[ ]` items. State:
- Milestone ID and title
- Which items are already checked [x]
- Which items remain [ ]

## Step 2 — Break it into tasks

For each unchecked item, produce a concrete task with:
- **Task**: one-line description of what to build
- **Files to create or edit**: list exact paths (e.g. `app/api/v1/auth/otp/request/route.ts`, `lib/auth/otp.ts`)
- **Key logic**: 2–3 bullet points of what the implementation must do (no code yet)
- **Depends on**: any other task in this list that must be done first

Order the tasks so they can be worked top-to-bottom with minimal blockers.

## Step 3 — Flag risks

List any decisions or edge cases that need clarification before coding starts. Reference the relevant section of docs/spec.md or docs/architecture.md if applicable.

## Step 4 — Estimate

Give a rough task count:
- Tasks that can be completed in < 30 min each
- Tasks that require > 30 min (complex logic or many files)

Keep the plan focused. Do not generate any code yet.
