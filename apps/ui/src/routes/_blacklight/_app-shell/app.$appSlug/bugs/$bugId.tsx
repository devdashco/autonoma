import { Badge, Button, Panel, PanelBody, PanelHeader, PanelTitle, Separator, Skeleton } from "@autonoma/blacklight";
import type { BugVerdict } from "@autonoma/types";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/ArrowCounterClockwise";
import { BugBeetleIcon } from "@phosphor-icons/react/BugBeetle";
import { CameraIcon } from "@phosphor-icons/react/Camera";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { ThumbsDownIcon } from "@phosphor-icons/react/ThumbsDown";
import { ThumbsUpIcon } from "@phosphor-icons/react/ThumbsUp";
import { VideoIcon } from "@phosphor-icons/react/Video";
import { createFileRoute } from "@tanstack/react-router";
import { EvidenceLightbox } from "components/evidence-lightbox";
import { useAuth } from "lib/auth";
import { formatDate } from "lib/format";
import {
  ensureBugDetailData,
  useBugDetail,
  useClassificationEnabled,
  useClassifyBug,
  useReopenBug,
  useResolveBug,
} from "lib/query/bugs.queries";
import { Suspense, useState } from "react";
import { AppLink } from "../../-app-link";

export const Route = createFileRoute("/_blacklight/_app-shell/app/$appSlug/bugs/$bugId")({
  loader: ({ context, params: { bugId } }) => {
    return ensureBugDetailData(context.queryClient, bugId);
  },
  component: BugDetailPage,
});

type SeverityBadgeVariant = "critical" | "high" | "warn" | "secondary";

const SEVERITY_BADGE: Record<string, SeverityBadgeVariant> = {
  critical: "critical",
  high: "high",
  medium: "warn",
  low: "secondary",
};

type StatusBadgeVariant = "status-failed" | "success" | "warn";

const STATUS_BADGE: Record<string, StatusBadgeVariant> = {
  open: "status-failed",
  resolved: "success",
  regressed: "warn",
};

const TH = "px-4 py-2.5 text-left font-mono text-2xs font-medium uppercase tracking-widest text-text-tertiary";

interface EvidenceMedia {
  type: "screenshot" | "video";
  url: string;
  description: string;
}

function BugDetail() {
  const { bugId } = Route.useParams();
  const { isAdmin } = useAuth();
  const { data: bug } = useBugDetail(bugId);
  const resolveBug = useResolveBug(bugId);
  const reopenBug = useReopenBug(bugId);
  const classifyBug = useClassifyBug();
  const { data: classification } = useClassificationEnabled(isAdmin);
  const [activeMedia, setActiveMedia] = useState<EvidenceMedia | undefined>(undefined);
  const [verdict, setVerdict] = useState<BugVerdict | undefined>(undefined);

  function classify(value: BugVerdict) {
    setVerdict(value);
    classifyBug.mutate({ bugId, verdict: value });
  }

  function getIssueMediaItems(evidence: Array<{ type: string; description: string; url?: string }>) {
    return evidence.filter(
      (e): e is typeof e & { url: string } => e.url != null && (e.type === "screenshot" || e.type === "video"),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <BugBeetleIcon size={20} className="text-text-tertiary" />
            <h1 className="text-2xl font-medium tracking-tight text-text-primary">{bug.title}</h1>
            <Badge variant={STATUS_BADGE[bug.status] ?? "secondary"}>{bug.status}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-text-secondary">
            {bug.application.name}
            {bug.testCases.length > 0
              ? ` - ${bug.testCases.length} test ${bug.testCases.length === 1 ? "case" : "cases"} affected`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && classification?.enabled === true && (
            <>
              <Button
                size="sm"
                variant={verdict === "true_positive" ? "default" : "ghost"}
                onClick={() => classify("true_positive")}
                disabled={classifyBug.isPending}
              >
                <ThumbsUpIcon size={14} />
                True positive
              </Button>
              <Button
                size="sm"
                variant={verdict === "false_positive" ? "default" : "ghost"}
                onClick={() => classify("false_positive")}
                disabled={classifyBug.isPending}
              >
                <ThumbsDownIcon size={14} />
                False positive
              </Button>
              <Separator orientation="vertical" className="h-5" />
            </>
          )}
          {isAdmin && classification?.enabled === false && (
            <>
              <span className="max-w-56 text-right text-xs text-text-tertiary">
                Bug classification needs PostHog, which isn't enabled in this environment. Use it in production.
              </span>
              <Separator orientation="vertical" className="h-5" />
            </>
          )}
          {bug.status === "resolved" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => reopenBug.mutate({ bugId })}
              disabled={reopenBug.isPending}
            >
              <ArrowCounterClockwiseIcon size={14} />
              Reopen
            </Button>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={() => resolveBug.mutate({ bugId })}
              disabled={resolveBug.isPending}
            >
              <CheckCircleIcon size={14} />
              Mark resolved
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-6 lg:grid-cols-4">
        <div className="col-span-3">
          <Panel>
            <PanelHeader>
              <PanelTitle>Description</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <p className="text-sm leading-relaxed text-text-secondary whitespace-pre-wrap">{bug.description}</p>
            </PanelBody>
          </Panel>

          <div className="mt-6">
            <Panel>
              <PanelHeader className="flex items-center gap-2">
                <PanelTitle>Occurrences</PanelTitle>
                <span className="ml-auto font-mono text-2xs text-text-tertiary">{bug.issues.length} total</span>
              </PanelHeader>
              <PanelBody className="overflow-auto p-0">
                <table className="w-full min-w-120 table-fixed text-sm">
                  <thead className="sticky top-0 z-10 border-b border-border-dim bg-surface-base">
                    <tr>
                      <th className={`${TH} w-5/12`}>Title</th>
                      <th className={`${TH} w-2/12`}>Severity</th>
                      <th className={`${TH} w-2/12`}>Evidence</th>
                      <th className={`${TH} w-3/12`}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bug.issues.map((issue) => {
                      const evidence = (
                        issue as typeof issue & {
                          evidence?: Array<{ type: string; description: string; url?: string }>;
                        }
                      ).evidence;
                      const media = getIssueMediaItems(evidence ?? []);
                      return (
                        <tr key={issue.id} className="border-b border-border-dim last:border-0">
                          <td className="px-4 py-2.5">
                            <AppLink
                              to="/app/$appSlug/issues/$issueId"
                              params={{ issueId: issue.id }}
                              className="block truncate text-sm font-medium text-primary hover:underline"
                            >
                              {issue.title}
                            </AppLink>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={SEVERITY_BADGE[issue.severity] ?? "secondary"}>{issue.severity}</Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {media.map((item) => (
                                <button
                                  key={`${item.type}-${item.url}`}
                                  type="button"
                                  onClick={() =>
                                    setActiveMedia({
                                      type: item.type as "screenshot" | "video",
                                      url: item.url,
                                      description: item.description,
                                    })
                                  }
                                  className="flex size-6 items-center justify-center text-text-tertiary transition-colors hover:text-text-primary"
                                  title={item.type === "screenshot" ? "View screenshot" : "Play video"}
                                  aria-label={item.type === "screenshot" ? "View screenshot" : "Play video"}
                                >
                                  {item.type === "screenshot" ? <CameraIcon size={14} /> : <VideoIcon size={14} />}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-sm text-text-secondary whitespace-nowrap">
                              {formatDate(issue.createdAt)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </PanelBody>
            </Panel>
          </div>
        </div>

        <div className="col-span-3 lg:col-span-1">
          <Panel>
            <PanelHeader>
              <PanelTitle>Details</PanelTitle>
            </PanelHeader>
            <PanelBody className="flex flex-col gap-4">
              <div>
                <span className="font-mono text-2xs uppercase text-text-tertiary">Severity</span>
                <div className="mt-1">
                  <Badge variant={SEVERITY_BADGE[bug.severity] ?? "secondary"}>{bug.severity}</Badge>
                </div>
              </div>

              <Separator />

              <div>
                <span className="font-mono text-2xs uppercase text-text-tertiary">First seen</span>
                <p className="mt-1 text-sm text-text-secondary">{formatDate(bug.firstSeenAt)}</p>
              </div>

              <div>
                <span className="font-mono text-2xs uppercase text-text-tertiary">Last seen</span>
                <p className="mt-1 text-sm text-text-secondary">{formatDate(bug.lastSeenAt)}</p>
              </div>

              {bug.resolvedAt != null && (
                <div>
                  <span className="font-mono text-2xs uppercase text-text-tertiary">Resolved at</span>
                  <p className="mt-1 text-sm text-text-secondary">{formatDate(bug.resolvedAt)}</p>
                </div>
              )}

              <Separator />

              <div>
                <span className="font-mono text-2xs uppercase text-text-tertiary">
                  {bug.testCases.length === 1 ? "Test case" : `Test cases (${bug.testCases.length})`}
                </span>
                <ul className="mt-1 flex flex-col gap-1">
                  {bug.testCases.map((tc) => (
                    <li key={tc.id}>
                      <AppLink
                        to="/app/$appSlug/tests/$testSlug"
                        params={{ testSlug: tc.slug }}
                        className="text-sm text-primary hover:underline"
                      >
                        {tc.name}
                      </AppLink>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <span className="font-mono text-2xs uppercase text-text-tertiary">Application</span>
                <p className="mt-1 text-sm text-text-secondary">{bug.application.name}</p>
              </div>
            </PanelBody>
          </Panel>
        </div>
      </div>

      {activeMedia != null && (
        <EvidenceLightbox
          open
          onClose={() => setActiveMedia(undefined)}
          type={activeMedia.type}
          url={activeMedia.url}
          description={activeMedia.description}
        />
      )}
    </div>
  );
}

function BugDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-10 w-96" />
      <div className="grid grid-cols-3 gap-6 lg:grid-cols-4">
        <div className="col-span-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="mt-6 h-64 w-full" />
        </div>
        <div className="col-span-3 lg:col-span-1">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

function BugDetailPage() {
  return (
    <Suspense fallback={<BugDetailSkeleton />}>
      <BugDetail />
    </Suspense>
  );
}
