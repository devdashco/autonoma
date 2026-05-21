import { Badge, Panel, PanelBody, PanelHeader, PanelTitle, Skeleton } from "@autonoma/blacklight";
import { CameraIcon } from "@phosphor-icons/react/Camera";
import { useNavigate, useParams } from "@tanstack/react-router";
import { formatRelativeTime } from "lib/format";
import { useSnapshotHistory } from "lib/query/branches.queries";
import { useCommitFromGitHub } from "lib/query/github.queries";
import { Suspense } from "react";

type Snapshot = {
  id: string;
  status: string;
  source: string;
  headSha: string | null;
  baseSha: string | null;
  createdAt: Date;
  changeSummary: { added: number; removed: number; updated: number };
};

interface SnapshotTimelineProps {
  branchId: string;
  applicationId: string;
  activeSnapshotId: string | undefined;
  prNumber?: number;
  onSnapshotClick?: (snapshotId: string) => void;
}

export function SnapshotTimeline(props: SnapshotTimelineProps) {
  return (
    <Panel>
      <PanelHeader className="flex items-center gap-2">
        <CameraIcon size={14} className="text-text-tertiary" />
        <PanelTitle>Snapshots</PanelTitle>
        <Suspense fallback={null}>
          <SnapshotCount branchId={props.branchId} />
        </Suspense>
      </PanelHeader>
      <PanelBody className="p-0">
        <Suspense fallback={<SnapshotTimelineSkeleton />}>
          <SnapshotTimelineContent {...props} />
        </Suspense>
      </PanelBody>
    </Panel>
  );
}

function SnapshotCount({ branchId }: { branchId: string }) {
  const { data: snapshots } = useSnapshotHistory(branchId);
  return <span className="ml-auto font-mono text-2xs text-text-tertiary">{snapshots.length} total</span>;
}

export function SnapshotTimelineSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      {["sk-1", "sk-2", "sk-3"].map((id) => (
        <Skeleton key={id} className="h-14 w-full" />
      ))}
    </div>
  );
}

function SnapshotTimelineContent({
  branchId,
  applicationId,
  activeSnapshotId,
  prNumber,
  onSnapshotClick,
}: SnapshotTimelineProps) {
  const { data: snapshots } = useSnapshotHistory(branchId);
  const navigate = useNavigate();
  const { appSlug } = useParams({ from: "/_blacklight/_app-shell/app/$appSlug" });

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-text-tertiary">
        <CameraIcon size={28} />
        <p className="text-sm">No snapshots yet</p>
      </div>
    );
  }

  // snapshotHistory is already desc by createdAt - newest first.
  const ordered = snapshots;

  function handleClick(snapshotId: string) {
    if (onSnapshotClick != null) {
      onSnapshotClick(snapshotId);
      return;
    }
    if (prNumber == null) return;
    void navigate({
      to: "/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId",
      params: { appSlug, prNumber, snapshotId },
    });
  }

  return (
    <ol className="relative flex flex-col gap-3 p-1">
      <span aria-hidden className="absolute top-7 bottom-7 left-[25px] w-[2px] bg-border-dim" />
      {ordered.map((snapshot) => (
        <SnapshotNode
          key={snapshot.id}
          snapshot={snapshot}
          applicationId={applicationId}
          isActive={snapshot.id === activeSnapshotId}
          onClick={() => handleClick(snapshot.id)}
        />
      ))}
    </ol>
  );
}

function SnapshotNode({
  snapshot,
  applicationId,
  isActive,
  onClick,
}: {
  snapshot: Snapshot;
  applicationId: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group relative grid w-full cursor-pointer grid-cols-[12px_minmax(0,1fr)] items-start gap-3 rounded py-3 px-4 text-left transition-colors hover:bg-border-mid/15"
      >
        <SnapshotDot isActive={isActive} status={snapshot.status} />
        <div className="flex min-w-0 flex-col w-full gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-text-primary">
              {snapshot.headSha != null ? snapshot.headSha.slice(0, 8) : "-"}
            </span>
            <StatusBadge isActive={isActive} status={snapshot.status} />
          </div>
          <CommitMessageLine applicationId={applicationId} sha={snapshot.headSha ?? undefined} />
          <div className="flex items-center justify-between gap-2 font-mono text-2xs text-text-tertiary">
            <ChangeSummaryChips summary={snapshot.changeSummary} />
            <span>{formatRelativeTime(snapshot.createdAt)}</span>
          </div>
        </div>
      </button>
    </li>
  );
}

function StatusBadge({ isActive, status }: { isActive: boolean; status: string }) {
  if (isActive) {
    return (
      <Badge variant="success" className="text-2xs">
        active
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="critical" className="text-2xs">
        failed
      </Badge>
    );
  }
  return (
    <span className="inline-flex items-center border border-border-mid bg-surface-base px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-text-tertiary">
      {status}
    </span>
  );
}

function SnapshotDot({ isActive, status }: { isActive: boolean; status: string }) {
  const baseClasses = "relative z-10 mt-[5px] size-3 rounded-full border-2";
  if (isActive) {
    return <span className={`${baseClasses} border-primary-ink bg-primary-ink`} />;
  }
  if (status === "failed") {
    return <span className={`${baseClasses} border-status-critical bg-surface-raised`} />;
  }
  return <span className={`${baseClasses} border-border-mid bg-surface-raised`} />;
}

function CommitMessageLine({ applicationId, sha }: { applicationId: string; sha: string | undefined }) {
  const { data, isPending, isError } = useCommitFromGitHub(applicationId, sha);

  if (sha == null) return null;
  if (isPending) return <Skeleton className="h-3.5 w-40" />;
  if (isError || data == null) return null;

  const firstLine = data.message.split("\n")[0] ?? "";
  if (firstLine.length === 0) return null;
  return <span className="truncate text-xs text-text-secondary">{firstLine}</span>;
}

function ChangeSummaryChips({ summary }: { summary: { added: number; removed: number; updated: number } }) {
  const chips: Array<{ key: string; label: string; className: string }> = [];
  if (summary.added > 0) {
    chips.push({ key: "added", label: `+${summary.added}`, className: "text-status-success" });
  }
  if (summary.updated > 0) {
    chips.push({ key: "updated", label: `~${summary.updated}`, className: "text-status-warn" });
  }
  if (summary.removed > 0) {
    chips.push({ key: "removed", label: `-${summary.removed}`, className: "text-status-critical" });
  }

  if (chips.length === 0) {
    return <span className="font-mono text-2xs text-text-tertiary">no changes</span>;
  }

  return (
    <div className="flex items-center gap-2 font-mono text-2xs">
      {chips.map((chip) => (
        <span key={chip.key} className={chip.className}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}
