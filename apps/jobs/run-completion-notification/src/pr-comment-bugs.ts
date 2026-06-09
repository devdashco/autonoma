import type { AutonomaCommentBug } from "@autonoma/github/comment";

const SEVERITY_RANK: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

export type CommentIssueForBug = {
    id: string;
    title: string;
    severity: string;
    dismissed: boolean;
    kind: string;
    bug: { id: string; title: string; severity: string } | null;
} | null;

type GroupedCommentBug = AutonomaCommentBug & {
    key: string;
    rank: number;
    firstSeenIndex: number;
};

export function collectBugsForComment(issues: CommentIssueForBug[]): AutonomaCommentBug[] {
    const grouped = new Map<string, GroupedCommentBug>();

    issues.forEach((issue, index) => {
        if (issue == null || issue.dismissed || issue.kind !== "application_bug") return;

        const key = issue.bug?.id ?? issue.id;
        const title = issue.bug?.title ?? issue.title;
        const severity = issue.bug?.severity ?? issue.severity;
        const rank = severityRank(severity);
        const existing = grouped.get(key);

        if (existing == null) {
            grouped.set(key, { key, title, severity, occurrenceCount: 1, rank, firstSeenIndex: index });
            return;
        }

        existing.occurrenceCount = (existing.occurrenceCount ?? 1) + 1;
        if (rank > existing.rank) {
            existing.severity = severity;
            existing.rank = rank;
        }
    });

    return Array.from(grouped.values())
        .sort((a, b) => {
            const severityDelta = b.rank - a.rank;
            if (severityDelta !== 0) return severityDelta;
            const occurrenceDelta = (b.occurrenceCount ?? 1) - (a.occurrenceCount ?? 1);
            if (occurrenceDelta !== 0) return occurrenceDelta;
            return a.firstSeenIndex - b.firstSeenIndex;
        })
        .slice(0, 3)
        .map(({ key: _key, rank: _rank, firstSeenIndex: _firstSeenIndex, occurrenceCount, ...bug }) => ({
            ...bug,
            ...(occurrenceCount != null && occurrenceCount > 1 ? { occurrenceCount } : {}),
        }));
}

function severityRank(severity: string): number {
    return SEVERITY_RANK[severity] ?? 0;
}
