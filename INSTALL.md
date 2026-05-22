# INSTALL — wiring preflight-mike into a Mike checkout

If you used `git am < mike.patch` you're done — skip to **Step 4 (env)**
and **Step 5 (DB)**. This file documents the manual wiring for reviewers
who want to see every edit explicitly.

## Step 1 — drop in the new files

| From                                   | To                                                              |
|----------------------------------------|------------------------------------------------------------------|
| `backend/lib/preflight.ts`             | `backend/src/lib/preflight.ts`                                  |
| `backend/middleware/preflight.ts`      | `backend/src/middleware/preflight.ts`                           |
| `backend/migrations/2026_01_*.sql`     | `backend/migrations/2026_01_preflight.sql`                      |
| `frontend/components/VerifiedBadge.tsx`| `frontend/src/app/components/assistant/VerifiedBadge.tsx`       |

## Step 2 — wire the backend

### `backend/src/routes/chat.ts`

Add the import:

```ts
import { preflightVerify } from "../middleware/preflight";
```

Mount the middleware on `POST /chat` (around line 423):

```ts
// Before
chatRouter.post("/", requireAuth, async (req, res) => { ... });

// After
chatRouter.post("/", requireAuth, preflightVerify, async (req, res) => { ... });
```

Persist the check on the assistant insert (around line 583):

```ts
const preflightCheck = res.locals.preflightCheck as
    | { check_id: string; verdict: string; policy_id: string; policy_version?: string }
    | undefined;

await db.from("chat_messages").insert({
    chat_id: chatId,
    role: "assistant",
    content: events.length ? events : null,
    annotations: annotations.length ? annotations : null,
    preflight_check_id: preflightCheck?.check_id ?? null,
    preflight_verdict: preflightCheck?.verdict ?? null,
    preflight_policy_id: preflightCheck?.policy_id ?? null,
    preflight_policy_version: preflightCheck?.policy_version ?? null,
});
```

## Step 3 — wire the frontend

### `frontend/src/app/components/shared/types.ts`

```ts
export interface MikePreflightInfo {
  check_id: string | null;
  verdict: "SAT" | "UNSAT" | "ERROR" | null;
  policy_id?: string | null;
  policy_version?: string | null;
}

// add to MikeMessage:
preflight?: MikePreflightInfo;
```

### `frontend/src/app/lib/mikeApi.ts`

Add to the `ServerMessage` interface:

```ts
preflight_check_id?: string | null;
preflight_verdict?: "SAT" | "UNSAT" | "ERROR" | null;
preflight_policy_id?: string | null;
preflight_policy_version?: string | null;
```

In `getChat`'s assistant branch, after `events`:

```ts
preflight: m.preflight_check_id
    ? {
          check_id: m.preflight_check_id,
          verdict: m.preflight_verdict ?? null,
          policy_id: m.preflight_policy_id ?? null,
          policy_version: m.preflight_policy_version ?? null,
      }
    : undefined,
```

### `frontend/src/app/components/assistant/AssistantMessage.tsx`

Add imports:

```ts
import type { MikePreflightInfo } from "../shared/types";
import { VerifiedBadge } from "./VerifiedBadge";
```

Add to `Props`:

```ts
preflight?: MikePreflightInfo;
```

Destructure it from the function signature, then in the JSX wrap
`ResponseStatus`:

```tsx
<div className="flex items-center gap-2">
    <ResponseStatus status={status} />
    {preflight ? <VerifiedBadge info={preflight} /> : null}
</div>
```

### `frontend/src/app/components/assistant/ChatView.tsx`

In the `<AssistantMessage ... />` call, add:

```tsx
preflight={(msg as any).preflight}
```

## Step 4 — environment

Append to `backend/.env`:

```
ICME_API_KEY=...
ICME_POLICY_ID=<uuid from the ICME dashboard>
ICME_PREFLIGHT_ENFORCE=shadow
# ICME_API_BASE_URL=https://api.icme.io/v1
```

Sign up for an API key and create a policy at https://docs.icme.io.

## Step 5 — database migration

Run in the Supabase SQL editor (or paste into `schema.sql`):

```sql
alter table public.chat_messages
  add column if not exists preflight_check_id text,
  add column if not exists preflight_verdict  text,
  add column if not exists preflight_policy_id text,
  add column if not exists preflight_policy_version text;

create index if not exists idx_chat_messages_preflight_check
  on public.chat_messages(preflight_check_id);
```

## Step 6 — flip to enforce (when ready)

Run in shadow mode for a few days and inspect verdicts:

```sql
select preflight_verdict, count(*)
from public.chat_messages
where role = 'assistant'
group by 1;
```

When the UNSAT rate looks correct for your policy, set:

```
ICME_PREFLIGHT_ENFORCE=enforce
```

Blocked requests will return HTTP 451 with the `check_id` so users (or
support staff) can look up the proof.

## Step 7 — replace the stub `verifyWithPreflight`

`backend/src/lib/preflight.ts` ships a stub that fakes `SAT` so the wiring
can be tested without an ICME account. Replace the marked block with the
real fetch call (commented out in-file) once you have credentials.

## Verifying a proof from anywhere

```bash
curl https://api.icme.io/v1/proofs/<check_id>
```

The response is self-contained and signed — no Mike access required.
