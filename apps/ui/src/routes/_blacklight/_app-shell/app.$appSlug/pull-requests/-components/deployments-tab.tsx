import {
  type ColumnDef,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Skeleton,
  SortableTable,
} from "@autonoma/blacklight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { FileTextIcon } from "@phosphor-icons/react/FileText";
import { RocketLaunchIcon } from "@phosphor-icons/react/RocketLaunch";
import { formatDate } from "lib/format";
import { useDeploymentsByPr } from "lib/query/deployments.queries";
import { useMemo } from "react";

interface DeploymentsTabProps {
  applicationId: string;
  prNumber: number;
}

type DeploymentItem = ReturnType<typeof useDeploymentsByPr>["data"][number];

export function DeploymentsTab({ applicationId, prNumber }: DeploymentsTabProps) {
  const { data: deployments } = useDeploymentsByPr(applicationId, prNumber);

  function handleRowClick(deployment: DeploymentItem) {
    window.open(deployment.url, "_blank", "noopener,noreferrer");
  }

  const columns = useMemo<ColumnDef<DeploymentItem, unknown>[]>(
    () => [
      {
        id: "url",
        accessorKey: "url",
        header: "URL",
        size: 480,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <ArrowSquareOutIcon size={14} className="shrink-0 text-text-tertiary" />
            <span className="truncate font-mono text-2xs text-text-secondary">{row.original.url}</span>
          </div>
        ),
      },
      {
        id: "file",
        accessorKey: "file",
        header: "Config",
        size: 240,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <FileTextIcon size={14} className="shrink-0 text-text-tertiary" />
            <span className="truncate font-mono text-2xs text-text-secondary">
              {row.original.file !== "" ? row.original.file : "-"}
            </span>
          </div>
        ),
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        size: 160,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-text-secondary">
            {formatDate(new Date(row.original.updatedAt))}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <Panel>
      <PanelHeader className="flex items-center gap-2">
        <RocketLaunchIcon size={14} className="text-text-tertiary" />
        <PanelTitle>Preview deployments</PanelTitle>
        <span className="ml-auto font-mono text-2xs text-text-tertiary">{deployments.length} total</span>
      </PanelHeader>
      <PanelBody className="overflow-auto p-0">
        <SortableTable
          data={deployments}
          columns={columns}
          onRowClick={handleRowClick}
          emptyMessage="No deployments yet for this PR."
        />
      </PanelBody>
    </Panel>
  );
}

export function DeploymentsTabSkeleton() {
  return (
    <Panel>
      <PanelHeader className="flex items-center gap-2">
        <RocketLaunchIcon size={14} className="text-text-tertiary" />
        <PanelTitle>Preview deployments</PanelTitle>
      </PanelHeader>
      <PanelBody className="p-4">
        <div className="flex flex-col gap-3">
          {["sk-1", "sk-2", "sk-3"].map((id) => (
            <Skeleton key={id} className="h-10 w-full" />
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}
