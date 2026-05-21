import { Panel, PanelBody, PanelHeader, PanelTitle, Skeleton } from "@autonoma/blacklight";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { HeartbeatIcon } from "@phosphor-icons/react/Heartbeat";
import { PlayCircleIcon } from "@phosphor-icons/react/PlayCircle";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { WarningOctagonIcon } from "@phosphor-icons/react/WarningOctagon";
import { XCircleIcon } from "@phosphor-icons/react/XCircle";
import { useSnapshotDetail } from "lib/query/branches.queries";
import type { RouterOutputs } from "lib/trpc";
import { Suspense } from "react";

type Snapshot = RouterOutputs["branches"]["snapshotHistory"][number];
type SnapshotDetail = RouterOutputs["branches"]["snapshotDetail"];
type HealthStatus = SnapshotDetail["health"];
type HealthCounts = SnapshotDetail["healthCounts"];

export function ActiveSnapshotHealthPanel({
  applicationId: _applicationId,
  snapshot,
}: {
  applicationId: string;
  snapshot: Snapshot;
}) {
  const shortSha = snapshot.headSha?.slice(0, 8);

  return (
    <Panel>
      <PanelHeader className="flex flex-col items-start gap-1">
        <PanelTitle>Active snapshot health</PanelTitle>
        {shortSha != null && (
          <span className="font-mono text-2xs uppercase tracking-widest text-text-tertiary">snapshot {shortSha}</span>
        )}
      </PanelHeader>
      <PanelBody className="p-0">
        <Suspense fallback={<HealthSkeleton />}>
          <HealthLoader snapshotId={snapshot.id} />
        </Suspense>
      </PanelBody>
    </Panel>
  );
}

function HealthLoader({ snapshotId }: { snapshotId: string }) {
  const { data } = useSnapshotDetail(snapshotId);
  return <HealthContent snapshot={data.snapshot} health={data.health} counts={data.healthCounts} />;
}

function HealthContent({
  snapshot,
  health,
  counts,
}: {
  snapshot: SnapshotDetail["snapshot"];
  health: HealthStatus;
  counts: HealthCounts;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-4 px-5 pt-8 pb-6">
        <HealthHeroIcon status={health} />
        <HealthBadge status={health} />
        <p className="text-center text-sm text-text-secondary">{describeStatus(snapshot.status, counts)}</p>
      </div>

      <div className="border-t border-border-dim px-5 py-4">
        <HealthBreakdown counts={counts} />
      </div>

      <div className="grid grid-cols-2 border-t border-border-dim">
        <Stat value={counts.totalTests} label="tests" />
        <Stat value={counts.quarantined} label="quarantined" tone={counts.quarantined > 0 ? "critical" : "neutral"} />
      </div>
    </>
  );
}

function describeStatus(snapshotStatus: string, counts: HealthCounts): string {
  if (snapshotStatus === "failed") return "Snapshot failed to process";
  if (counts.failing > 0) {
    return `${counts.failing} of ${counts.totalTests} ${counts.totalTests === 1 ? "test" : "tests"} failing`;
  }
  if (counts.quarantined > 0) {
    return `${counts.quarantined} ${counts.quarantined === 1 ? "test" : "tests"} quarantined`;
  }
  if (counts.running > 0) return "Tests are still running";
  if (counts.passing > 0 && counts.notAffected === 0) return "All affected tests passing";
  if (counts.notAffected === counts.totalTests - counts.quarantined) return "No tests affected by this PR";
  return `${counts.notAffected} of ${counts.totalTests} not affected by this PR`;
}

function HealthHeroIcon({ status }: { status: HealthStatus }) {
  const colorClass =
    status === "critical"
      ? "text-status-critical"
      : status === "healthy"
        ? "text-status-success"
        : status === "running"
          ? "text-status-warn"
          : "text-text-tertiary";

  const beatDuration =
    status === "critical"
      ? "[animation-duration:2s]"
      : status === "running"
        ? "[animation-duration:2.6s]"
        : status === "healthy"
          ? "[animation-duration:3.2s]"
          : "[animation-duration:4s]";

  return (
    <HeartbeatIcon
      size={56}
      weight="duotone"
      className={`origin-center cursor-default hover:animate-heartbeat ${beatDuration} ${colorClass}`}
    />
  );
}

function HealthBadge({ status }: { status: HealthStatus }) {
  if (status === "critical") {
    return (
      <span className="inline-flex items-center border border-status-critical bg-status-critical/10 px-3 py-1 font-mono text-2xs font-bold uppercase tracking-widest text-status-critical">
        Critical
      </span>
    );
  }
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center border border-status-success bg-status-success/10 px-3 py-1 font-mono text-2xs font-bold uppercase tracking-widest text-status-success">
        Healthy
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center border border-status-warn bg-status-warn/10 px-3 py-1 font-mono text-2xs font-bold uppercase tracking-widest text-status-warn">
        Running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center border border-border-mid bg-surface-raised px-3 py-1 font-mono text-2xs font-bold uppercase tracking-widest text-text-tertiary">
      Not replayed
    </span>
  );
}

type Tone = "success" | "critical" | "warn" | "neutral";

function HealthBreakdown({ counts }: { counts: HealthCounts }) {
  const items: Array<{ key: keyof HealthCounts; label: string; tone: Tone }> = [
    { key: "failing", label: `${counts.failing} failing`, tone: "critical" },
    { key: "passing", label: `${counts.passing} passing`, tone: "success" },
    { key: "running", label: `${counts.running} running`, tone: "warn" },
    { key: "notAffected", label: `${counts.notAffected} not affected`, tone: "neutral" },
    { key: "quarantined", label: `${counts.quarantined} quarantined`, tone: "critical" },
  ];

  if (counts.totalTests === 0) {
    return <BreakdownRow tone="neutral" label="No tests in this snapshot" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <BreakdownRow key={item.key} tone={item.tone} label={item.label} muted={counts[item.key] === 0} />
      ))}
    </div>
  );
}

function BreakdownRow({ tone, label, muted = false }: { tone: Tone; label: string; muted?: boolean }) {
  const Icon =
    tone === "critical"
      ? XCircleIcon
      : tone === "success"
        ? CheckCircleIcon
        : tone === "warn"
          ? PlayCircleIcon
          : QuestionIcon;

  const colorClass = muted
    ? "text-text-tertiary"
    : tone === "critical"
      ? "text-status-critical"
      : tone === "success"
        ? "text-status-success"
        : tone === "warn"
          ? "text-status-warn"
          : "text-text-secondary";

  return (
    <div className={`flex items-center gap-2 text-sm ${colorClass}`}>
      <Icon size={14} />
      <span>{label}</span>
    </div>
  );
}

function Stat({ value, label, tone = "neutral" }: { value: number; label: string; tone?: "neutral" | "critical" }) {
  const valueClass = tone === "critical" && value > 0 ? "text-status-critical" : "text-text-primary";
  const iconClass = tone === "critical" && value > 0 ? "text-status-critical" : "text-text-tertiary";

  return (
    <div className="flex flex-col items-center justify-center gap-1 border-r border-border-dim px-3 py-4 last:border-r-0">
      <span className={`font-mono text-lg ${valueClass}`}>{value}</span>
      <span
        className={`flex items-center gap-1 font-mono text-2xs uppercase tracking-widest text-text-tertiary ${iconClass}`}
      >
        {label === "quarantined" && value > 0 && <WarningOctagonIcon size={10} />}
        {label}
      </span>
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-5">
      <Skeleton className="mx-auto h-14 w-14" />
      <Skeleton className="mx-auto h-4 w-24" />
      <Skeleton className="mx-auto h-4 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
