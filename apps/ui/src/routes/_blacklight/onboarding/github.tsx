import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@autonoma/blacklight";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { GithubLogoIcon } from "@phosphor-icons/react/GithubLogo";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useGithubConfig,
  useGithubInstallation,
  useGithubRepositories,
  useLinkRepository,
} from "lib/query/github.queries";
import { useCompleteGithub } from "lib/query/onboarding.queries";
import { Suspense, useState } from "react";
import { z } from "zod";
import { OnboardingPageHeader } from "./-components/onboarding-page-header";

const githubSearchParams = z.object({
  appId: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/_blacklight/onboarding/github")({
  component: () => <Navigate to="/onboarding" search={{ step: "github", appId: undefined }} />,
  validateSearch: githubSearchParams,
});

function getErrorMessage(error: string): string {
  switch (error) {
    case "install_failed":
      return "GitHub App installation failed. Please try again.";
    case "install_cancelled":
      return "GitHub App installation was cancelled.";
    default:
      return `GitHub error: ${error}`;
  }
}

export function GitHubPage({ appId }: { appId?: string }) {
  const applicationId = appId;
  // Check if we arrived here from a GitHub OAuth callback with an error
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error") ?? undefined;

  if (applicationId == null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-text-tertiary">No application found. Please start from the beginning.</p>
      </div>
    );
  }

  return (
    <>
      <OnboardingPageHeader
        leading={
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-primary-ink/20 bg-surface-base">
            <GithubLogoIcon size={22} weight="duotone" className="text-primary-ink" />
          </div>
        }
        title="Connect GitHub"
        description={
          <p className="max-w-2xl">
            Link a repository so Autonoma can analyze code changes and keep your tests up to date.
          </p>
        }
        descriptionClassName="text-sm"
      />

      {error != null && (
        <div className="mb-8 flex items-start gap-3 border border-status-critical/30 bg-status-critical/5 px-5 py-4">
          <WarningCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-status-critical" />
          <p className="font-mono text-sm text-status-critical">{getErrorMessage(error)}</p>
        </div>
      )}

      <Suspense fallback={<GitHubContentSkeleton />}>
        <GitHubContent appId={applicationId} />
      </Suspense>
    </>
  );
}

function GitHubContentSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-full max-w-lg" />
      <Skeleton className="h-10 w-48" />
    </div>
  );
}

function GitHubContent({ appId }: { appId: string }) {
  const { data: installation } = useGithubInstallation();

  if (installation == null) {
    return <ConnectStep appId={appId} />;
  }

  return <RepoSelectionStep appId={appId} />;
}

function ConnectStep({ appId }: { appId: string }) {
  const returnPath = `/onboarding/github?appId=${encodeURIComponent(appId)}`;
  const { data } = useGithubConfig(returnPath);

  return (
    <div className="space-y-6">
      <p className="font-mono text-sm text-text-secondary">
        Install the Autonoma GitHub App on your repository to enable automatic test updates when code changes.
      </p>

      <Button
        variant="accent"
        className="gap-3 px-8 py-4 font-mono text-sm font-bold uppercase"
        onClick={() => {
          if (data.installUrl != null) {
            window.location.href = data.installUrl;
          }
        }}
        disabled={data.installUrl == null}
        aria-label="onboarding-github-connect"
      >
        <GithubLogoIcon size={18} weight="bold" />
        Install GitHub App
      </Button>
    </div>
  );
}

function RepoSelectionStep({ appId }: { appId: string }) {
  const { data: repos } = useGithubRepositories();
  const { data: installation } = useGithubInstallation();
  const linkRepository = useLinkRepository();
  const completeGithub = useCompleteGithub();

  const navigate = useNavigate();
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [configured, setConfigured] = useState(false);

  const selectedRepo = repos.find((r) => r.id === selectedRepoId);
  const isLinking = linkRepository.isPending;
  const isCompleting = completeGithub.isPending;
  const settingsUrl = installation?.settingsUrl;

  function handleLinkRepo() {
    if (selectedRepoId == null) return;

    linkRepository.mutate(
      { applicationId: appId, githubRepoId: selectedRepoId },
      {
        onSuccess: () => {
          setConfigured(true);
        },
      },
    );
  }

  function handleComplete() {
    completeGithub.mutate(
      { applicationId: appId },
      {
        onSuccess: () => {
          void navigate({ to: "/onboarding", search: { step: "complete", appId: appId } });
        },
      },
    );
  }

  if (configured) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-3 rounded border border-status-success/20 bg-status-success/5 px-5 py-4">
          <CheckCircleIcon size={20} weight="fill" className="text-status-success" />
          <div>
            <p className="text-sm font-medium text-text-primary">{selectedRepo?.fullName ?? "Repository"} connected</p>
            <p className="font-mono text-2xs text-text-secondary">
              Default branch: <span className="text-text-primary">{selectedRepo?.defaultBranch ?? "main"}</span>
            </p>
          </div>
        </div>

        <Button
          variant="accent"
          className="gap-3 px-8 py-4 font-mono text-sm font-bold uppercase"
          onClick={handleComplete}
          disabled={isCompleting}
          aria-label="onboarding-github-complete"
        >
          {isCompleting ? "finishing..." : "Complete Setup"}
          <ArrowRightIcon size={18} weight="bold" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-1.5">
        <Label>Repository</Label>
        <Select
          value={selectedRepoId != null ? String(selectedRepoId) : ""}
          onValueChange={(value) => {
            const numValue = Number(value);
            setSelectedRepoId(!Number.isNaN(numValue) ? numValue : undefined);
          }}
        >
          <SelectTrigger className="max-w-lg">
            <SelectValue placeholder="Select a repository" />
          </SelectTrigger>
          <SelectContent>
            {repos.map((repo) => (
              <SelectItem key={repo.id} value={String(repo.id)}>
                {repo.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {settingsUrl != null && (
          <p className="font-mono text-2xs text-text-tertiary">
            Can't find your repository?{" "}
            <a
              href={settingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-ink underline underline-offset-2 transition-colors hover:text-primary-ink/80"
            >
              Configure repository access on GitHub
            </a>
          </p>
        )}
      </div>

      <Button
        variant="accent"
        className="gap-3 px-8 py-4 font-mono text-sm font-bold uppercase"
        onClick={handleLinkRepo}
        disabled={selectedRepoId == null || isLinking}
        aria-label="onboarding-github-link"
      >
        {isLinking ? "linking..." : "Link Repository"}
        <ArrowRightIcon size={18} weight="bold" />
      </Button>
    </div>
  );
}
