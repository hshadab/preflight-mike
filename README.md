# preflight-mike

> Drop-in [ICME Preflight](https://docs.icme.io) integration for
> [Mike](https://github.com/willchen96/mike), the open-source legal AI
> assistant by [@willchen96](https://github.com/willchen96).

Every assistant message gets cryptographically verified against a
plain-English policy compiled to SMT-LIB. The proof receipt (`check_id`)
is stored alongside the message and surfaced in the UI as a clickable
"Verified" badge that anyone can independently re-verify.

```
user query
   │
   ▼
[ Preflight middleware ] ──▶ verify(action, policy) ──▶ SAT / UNSAT / ERROR
   │                                                         │
   ▼                                                         ▼
LLM call                                          check_id persisted on
   │                                              chat_messages row
   ▼
assistant response  ──▶  UI badge linking to icme.io/proof/<check_id>
```

## Why this exists

Legal AI is the canonical "high downside, low margin for error" use case.
LLM-judge guardrails are probabilistic and jailbreakable. Preflight turns
each policy into a formally verifiable rule whose enforcement produces a
proof that a regulator, opposing counsel, or auditor can re-check months
later without access to your infrastructure.

Suggested policies for a legal AI deployment:

- **No unauthorized legal advice** — jurisdictional outputs require a
  disclaimer and a cited authority.
- **Privilege boundary** — references must resolve to the current
  `project_id` only.
- **PII egress** — no SSNs, account numbers, or DOBs in output.
- **Citation integrity** — every cited case or statute must exist in the
  project's corpus.
- **Escalation scope** — securities, healthcare, M&A questions must flag
  for human review.

## What this repo contains

```
preflight-mike/
├── backend/
│   ├── lib/preflight.ts                  ICME Preflight HTTP client
│   ├── middleware/preflight.ts           Express middleware (off|shadow|enforce)
│   └── migrations/2026_01_preflight.sql  adds proof columns to chat_messages
├── frontend/
│   └── components/VerifiedBadge.tsx      "Verified" pill linking to proof URL
├── mike.patch                            one-shot git-am patch against Mike main
├── INSTALL.md                            step-by-step wiring guide
└── README.md
```

## Install

Two options:

### One-shot patch (fastest)

```bash
cd path/to/your/mike/checkout
git checkout -b feat/preflight
git am < /path/to/preflight-mike/mike.patch
```

The patch applies cleanly against Mike `main` (as of May 2026) and wires
the middleware, DB columns, types, mikeApi mapping, and the badge into
`AssistantMessage` in two commits.

### Manual drop-in

Copy the four files into your Mike checkout at these paths:

| From                                   | To                                                              |
|----------------------------------------|------------------------------------------------------------------|
| `backend/lib/preflight.ts`             | `backend/src/lib/preflight.ts`                                  |
| `backend/middleware/preflight.ts`      | `backend/src/middleware/preflight.ts`                           |
| `backend/migrations/2026_01_*.sql`     | `backend/migrations/2026_01_preflight.sql`                      |
| `frontend/components/VerifiedBadge.tsx`| `frontend/src/app/components/assistant/VerifiedBadge.tsx`       |

Then follow [`INSTALL.md`](./INSTALL.md) for the wiring edits (4 small
hunks across `chat.ts`, `mikeApi.ts`, `types.ts`, `AssistantMessage.tsx`,
`ChatView.tsx`).

## Modes

`ICME_PREFLIGHT_ENFORCE` controls behaviour:

| Mode      | What it does                                                          |
|-----------|------------------------------------------------------------------------|
| `off`     | Middleware no-ops. Use to disable without removing code.              |
| `shadow`  | Calls Preflight, persists verdict + proof, but **never blocks**. Default. |
| `enforce` | Returns HTTP 451 on `UNSAT` or verification error. Use in production. |

Shadow mode is the recommended starting point — collect a few days of
real verdicts before flipping the switch.

## Demo

A working reference implementation lives at
[hshadab/mikeoss](https://github.com/hshadab/mikeoss) on the
`feat/icme-preflight-verification` branch.

## License

MIT. See [`LICENSE`](./LICENSE).

Mike itself is AGPL-3.0; this integration is a separate work that calls
Mike's existing extension points (`requireAuth`-style middleware chain and
`chat_messages` columns), so it can ship under a permissive license.

## Credits

- [Will Chen](https://github.com/willchen96) for building Mike as OSS.
- The team at [docs.icme.io](https://docs.icme.io) for Preflight.
