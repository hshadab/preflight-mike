/**
 * ICME Preflight client
 *
 * Thin wrapper around https://api.icme.io/v1/verifyPaid.
 * Preflight compiles a plain-English policy to SMT-LIB and returns a
 * cryptographic proof that a proposed agent action is ALLOWED or BLOCKED
 * under that policy. (The underlying Z3 solver returns SAT/UNSAT; the API
 * surfaces those as ALLOWED/BLOCKED.)
 *
 * Docs: https://docs.icme.io
 *
 * When ICME_API_KEY is set this makes a real call to /verifyPaid. When it
 * is not set the call returns an ERROR verdict (fail-open in shadow mode).
 * Set ICME_PREFLIGHT_DEMO=1 to return a synthetic ALLOWED verdict so the
 * wiring can be exercised without an ICME account.
 */

export type PreflightVerdict = "ALLOWED" | "BLOCKED" | "ERROR";

export interface PreflightCheck {
    check_id: string;
    verdict: PreflightVerdict;
    policy_id: string;
    /** sha256 of the compiled policy; pins the exact rules in force. */
    policy_hash?: string;
    policy_version?: string;
    proof_url?: string;
    reason?: string;
    /** ISO-8601 timestamp the verdict was issued. */
    issued_at?: string;
    /** Round-trip latency in ms, useful for budget alerts */
    latency_ms?: number;
}

/** Structured action submitted to Preflight for verification. */
export interface PreflightAction {
    /** Stable label for the action, e.g. "chat.message". */
    name: string;
    /** The natural-language input the action is about (the user turn). */
    input: string;
    /** Matter/project this action is bound to, if any. */
    project_id?: string | null;
    /** Acting user, for audit context. */
    user_id?: string | null;
    /** Originating surface, e.g. "mike.chat". */
    surface?: string;
}

export interface PreflightRequest {
    /** UUID of a policy registered via the ICME dashboard */
    policy_id: string;
    /** Structured description of the proposed agent action */
    action: PreflightAction;
}

const ICME_API_BASE =
    process.env.ICME_API_BASE_URL ?? "https://api.icme.io/v1";

const REQUEST_TIMEOUT_MS = Number(
    process.env.ICME_PREFLIGHT_TIMEOUT_MS ?? 8000,
);

/**
 * Normalize a verdict from the API (or solver) to the API vocabulary.
 * Accepts ALLOWED/BLOCKED/ERROR directly and maps solver-style SAT/UNSAT
 * defensively. Anything unrecognized becomes ERROR (fail-closed).
 */
export function normalizeVerdict(raw: unknown): PreflightVerdict {
    if (typeof raw !== "string") return "ERROR";
    switch (raw.toUpperCase()) {
        case "ALLOWED":
        case "SAT":
            return "ALLOWED";
        case "BLOCKED":
        case "UNSAT":
            return "BLOCKED";
        default:
            return "ERROR";
    }
}

/**
 * Verify a proposed action against a Preflight policy.
 *
 * Returns a verdict + check_id. Callers should persist the check_id
 * (and policy_hash) alongside the resulting assistant message so the
 * proof can be independently re-verified later.
 */
export async function verifyWithPreflight(
    req: PreflightRequest,
): Promise<PreflightCheck> {
    const apiKey = process.env.ICME_API_KEY;

    if (!apiKey) {
        if (process.env.ICME_PREFLIGHT_DEMO === "1") {
            // Explicit opt-in demo path: fake an ALLOWED verdict so the
            // wiring can be tested without an ICME account.
            return {
                check_id: `pf_demo_${cryptoRandomId()}`,
                verdict: "ALLOWED",
                policy_id: req.policy_id,
                policy_hash: "sha256:demo",
                policy_version: "demo-v0",
                proof_url: `https://icme.io/proofs/pf_demo`,
                issued_at: new Date().toISOString(),
            };
        }
        // Fail-open in dev when no key is configured. The middleware will
        // log this and (depending on ICME_PREFLIGHT_ENFORCE) decide whether
        // to allow the request through.
        return {
            check_id: "stub-no-api-key",
            verdict: "ERROR",
            policy_id: req.policy_id,
            reason: "ICME_API_KEY not set",
        };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${ICME_API_BASE}/verifyPaid`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                policy_id: req.policy_id,
                action: req.action,
            }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Preflight ${res.status}`);
        const data = (await res.json()) as Record<string, unknown>;

        return {
            check_id: String(data.check_id ?? ""),
            verdict: normalizeVerdict(data.verdict),
            policy_id: String(data.policy_id ?? req.policy_id),
            policy_hash:
                typeof data.policy_hash === "string"
                    ? data.policy_hash
                    : undefined,
            policy_version:
                typeof data.policy_version === "string"
                    ? data.policy_version
                    : undefined,
            proof_url:
                typeof data.check_id === "string"
                    ? `https://icme.io/proofs/${data.check_id}`
                    : undefined,
            issued_at:
                typeof data.issued_at === "string"
                    ? data.issued_at
                    : undefined,
            latency_ms:
                typeof data.latency_ms === "number"
                    ? data.latency_ms
                    : Date.now() - started,
        };
    } catch (err) {
        return {
            check_id: "stub-error",
            verdict: "ERROR",
            policy_id: req.policy_id,
            reason: err instanceof Error ? err.message : String(err),
            latency_ms: Date.now() - started,
        };
    } finally {
        clearTimeout(timer);
    }
}

function cryptoRandomId(): string {
    // Lightweight, dependency-free random id for the demo path
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
