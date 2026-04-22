import { Skeleton } from "@autonoma/blacklight";
import { usePullRequestFromGitHub } from "lib/query/github.queries";

export function PRNameCell({
  applicationId,
  prNumber,
  branchName,
}: {
  applicationId: string;
  prNumber: number;
  branchName: string;
}) {
  const { data, isPending, isError } = usePullRequestFromGitHub(applicationId, prNumber);

  if (isPending) return <Skeleton className="h-4 w-64" />;
  if (isError || data == null) {
    return <span className="truncate text-sm text-text-primary">{branchName}</span>;
  }
  return <span className="truncate text-sm font-medium text-text-primary">{data.title}</span>;
}

export function PRAuthorCell({ applicationId, prNumber }: { applicationId: string; prNumber: number }) {
  const { data, isPending, isError } = usePullRequestFromGitHub(applicationId, prNumber);

  if (isPending) return <Skeleton className="h-4 w-24" />;
  if (isError || data?.authorLogin == null) {
    return <span className="text-sm text-text-tertiary">-</span>;
  }
  return <span className="text-sm text-text-secondary">{data.authorLogin}</span>;
}
