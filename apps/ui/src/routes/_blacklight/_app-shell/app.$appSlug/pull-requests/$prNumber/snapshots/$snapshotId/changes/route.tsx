import { Panel, PanelBody, PanelHeader, PanelTitle } from "@autonoma/blacklight";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SnapshotChangesList } from "components/snapshot/snapshot-changes-list";
import { useSnapshotSections } from "components/snapshot/use-snapshot-sections";

export const Route = createFileRoute(
  "/_blacklight/_app-shell/app/$appSlug/pull-requests/$prNumber/snapshots/$snapshotId/changes",
)({
  component: ChangesLayout,
});

function ChangesLayout() {
  const { snapshotId } = Route.useParams();
  const sections = useSnapshotSections(snapshotId);

  const total = sections.reduce((sum, s) => sum + s.entries.length, 0);

  return (
    <Panel className="lg:h-full lg:min-h-0">
      <PanelHeader>
        <PanelTitle>Test suite changes</PanelTitle>
        <span className="font-mono text-2xs text-text-tertiary">
          {total} {total === 1 ? "test" : "tests"}
        </span>
      </PanelHeader>
      <PanelBody className="p-0 lg:min-h-0 lg:overflow-hidden">
        {total === 0 ? (
          <div className="px-5 py-8">
            <p className="text-xs text-text-tertiary">No test suite changes recorded for this checkpoint.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px bg-border-dim lg:h-full lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:grid-rows-1">
            <div className="bg-surface-base lg:min-h-0 lg:overflow-y-auto">
              <SnapshotChangesList />
            </div>
            <div className="bg-surface-base lg:min-h-0 lg:overflow-y-auto">
              <Outlet />
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
