import { Tabs, TabsContent, TabsList, TabsTrigger } from "@autonoma/blacklight";
import type { RouterOutputs } from "lib/trpc";
import { Suspense } from "react";
import { DeploymentsTab, DeploymentsTabSkeleton } from "./deployments-tab";
import { PRBodyCard } from "./pr-body-card";
import { PRCommitsTab } from "./pr-commits-tab";

type PullRequest = RouterOutputs["github"]["getPullRequest"];

export function PRMainContent({
  applicationId,
  prNumber,
  pr,
}: {
  applicationId: string;
  prNumber: number;
  pr: PullRequest | undefined;
}) {
  return (
    <Tabs defaultValue="activity" className="flex flex-col gap-6">
      <TabsList variant="line">
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="deployments">Deployments</TabsTrigger>
      </TabsList>

      <TabsContent value="activity" className="flex flex-col gap-6">
        <PRBodyCard body={pr?.body} authorLogin={pr?.authorLogin} />
        <PRCommitsTab applicationId={applicationId} prNumber={prNumber} />
      </TabsContent>

      <TabsContent value="deployments">
        <Suspense fallback={<DeploymentsTabSkeleton />}>
          <DeploymentsTab applicationId={applicationId} prNumber={prNumber} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
