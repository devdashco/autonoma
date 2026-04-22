import { Badge, Panel, PanelBody, PanelHeader, PanelTitle, Skeleton } from "@autonoma/blacklight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";

export function PRStatusPanel({
  branchName,
  authorLogin,
  githubUrl,
  prPending,
}: {
  branchName: string;
  authorLogin: string | undefined;
  githubUrl: string | undefined;
  prPending: boolean;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Status</PanelTitle>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4 p-4">
        <DetailRow label="State">
          <Badge variant="success">Open</Badge>
        </DetailRow>
        <DetailRow label="Branch">
          <span className="break-all font-mono text-xs text-text-secondary">{branchName}</span>
        </DetailRow>
        <DetailRow label="Author">
          {prPending ? (
            <Skeleton className="h-4 w-24" />
          ) : authorLogin != null ? (
            <span className="text-sm text-text-secondary">{authorLogin}</span>
          ) : (
            <span className="text-sm text-text-tertiary">-</span>
          )}
        </DetailRow>
        {githubUrl != null && (
          <DetailRow label="GitHub">
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            >
              View on GitHub
              <ArrowSquareOutIcon size={12} />
            </a>
          </DetailRow>
        )}
      </PanelBody>
    </Panel>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-2xs font-semibold uppercase tracking-widest text-text-tertiary">{label}</span>
      <div>{children}</div>
    </div>
  );
}
