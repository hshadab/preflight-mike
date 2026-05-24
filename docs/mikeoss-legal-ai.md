# MikeOSS Legal AI + ICME Preflight

Cryptographically verifiable guardrails for an open-source legal AI assistant.

> **Status.** Community integration. ICME maintains the Preflight verification service; the
> integration code lives at [hshadab/preflight-mike](https://github.com/hshadab/preflight-mike)
> under MIT. Mike is built and maintained by [@willchen96](https://github.com/willchen96)
> under AGPL-3.0.

## The verification gap in legal AI

Legal AI is the canonical "high downside, low margin for error" use case. A
wrong answer can mean malpractice exposure, a privilege waiver, or a sanction.
LLM-judge guardrails ("ask another model whether this output is safe") are
probabilistic, jailbreakable, and leave no auditable trace. They were not
designed for the bar's standard of care.

Two distinct properties have to hold for an AI guardrail to be defensible in a
regulated practice.

**Enforcement has to be deterministic.** A policy that sometimes blocks
unauthorized advice and sometimes does not is worse than no policy at all,
because it creates a paper trail of inconsistent enforcement. Determinism is
what makes a guardrail jailbreak-resistant: the rule is a logical formula
checked by a solver, not a heuristic evaluated by a model. The same input plus
the same policy always produces the same verdict, regardless of how the prompt
is phrased.

**The verdict has to be independently checkable.** Determinism inside the firm
is necessary but not sufficient. The downstream verifier (the regulator, the
opposing party, the malpractice carrier, the client) was not present when the
verdict was issued and has no access to the firm's stack. The proof has to
travel without the system that produced it.

Preflight is built around both properties. Policies compile to SMT-LIB and are
checked by a solver, so enforcement is deterministic and resistant to prompt
manipulation. Each verdict produces a self-contained `check_id` that any third
party can re-verify at `icme.io/proofs/<check_id>` months later, with no firm
access required.

Deterministic enforcement makes the guardrail trustworthy. Third-party
verifiability makes that trust transferable.

## How Preflight closes it

```
user query
   │
   ▼
[ Preflight middleware ]  POST /v1/verifyPaid  ──▶  ALLOWED / BLOCKED / ERROR
   │                                                       │
   ▼                                                       ▼
LLM call                                       check_id (UUID) persisted on
   │                                           chat_messages row
   ▼
assistant response  ──▶  UI badge linking to icme.io/proofs/<check_id>
```

Three stages.

1. **Policy.** Plain English compiles to SMT-LIB on the ICME side. Each policy
   gets a UUID and a `policy_hash` that pins the exact compiled rules.
2. **Verification.** Mike's `POST /chat` is wrapped in an Express middleware
   that calls `POST /v1/verifyPaid` with the action label and inputs. The
   verdict is `ALLOWED`, `BLOCKED`, or `ERROR`. A `check_id` UUID is returned.
3. **Persistence.** The `check_id` (plus verdict and policy ID) is written to
   the `chat_messages` row alongside the assistant message. The frontend
   renders a "Verified" pill that deep-links to the public proof page.

## What this integration ships

```
preflight-mike/
├── backend/
│   ├── lib/preflight.ts                  ICME Preflight HTTP client
│   ├── middleware/preflight.ts           Express middleware (off|shadow|enforce)
│   └── migrations/2026_01_preflight.sql  adds proof columns to chat_messages
├── frontend/
│   └── components/VerifiedBadge.tsx      "Verified" pill linking to proof URL
├── demo/index.html                       standalone single-file UI demo
├── mike.patch                            one-shot git-am patch against Mike main
├── INSTALL.md                            step-by-step wiring guide
└── README.md
```

## Suggested policies for a legal AI deployment

| Policy | What it enforces |
|---|---|
| No unauthorized legal advice | Jurisdictional outputs require a disclaimer and a cited authority |
| Privilege boundary | References must resolve to the current `project_id` only |
| PII egress | No SSNs, account numbers, or DOBs in output |
| Citation integrity | Every cited case or statute must exist in the project's corpus |
| Escalation scope | Securities, healthcare, M&A questions must flag for human review |

## Install

### One-shot patch (fastest)

```bash
cd path/to/your/mike/checkout
git checkout -b feat/preflight
git am < /path/to/preflight-mike/mike.patch
```

The patch applies cleanly against Mike `main` (as of May 2026) and wires the
middleware, DB columns, types, mikeApi mapping, and the badge into
`AssistantMessage` in two commits.

### Manual drop-in

Copy the four source files into your Mike checkout, then follow
[`INSTALL.md`](https://github.com/hshadab/preflight-mike/blob/main/INSTALL.md)
for the wiring edits (4 small hunks across `chat.ts`, `mikeApi.ts`,
`types.ts`, `AssistantMessage.tsx`, `ChatView.tsx`).

## Modes

`ICME_PREFLIGHT_ENFORCE` controls behavior:

| Mode | What it does |
|---|---|
| `off` | Middleware no-ops. Use to disable without removing code. |
| `shadow` | Calls Preflight, persists verdict + proof, but never blocks. Default. |
| `enforce` | Returns HTTP 451 on `BLOCKED` or verification error. Use in production. |

Shadow mode is the recommended starting point. Collect a few days of real
verdicts before flipping the switch.

## The Express middleware

```ts
import type { RequestHandler } from "express";
import { verifyWithPreflight } from "../lib/preflight";

const MODE = (process.env.ICME_PREFLIGHT_ENFORCE ?? "shadow") as
  | "off"
  | "shadow"
  | "enforce";

export const preflightVerify: RequestHandler = async (req, res, next) => {
  if (MODE === "off") return next();

  const action = {
    name: "chat.message",
    project_id: req.body?.projectId ?? null,
    user_id: (req as any).user?.id ?? null,
    input: req.body?.message ?? "",
  };

  try {
    const result = await verifyWithPreflight({
      action,
      policy_id: process.env.ICME_POLICY_ID!,
    });

    res.locals.preflightCheck = result;

    if (MODE === "enforce" && result.verdict === "BLOCKED") {
      return res.status(451).json({
        error: "blocked_by_policy",
        check_id: result.check_id,
        proof_url: `https://icme.io/proofs/${result.check_id}`,
      });
    }

    return next();
  } catch (err) {
    if (MODE === "enforce") {
      return res.status(451).json({ error: "preflight_unavailable" });
    }
    return next();
  }
};
```

## Database migration

```sql
alter table public.chat_messages
  add column if not exists preflight_check_id text,
  add column if not exists preflight_verdict  text,
  add column if not exists preflight_policy_id text,
  add column if not exists preflight_policy_version text;

create index if not exists idx_chat_messages_preflight_check
  on public.chat_messages(preflight_check_id);
```

## API reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/verifyPaid` | POST | Submit an action + policy_id, get back a verdict and check_id |
| `/v1/proofs/{check_id}` | GET | Public proof receipt, no auth, signed |

Sample verifyPaid response:

```json
{
  "check_id": "8b1f4d20-3c2a-4e9b-9d6f-2b7e5c4a1f80",
  "verdict": "ALLOWED",
  "policy_id": "0f9c1f8a-4e2d-4b6a-9a7b-1c8d0e5f3a90",
  "policy_hash": "sha256:9a7b1c8d0e5f3a90...",
  "latency_ms": 84,
  "issued_at": "2026-05-23T17:42:00Z"
}
```

## The "Verified" badge

```tsx
import type { MikePreflightInfo } from "../shared/types";

export function VerifiedBadge({ info }: { info: MikePreflightInfo }) {
  if (!info.check_id) return null;
  const url = `https://icme.io/proofs/${info.check_id}`;

  const tone =
    info.verdict === "ALLOWED" ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : info.verdict === "BLOCKED" ? "text-rose-700  bg-rose-50  border-rose-200"
    : "text-neutral-600 bg-neutral-50 border-neutral-200";

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`text-xs px-2 py-0.5 rounded border ${tone}`}
      title={`Preflight check ${info.check_id}`}
    >
      {info.verdict === "ALLOWED" ? "Verified" : info.verdict === "BLOCKED" ? "Blocked" : "Unverified"}
    </a>
  );
}
```

## What this integration does not do

To keep the trust boundary clear:

- It does not change Mike's LLM provider routing. Mike still calls Anthropic,
  Google, or OpenAI through your existing keys.
- It does not store prompt text on ICME servers beyond the lifetime of the
  verification call.
- It does not replace Mike's existing auth, RBAC, or row-level security.
- It does not generate legal advice. The compiled policy is a constraint
  language, not an opinion engine.
- It does not retroactively verify past messages. Only assistant turns sent
  through the middleware get a `check_id`.

## Privacy, privilege, and what the verifier sees

Legal AI guardrails create a privacy problem of their own: the rules are
themselves sensitive. A conflicts watchlist, a jurisdictional disclaimer
matrix, a list of escalation triggers, all are work product. The verifier's
proof can't expose them, and the integration's audit trail can't either.

Preflight handles this with a clean split.

| What is held | Where it lives | What the public proof exposes |
|---|---|---|
| The compiled policy (SMT-LIB) | ICME's side, behind your `policy_id` | A `policy_hash` only |
| The action label and inputs | Submitted to `/v1/verifyPaid` | A commitment, not the raw text |
| The verdict (ALLOWED/BLOCKED/ERROR) | Returned to your middleware, stored on `chat_messages` | The verdict itself |
| The `check_id` (UUID) | Persisted on the assistant message row | The receipt anyone can re-verify |
| The user's prompt and the model's response | Your stack only (Mike + your model vendor) | Never seen by ICME or the proof |

Three properties follow.

1. **The policy stays private.** A regulator who pulls a proof six months
   later sees that policy version `9a7b1c…` was in force and that the action
   was `ALLOWED`. They do not see which rules the policy compiles to.
2. **The proof is portable without privilege waiver.** Sharing a `check_id`
   with opposing counsel demonstrates that a guardrail fired, without
   disclosing the prompt, the response, the matter, or the policy's contents.
3. **`policy_hash` pins the rules.** If the firm updates its policy on
   May 1, every check issued before that date references the old hash. There
   is no way to retroactively change what was enforced.

### Honest scope

This integration does not provide cryptographic privacy of inference itself.
The prompt and the model's response are visible to Mike and to whichever
model vendor your firm has configured. What it provides is verifiable
enforcement of a stated policy, plus a privacy-preserving way for downstream
parties to confirm that enforcement happened.

For firms that also need confidential inference, that is a separate layer
(private models, on-prem deployment, or a confidential-compute provider) and
out of scope for this integration.

## Compliance alignment

| Standard | How verifiable proofs help |
|---|---|
| ABA Model Rule 1.1 cmt 8 (technological competence) | A `check_id` is concrete evidence that a competence-supporting control fired on every assistant turn |
| ABA Model Rule 5.3 (supervision of nonlawyer assistants) | The middleware is a supervised, deterministic gate; verdicts are auditable per matter |
| ABA Formal Opinion 512 (generative AI) | Addresses the opinion's call for "reasonable assurances" through formal verification + public proof |
| Privilege & work product | `policy_hash` lets you prove which version of your guardrail was in force without disclosing the rules themselves |
| State bar AI guidance (CA, FL, NY) | Per-action `check_id` UUIDs satisfy emerging "verifiable controls" expectations without revealing prompts or matters |
| Client engagement letters | Lets firms commit in writing to a specific, verifiable policy regime that the client can audit on their own |

## Try it yourself

| Resource | Where |
|---|---|
| Integration repo | [github.com/hshadab/preflight-mike](https://github.com/hshadab/preflight-mike) |
| Standalone UI demo | [`demo/index.html`](https://github.com/hshadab/preflight-mike/blob/main/demo/index.html) (single file, no setup) |
| Patch-applied Mike checkout | [hshadab/mikeoss `feat/icme-preflight-verification`](https://github.com/hshadab/mikeoss/tree/feat/icme-preflight-verification) |
| Mike upstream | [github.com/willchen96/mike](https://github.com/willchen96/mike) |
| Get an API key | [docs.icme.io](https://docs.icme.io) |

## Credits

- [Will Chen](https://github.com/willchen96) for building Mike as OSS.
- The team at [docs.icme.io](https://docs.icme.io) for Preflight.
