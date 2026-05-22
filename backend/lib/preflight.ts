/**
 * ICME Preflight client (stub)
 *
 * Thin wrapper around https://api.icme.io/v1/verify.
 * Preflight compiles a plain-English policy to SMT-LIB and returns a
 * cryptographic proof that a proposed agent action is SAT (allowed) or
 * UNSAT (blocked) under that policy.
 *
 * Docs: https://docs.icme.io
 *
 * This file is a STUB for the integration demo. Replace the marked
 * section with a real fetch call once ICME_API_KEY is provisioned.
 */

export type PreflightVerdict = "SAT" | "UNSAT" | "ERROR";

export interface PreflightCheck {
    check_id: string;
    verdict: PreflightVerdict;
    policy_id: string;
    policy_version?: string;
    proof_url?: string;
    reason?: string;
    /** Round-trip latency in ms, useful for budget alerts */
    latency_ms?: number;
}

export interface PreflightRequest {
    /** UUID of a policy registered via the ICME dashboard */
    policy_id: string;
    /** Natural-language description of the proposed agent action */
    action: string;
    /** Optional structured context the policy can reference */
    context?: Record<string, unknown>;
}

const ICME_API_BASE =
    process.env.ICME_API_BASE_URL ?? "https://api.icme.io/v1";

/**
 * Verify a proposed action against a Preflight policy.
 *
 * Returns a verdict + check_id. Callers should persist the check_id
 * alongside the resulting assistant message so the proof can be
 * independently re-verified later.
 */
export async function verifyWithPreflight(
    req: PreflightRequest,
): Promise<PreflightCheck> {
    const apiKey = process.env.ICME_API_KEY;
    if (!apiKey) {
        // Fail-open in dev when no key is configured. The middleware will
        // log this and (depending on ICME_PREFLIGHT_ENFORCE) allow the
        // request through with a stub check_id.
        return {
            check_id: "stub-no-api-key",
            verdict: "ERROR",
            policy_id: req.policy_id,
            reason: "ICME_API_KEY not set",
        };
    }

    const started = Date.now();
    try {
        // ──────────────────────────────────────────────────────────────
        // STUB: replace with real Preflight call.
        //
        // const res = await fetch(`${ICME_API_BASE}/verify`, {
        //     method: "POST",
        //     headers: {
        //         "Content-Type": "application/json",
        //         "Authorization": `Bearer ${apiKey}`,
        //     },
        //     body: JSON.stringify({
        //         policy_id: req.policy_id,
        //         action: req.action,
        //         context: req.context ?? {},
        //     }),
        // });
        // if (!res.ok) throw new Error(`Preflight ${res.status}`);
        // const data = await res.json();
        // ──────────────────────────────────────────────────────────────

        // Demo behaviour: pretend everything is SAT, return a fake proof.
        const data = {
            check_id: `pf_${cryptoRandomId()}`,
            verdict: "SAT" as const,
            policy_id: req.policy_id,
            policy_version: "demo-v0",
            proof_url: `${ICME_API_BASE}/proofs/demo`,
        };

        return { ...data, latency_ms: Date.now() - started };
    } catch (err) {
        return {
            check_id: "stub-error",
            verdict: "ERROR",
            policy_id: req.policy_id,
            reason: err instanceof Error ? err.message : String(err),
            latency_ms: Date.now() - started,
        };
    }
}

function cryptoRandomId(): string {
    // Lightweight, dependency-free random id for the stub
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
