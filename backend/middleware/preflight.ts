/**
 * ICME Preflight verification middleware
 *
 * Inserted between `requireAuth` and the chat handler on POST /chat.
 * Extracts the last user turn, asks Preflight whether responding to it
 * is permitted under the configured policy, and attaches the resulting
 * check_id to `res.locals.preflightCheck` for the handler to persist on
 * the assistant message row.
 *
 * Modes (controlled by ICME_PREFLIGHT_ENFORCE):
 *   "off"      — never call Preflight (no-op middleware)
 *   "shadow"   — call Preflight, log verdict, always allow (default)
 *   "enforce"  — fail closed: block on BLOCKED or verification error (HTTP 451)
 */

import { NextFunction, Request, Response } from "express";
import { verifyWithPreflight, type PreflightCheck } from "../lib/preflight";

type EnforceMode = "off" | "shadow" | "enforce";

function getMode(): EnforceMode {
    const raw = (process.env.ICME_PREFLIGHT_ENFORCE ?? "shadow").toLowerCase();
    if (raw === "off" || raw === "enforce") return raw;
    return "shadow";
}

/**
 * Pull the most recent user message text out of Mike's chat request body.
 * Mike sends `{ messages: [{ role, content }], project_id, ... }`.
 */
export function extractLastUserText(body: unknown): string | null {
    if (!body || typeof body !== "object") return null;
    const messages = (body as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && typeof m === "object" && (m as { role?: unknown }).role === "user") {
            const content = (m as { content?: unknown }).content;
            if (typeof content === "string") return content;
        }
    }
    return null;
}

export async function preflightVerify(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const mode = getMode();
    if (mode === "off") return next();

    const policyId = process.env.ICME_POLICY_ID;
    if (!policyId) {
        console.warn(
            "[preflight] ICME_POLICY_ID not set — skipping verification",
        );
        return next();
    }

    const actionText = extractLastUserText(req.body);
    if (!actionText) {
        // No user turn to verify (e.g. tool follow-up) — pass through
        return next();
    }

    const userId = (res.locals.userId as string | undefined) ?? null;
    const projectId =
        ((req.body as { project_id?: unknown } | undefined)?.project_id as
            | string
            | null
            | undefined) ?? null;

    let check: PreflightCheck;
    try {
        check = await verifyWithPreflight({
            policy_id: policyId,
            action: {
                name: "chat.message",
                input: actionText.slice(0, 2000),
                project_id: projectId,
                user_id: userId,
                surface: "mike.chat",
            },
        });
    } catch (err) {
        console.error("[preflight] verification threw", err);
        // Fail closed in enforce mode; fail open otherwise.
        if (mode === "enforce") {
            res.status(451).json({
                error: "preflight_unavailable",
                detail: "Policy verification unavailable",
            });
            return;
        }
        return next();
    }

    res.locals.preflightCheck = check;

    if (mode === "enforce" && check.verdict !== "ALLOWED") {
        res.status(451).json({
            error: "blocked_by_policy",
            detail: "Blocked by policy",
            check_id: check.check_id,
            proof_url: `https://icme.io/proofs/${check.check_id}`,
            reason: check.reason ?? `Policy returned ${check.verdict}`,
        });
        return;
    }

    console.log("[preflight]", {
        mode,
        verdict: check.verdict,
        check_id: check.check_id,
        latency_ms: check.latency_ms,
    });

    next();
}
