import { Badge, Panel, PanelBody, PanelHeader, PanelTitle } from "@autonoma/blacklight";
import { formatRelativeTime } from "lib/format";
import type { RouterOutputs } from "lib/trpc";
import type { ReactNode } from "react";
import { AppLink } from "routes/_blacklight/_app-shell/-app-link";

type BugDetail = RouterOutputs["bugs"]["detail"];
type BugOccurrence = BugDetail["occurrences"][number];

// A bug lives on a single branch now, so every occurrence hangs off that one branch's
// checkpoints (or the runs/generations that detected it). They arrive newest-first, so
// we render them as a flat, chronological list - no per-PR grouping.
export function OccurrencesRail({ bug }: { bug: BugDetail }) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Occurrences</PanelTitle>
        <span className="font-mono text-2xs text-text-tertiary">{bug.occurrences.length}</span>
      </PanelHeader>
      <PanelBody className="space-y-3 p-4">
        <p className="text-xs leading-relaxed text-text-secondary">
          Each occurrence is one review that linked this behavior to the bug, across this branch's checkpoints.
        </p>
        {bug.occurrences.length === 0 ? (
          <p className="text-xs text-text-secondary">No occurrences recorded for this bug yet.</p>
        ) : (
          <div className="space-y-2">
            {bug.occurrences.map((occurrence) => (
              <OccurrenceLink key={occurrence.issueId} occurrence={occurrence} className={STANDALONE_ROW}>
                <OccurrenceRowContent occurrence={occurrence} />
              </OccurrenceLink>
            ))}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

const STANDALONE_ROW = "block border border-border-dim p-3 transition hover:border-border hover:bg-surface-raised";

function OccurrenceRowContent({ occurrence }: { occurrence: BugOccurrence }) {
  return (
    <>
      <div className="flex items-center gap-2">
        {occurrence.isLatest && (
          <Badge variant="secondary" className="font-mono text-3xs">
            latest
          </Badge>
        )}
        {occurrence.sha != null && (
          <span className="font-mono text-xs text-text-primary">{occurrence.sha.slice(0, 7)}</span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-xs text-text-secondary">{formatRelativeTime(occurrence.createdAt)}</span>
        <span className="font-mono text-3xs uppercase text-primary">{occurrenceLabel(occurrence)}</span>
      </div>
    </>
  );
}

function OccurrenceLink({
  occurrence,
  className,
  children,
}: {
  occurrence: BugOccurrence;
  className: string;
  children: ReactNode;
}) {
  if (occurrence.prNumber != null && occurrence.snapshotId != null) {
    return (
      <AppLink
        to="/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId"
        params={{ prNumber: occurrence.prNumber, snapshotId: occurrence.snapshotId }}
        className={className}
      >
        {children}
      </AppLink>
    );
  }

  if (occurrence.prNumber != null) {
    return (
      <AppLink
        to="/app/$appSlug/pull-requests/$prNumber"
        params={{ prNumber: occurrence.prNumber }}
        className={className}
      >
        {children}
      </AppLink>
    );
  }

  if (occurrence.runId != null) {
    return (
      <AppLink to="/app/$appSlug/runs/$runId" params={{ runId: occurrence.runId }} className={className}>
        {children}
      </AppLink>
    );
  }

  if (occurrence.generationId != null) {
    return (
      <AppLink
        to="/app/$appSlug/generations/$generationId"
        params={{ generationId: occurrence.generationId }}
        className={className}
      >
        {children}
      </AppLink>
    );
  }

  return <div className={className}>{children}</div>;
}

function occurrenceLabel(occurrence: BugOccurrence) {
  if (occurrence.prNumber != null && occurrence.snapshotId != null) return "checkpoint";
  if (occurrence.prNumber != null) return "PR";
  return occurrence.source;
}
