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

- **No unauthorized legal advice.** Jurisdictional outputs require a
  disclaimer and a cited authority.
- **Privilege boundary.** References must resolve to the current
  `project_id` only.
- **PII egress.** No SSNs, account numbers, or DOBs in output.
- **Citation integrity.** Every cited case or statute must exist in the
  project's corpus.
- **Escalation scope.** Securities, healthcare, M&A questions must flag
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
├── demo/index.html                       standalone single-file UI demo
├── docs/mikeoss-legal-ai.md              long-form integration write-up
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

Shadow mode is the recommended starting point. Collect a few days of
real verdicts before flipping the switch.

## Demo

### Standalone UI demo (no setup)

Open [`demo/index.html`](./demo/index.html) in any browser. Single file,
no build step, no backend. Auto-plays end-to-end in about two minutes
and loops.

What it shows, in order:

1. **Policy preamble.** The plain-English policy in force, with its
   `policy_id` (UUID) and the rules it compiles to: matter scope,
   citation integrity, no specific advice, no PII.
2. **Matter context.** Chat header shows `Smith v. Acme · Project · 247
   docs · matter scope enforced`, so every action is bound to a project.
3. **SAT path.** Assistant answers a clause-summary question. The
   action label (`summarizeClause(matter=…, input=…)`) is shown above
   the response, the green "Verified" pill links to the proof receipt,
   and a modal opens with the `check_id`, policy UUID, latency, and the
   exact `POST /v1/verifyPaid` payload.
4. **UNSAT path.** A "what should I do" question. The page renders
   what the model *would have* returned (struck through, stamped
   `Blocked · UNSAT` with the reason), followed by the safe response
   the user actually sees. Both stored on the same `chat_messages` row.
5. **Auditor replay.** A separate browser scene six months later: the
   `check_id` is pasted into `icme.io/proofs/<uuid>` and re-verifies
   independently, with no Mike access and no model access.

All annotation text appears in a dedicated **Narration** panel in the
left sidebar; the main chat area is never covered. Highlight rings
point to whatever element each callout is about.

Press **space** at any time to pause/resume.

### Working reference implementation

A patch-applied Mike checkout lives at
[hshadab/mikeoss](https://github.com/hshadab/mikeoss) on the
`feat/icme-preflight-verification` branch.

## License

MIT. See [`LICENSE`](./LICENSE).

Mike itself is AGPL-3.0; this integration is a separate work that calls
Mike's existing extension points (`requireAuth`-style middleware chain and
`chat_messages` columns), so it can ship under a permissive license.

## Privacy and privilege

The compiled policy itself is work product. Preflight keeps it on the ICME
side; only a `policy_hash` is exposed in the public proof receipt. A regulator
who pulls a proof six months later sees that policy version `9a7b1c…` was in
force and that the verdict was `ALLOWED` or `BLOCKED`. They do not see the
rules, the prompt, the response, or the matter.

Honest scope: this integration provides verifiable enforcement of a stated
policy, not cryptographic privacy of inference itself. Prompts and responses
are visible to Mike and to whichever model vendor your firm has configured.
See [`docs/mikeoss-legal-ai.md`](./docs/mikeoss-legal-ai.md) for the full
breakdown.

## Credits

- [Will Chen](https://github.com/willchen96) for building Mike as OSS.
- The team at [docs.icme.io](https://docs.icme.io) for Preflight.
