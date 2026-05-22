/**
 * ICME Preflight verification middleware (stub)
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
 *   "enforce"  — block the request on UNSAT or ERROR with 4xx response
 */

import { NextFunction, Request, Response } from "express";
import { verifyWithPreflight, type PreflightCheck } from "../lib/preflight";

type EnforceMode = "off" | "shadow" | "enforce";

function getMode(): EnforceMode {
    const raw = (process.env.ICME_PREFLIGHT_ENFORCE ?? "shadow").toLowerCase();
    if (raw === "off" || raw === "enforce") return raw;
    return "shadow";
}

function extractLastUserText(body: unknown): string | null {
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

    const userId = (res.locals.userId as string | undefined) ?? "unknown";
    const projectId =
        (req.body as { project_id?: unknown } | undefined)?.project_id ?? null;

    let check: PreflightCheck;
    try {
        check = await verifyWithPreflight({
            policy_id: policyId,
            action: `Respond to user query: "${actionText.slice(0, 500)}"`,
            context: {
                user_id: userId,
                project_id: projectId,
                surface: "mike.chat",
            },
        });
    } catch (err) {
        console.error("[preflight] verification threw", err);
        if (mode === "enforce") {
            res.status(502).json({
                detail: "Policy verification unavailable",
            });
            return;
        }
        return next();
    }

    res.locals.preflightCheck = check;

    if (mode === "enforce" && check.verdict !== "SAT") {
        res.status(451).json({
            detail: "Blocked by policy",
            check_id: check.check_id,
            reason: check.reason ?? "Policy returned UNSAT",
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
