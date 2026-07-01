import { Badge, Panel, PanelBody, PanelHeader, PanelTitle, Skeleton } from "@autonoma/blacklight";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GitDiffIcon } from "@phosphor-icons/react/GitDiff";
import { MinusCircleIcon } from "@phosphor-icons/react/MinusCircle";
import { PencilSimpleIcon } from "@phosphor-icons/react/PencilSimple";
import { PlusCircleIcon } from "@phosphor-icons/react/PlusCircle";
import { useTestSuiteChangesByPr } from "lib/query/branches.queries";
import type { RouterOutputs } from "lib/trpc";
import { Suspense } from "react";
import { AppLink } from "routes/_blacklight/_app-shell/-app-link";

type TestSuiteChanges = RouterOutputs["branches"]["testSuiteChangesByPr"];
type Row = TestSuiteChanges["added"][number];

interface PRTestChangesProps {
  branchId: string;
  prNumber: number;
}

export function PRTestChanges({ branchId, prNumber }: PRTestChangesProps) {
  return (
    <Panel>
      <PanelHeader>
        <div className="flex items-center gap-2">
          <GitDiffIcon size={14} className="text-text-tertiary" />
          <PanelTitle>Test suite changes</PanelTitle>
        </div>
        <Suspense fallback={null}>
          <TotalChangeCount branchId={branchId} />
        </Suspense>
      </PanelHeader>
      <PanelBody className="p-0">
        <Suspense fallback={<TestChangesSkeleton />}>
          <PRTestChangesContent branchId={branchId} prNumber={prNumber} />
        </Suspense>
      </PanelBody>
    </Panel>
  );
}

function totalChanges(data: TestSuiteChanges): number {
  return data.added.length + data.modified.length + data.removed.length;
}

function TotalChangeCount({ branchId }: { branchId: string }) {
  const { data } = useTestSuiteChangesByPr(branchId);
  const total = totalChanges(data);
  if (total === 0) return null;
  return (
    <span className="font-mono text-2xs text-text-tertiary">
      {total} {total === 1 ? "change" : "changes"}
    </span>
  );
}

function PRTestChangesContent({ branchId, prNumber }: { branchId: string; prNumber: number }) {
  const { data } = useTestSuiteChangesByPr(branchId);

  if (totalChanges(data) === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-text-tertiary">
        <CheckCircleIcon size={28} />
        <p className="text-sm">No test changes detected for this PR</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Section kind="added" title="Tests added" rows={data.added} prNumber={prNumber} />
      <Section kind="modified" title="Tests modified" rows={data.modified} prNumber={prNumber} />
      <Section kind="removed" title="Tests removed" rows={data.removed} prNumber={prNumber} />
    </div>
  );
}

type Kind = "added" | "modified" | "removed";

function Section({ kind, title, rows, prNumber }: { kind: Kind; title: string; rows: Row[]; prNumber: number }) {
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-b border-border-dim px-5 py-5 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KindIcon kind={kind} />
          <h3 className="font-mono text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{title}</h3>
        </div>
        <Badge variant="outline" className="font-mono text-2xs">
          {rows.length}
        </Badge>
      </div>
      <div className="flex flex-col">
        {rows.map((row) => (
          <RowItem key={row.testCase.id} row={row} prNumber={prNumber} />
        ))}
      </div>
    </section>
  );
}

function KindIcon({ kind }: { kind: Kind }) {
  if (kind === "added") return <PlusCircleIcon size={14} className="text-status-success" />;
  if (kind === "modified") return <PencilSimpleIcon size={14} className="text-status-warn" />;
  return <MinusCircleIcon size={14} className="text-status-critical" />;
}

function RowItem({ row, prNumber }: { row: Row; prNumber: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-dim/60 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <AppLink
          to="/app/$appSlug/tests/$testSlug"
          params={{ testSlug: row.testCase.slug }}
          className="min-w-0 truncate font-mono text-sm text-text-primary hover:underline"
        >
          {row.testCase.name}
        </AppLink>
      </div>
      <AppLink
        to="/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId"
        params={{ prNumber, snapshotId: row.latestSnapshotId }}
        className="shrink-0 rounded bg-surface-base px-1.5 py-0.5 font-mono text-2xs text-text-secondary hover:text-text-primary"
      >
        {row.latestSnapshotShortSha}
      </AppLink>
    </div>
  );
}

function TestChangesSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5">
      {["sk-1", "sk-2", "sk-3"].map((id) => (
        <Skeleton key={id} className="h-8 w-full" />
      ))}
    </div>
  );
}
