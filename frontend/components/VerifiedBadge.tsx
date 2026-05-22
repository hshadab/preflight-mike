/**
 * VerifiedBadge — renders an ICME Preflight proof receipt next to an
 * assistant message. Click opens the public proof URL on icme.io so any
 * third party can re-verify the cryptographic check.
 *
 * Stub component for the integration demo. Wire it into AssistantMessage
 * by passing the preflight fields from the chat_messages row through to
 * this component.
 */

import * as React from "react";

export interface PreflightInfo {
    check_id: string | null;
    verdict: "SAT" | "UNSAT" | "ERROR" | null;
    policy_id?: string | null;
    policy_version?: string | null;
}

export function VerifiedBadge({ info }: { info: PreflightInfo | null }) {
    if (!info?.check_id || !info.verdict) return null;

    const isSat = info.verdict === "SAT";
    const label = isSat ? "Verified" : info.verdict;
    const color = isSat
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-amber-50 text-amber-700 border-amber-200";

    const proofUrl = `https://icme.io/proof/${encodeURIComponent(info.check_id)}`;

    return (
        <a
            href={proofUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${color}`}
            title={`Preflight ${info.verdict} · policy ${info.policy_id ?? "?"}`}
        >
            <svg
                width="10"
                height="10"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
            >
                <path d="M10 1.5 3 4v6c0 4.2 3 7.8 7 8.5 4-.7 7-4.3 7-8.5V4l-7-2.5Zm-.8 12.2-3.1-3.1 1.2-1.2 1.9 1.9 4-4 1.2 1.2-5.2 5.2Z" />
            </svg>
            {label}
        </a>
    );
}
