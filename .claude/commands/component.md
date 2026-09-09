Generate a complete, reusable React component for the Saudinesia frontend.

Component description: $ARGUMENTS

---

Follow the Saudinesia conventions from CLAUDE.md exactly. Produce the full file content — ready to drop in and use.

## Requirements

**File location**: determine the correct folder from the description:
- `components/booking/` — wizard steps, booking flow UI
- `components/admin/` — ops or superadmin panels
- `components/shared/` — layout, navigation, general-purpose
- `components/ui/` — base primitive (shadcn/ui extension)

**Every component must include:**

1. **Props interface** — TypeScript interface named `{ComponentName}Props` defined above the component. All props explicitly typed. No `any`. Optional props marked with `?`.

2. **Server vs. Client** — default to a Server Component (no directive). Add `"use client"` at the top only if the component requires:
   - Event handlers (`onClick`, `onChange`, etc.)
   - React hooks (`useState`, `useEffect`, `useRef`, etc.)
   - Browser APIs
   - Tiptap editor
   
   If `"use client"` is added, state the reason in a one-line comment directly above the directive.

3. **Styling** — Tailwind utility classes only:
   - No `style={{}}` — not even for dynamic values (use `cn()` with conditional classes instead)
   - No CSS Modules
   - No arbitrary values (`w-[743px]`) unless there is genuinely no Tailwind scale equivalent
   - Use `cn()` from `lib/utils` (clsx + tailwind-merge) for conditional or composed classes

4. **Icons** — Lucide React only. No emojis. No other icon libraries. Import individually:
   ```ts
   import { ChevronRight, AlertCircle } from 'lucide-react'
   ```

5. **Prop drilling limit** — if the component needs data more than 2 levels deep, use React Context or note that a store is required (do not pass props through intermediate components just to satisfy the requirement).

6. **shadcn/ui** — use shadcn/ui primitives (`Button`, `Card`, `Input`, `Badge`, etc.) as the base. Extend via `className` prop. Never copy-paste or reimplement their internals.

7. **Loading and error states** — if the component fetches data or can fail, include a loading skeleton (Tailwind animate-pulse) and an error state. Use Lucide icons for error indicators, not emoji.

8. **Export** — named export only (no default export for components). The export name must match the filename exactly.

## Output format

Produce:
1. The complete component file with all imports
2. A short usage example (JSX snippet, not a full page) showing the component in context
3. If `"use client"` was added, a one-sentence justification
4. Any sibling files needed (e.g. a custom hook in the same directory)

## cn() helper

If not already present, `lib/utils.ts` should contain:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```
