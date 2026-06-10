import { Badge } from "@autonoma/blacklight";
import { GitPullRequestIcon } from "@phosphor-icons/react/GitPullRequest";
import { formatRelativeTime } from "lib/format";

type PRState = "open" | "closed" | "merged";

export function PRNameCell({ title, branchName }: { title?: string; branchName: string }) {
  // Fall back to the branch name until the cached PR title is populated.
  if (title == null) {
    return <span className="block truncate text-sm text-text-primary">{branchName}</span>;
  }
  return <span className="block truncate text-sm font-medium text-text-primary">{title}</span>;
}

export function PRAuthorCell({ authorLogin }: { authorLogin?: string }) {
  if (authorLogin == null) {
    return <span className="text-sm text-text-tertiary">-</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <img
        src={`https://github.com/${authorLogin}.png?size=40`}
        alt=""
        className="size-5 shrink-0 border border-border-dim bg-surface-raised object-cover"
      />
      <span className="min-w-0 truncate text-sm text-text-secondary">{authorLogin}</span>
    </span>
  );
}

export function PRStateCell({ state }: { state?: PRState }) {
  if (state === "merged") {
    return (
      <Badge variant="outline" className="gap-1 border-primary-ink/40 bg-primary-ink/5 text-primary-ink">
        <GitPullRequestIcon size={10} />
        Merged
      </Badge>
    );
  }
  if (state === "closed") {
    return (
      <Badge variant="outline" className="gap-1 border-status-critical/40 bg-status-critical/5 text-status-critical">
        <GitPullRequestIcon size={10} />
        Closed
      </Badge>
    );
  }
  // Default to Open until the cached state is populated.
  return (
    <Badge variant="success" className="gap-1">
      <GitPullRequestIcon size={10} />
      Open
    </Badge>
  );
}

export function PRUpdatedCell({ updatedAt }: { updatedAt?: Date }) {
  if (updatedAt == null) return <span className="text-sm text-text-tertiary">-</span>;
  return <span className="font-mono text-xs text-text-secondary">{formatRelativeTime(updatedAt)}</span>;
}
