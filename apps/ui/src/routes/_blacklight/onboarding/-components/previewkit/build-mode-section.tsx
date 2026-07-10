import { Badge, Input, Label, Textarea, cn } from "@autonoma/blacklight";
import {
  PREVIEWKIT_RUNTIME_CATALOG,
  PREVIEWKIT_RUNTIMES,
  PREVIEWKIT_TOOLBELT,
  previewkitRuntimeImage,
  type PreviewkitRuntime,
  type PreviewkitRuntimeSpec,
} from "@autonoma/types";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { useState } from "react";
import { FieldMessages } from "./field-messages";
import {
  fieldIssueKey,
  type AppBuildMode,
  type AppDraft,
  type AppDraftField,
  type DraftIssues,
} from "./topology-draft";

// The build modes are keyed internally by AppBuildMode; "Manual" is the display
// name for the "runtime" escape hatch (an app's build union still compiles to
// `framework: "runtime"` - only the user-facing wording changed). Manual leads
// because it is the primary path; "auto" is not offered as a choice - an app that
// loaded with no build block or a framework preset keeps auto-detection until the
// user picks a method here.
const MODE_OPTIONS: Array<{ id: AppBuildMode; label: string; hint: string }> = [
  { id: "runtime", label: "Manual", hint: "Pick a runtime and write the build yourself." },
  { id: "dockerfile", label: "Dockerfile", hint: "We build an existing Dockerfile from your repo." },
];

interface BuildModeSectionProps {
  app: AppDraft;
  issues: DraftIssues;
  onChange: (id: number, patch: Partial<AppDraft>) => void;
}

/**
 * An app's build method: a three-way choice between autodetection, an existing
 * Dockerfile, and manual mode (pick a runtime, write a bash build script +
 * entrypoint). Leads the app card because the choice governs which of the app's
 * other fields matter (e.g. build context). Manual mode renders the runtime
 * picker side by side with a live build spec. Compiles via `topology-draft`'s
 * `compileApp`.
 */
export function BuildModeSection({ app, issues, onChange }: BuildModeSectionProps) {
  const activeHint = MODE_OPTIONS.find((mode) => mode.id === app.buildMode)?.hint ?? "";

  function selectMode(mode: AppBuildMode) {
    // Picking any mode is an explicit override, so drop a preserved framework-preset
    // build block (see AppDraft.buildPassthrough) - the user is choosing anew.
    if (mode !== "runtime") {
      onChange(app.id, { buildMode: mode, buildPassthrough: undefined });
      return;
    }
    // Entering manual mode: seed the build script + entrypoint from the current
    // runtime's defaults when they are still blank, so the editor is never empty.
    const spec = PREVIEWKIT_RUNTIME_CATALOG[app.runtime];
    const patch: Partial<AppDraft> = { buildMode: "runtime", buildPassthrough: undefined };
    if (app.buildScript.trim() === "") patch.buildScript = spec.defaultBuildScript;
    if (app.entrypoint.trim() === "") patch.entrypoint = spec.defaultEntrypoint;
    onChange(app.id, patch);
  }

  return (
    <div>
      <Label>Build method</Label>
      <div className="mt-2 flex w-fit border border-border-dim">
        {MODE_OPTIONS.map((mode, index) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => selectMode(mode.id)}
            aria-pressed={app.buildMode === mode.id}
            className={cn(
              "px-5 py-2 text-2xs font-medium transition-colors",
              index > 0 && "border-l border-border-dim",
              app.buildMode === mode.id
                ? "bg-primary/15 text-primary-ink"
                : "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {activeHint !== "" ? <p className="mt-2 text-2xs text-text-secondary">{activeHint}</p> : undefined}

      {app.buildMode === "auto" ? (
        <p className="mt-2 text-2xs text-text-secondary">
          {app.buildPassthrough != null ? (
            <>
              Keeping this app&apos;s existing{" "}
              <span className="font-mono text-text-primary">{app.buildPassthrough.framework}</span> build config.
            </>
          ) : (
            "This app currently uses auto-detection."
          )}{" "}
          Pick a method above to configure it explicitly.
        </p>
      ) : undefined}

      {app.buildMode === "dockerfile" ? (
        <div className="mt-4 max-w-md">
          <Label htmlFor={`pk-app-${app.id}-dockerfile`}>Dockerfile path</Label>
          <Input
            id={`pk-app-${app.id}-dockerfile`}
            value={app.dockerfile}
            onChange={(event) => onChange(app.id, { dockerfile: event.target.value })}
            placeholder="path/to/Dockerfile"
            aria-invalid={hasFieldError(issues, app.id, "dockerfile")}
            className={cn("mt-2 font-mono", invalidClass(issues, app.id, "dockerfile"))}
          />
          <p className="mt-1 text-2xs text-text-secondary">Path to your Dockerfile, relative to the build context.</p>
          <FieldMessages issues={issues} draftId={app.id} field="dockerfile" />
        </div>
      ) : undefined}

      {app.buildMode === "runtime" ? <ManualEditor app={app} issues={issues} onChange={onChange} /> : undefined}
    </div>
  );
}

function ManualEditor({ app, issues, onChange }: BuildModeSectionProps) {
  const spec = PREVIEWKIT_RUNTIME_CATALOG[app.runtime];

  function selectRuntime(id: PreviewkitRuntime) {
    const previous = PREVIEWKIT_RUNTIME_CATALOG[app.runtime];
    const next = PREVIEWKIT_RUNTIME_CATALOG[id];
    const patch: Partial<AppDraft> = { runtime: id, runtimeVersion: "" };
    // Replace the build script / entrypoint with the new runtime's defaults only
    // when the user hasn't diverged from the previous runtime's defaults.
    if (app.buildScript.trim() === "" || app.buildScript === previous.defaultBuildScript) {
      patch.buildScript = next.defaultBuildScript;
    }
    if (app.entrypoint.trim() === "" || app.entrypoint === previous.defaultEntrypoint) {
      patch.entrypoint = next.defaultEntrypoint;
    }
    onChange(app.id, patch);
  }

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-5">
        <RuntimeTiles runtimes={PREVIEWKIT_RUNTIMES} selected={app.runtime} onSelect={selectRuntime} />

        <div className="max-w-xs">
          <Label htmlFor={`pk-app-${app.id}-runtime-version`}>Version</Label>
          <Input
            id={`pk-app-${app.id}-runtime-version`}
            list={`pk-app-${app.id}-runtime-versions`}
            value={app.runtimeVersion}
            placeholder={spec.defaultVersion}
            onChange={(event) => onChange(app.id, { runtimeVersion: event.target.value })}
            aria-invalid={hasFieldError(issues, app.id, "runtimeVersion")}
            className={cn("mt-2 font-mono", invalidClass(issues, app.id, "runtimeVersion"))}
          />
          <datalist id={`pk-app-${app.id}-runtime-versions`}>
            {spec.versions.map((version) => (
              <option key={version} value={version} />
            ))}
          </datalist>
          <p className="mt-1 text-2xs text-text-secondary">
            {spec.label} tag. Blank uses {spec.defaultVersion}; any published tag works.
          </p>
          <FieldMessages issues={issues} draftId={app.id} field="runtimeVersion" />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`pk-app-${app.id}-build-script`}>Build script</Label>
            <Badge variant="outline" className="font-mono text-4xs uppercase">
              bash
            </Badge>
          </div>
          <Textarea
            id={`pk-app-${app.id}-build-script`}
            rows={4}
            value={app.buildScript}
            placeholder={spec.defaultBuildScript}
            onChange={(event) => onChange(app.id, { buildScript: event.target.value })}
            className="mt-2 font-mono text-2xs"
          />
          <p className="mt-1 text-2xs text-text-secondary">Runs at image build, from the repo root. Optional.</p>
          <FieldMessages issues={issues} draftId={app.id} field="buildScript" />
        </div>

        <div>
          <Label htmlFor={`pk-app-${app.id}-entrypoint`}>Entrypoint</Label>
          <Input
            id={`pk-app-${app.id}-entrypoint`}
            value={app.entrypoint}
            placeholder={spec.defaultEntrypoint}
            onChange={(event) => onChange(app.id, { entrypoint: event.target.value })}
            aria-invalid={hasFieldError(issues, app.id, "entrypoint")}
            className={cn("mt-2 font-mono", invalidClass(issues, app.id, "entrypoint"))}
          />
          <p className="mt-1 text-2xs text-text-secondary">The command that starts the container.</p>
          <FieldMessages issues={issues} draftId={app.id} field="entrypoint" />
        </div>
      </div>

      <SpecRail app={app} spec={spec} />
    </div>
  );
}

function RuntimeTiles({
  runtimes,
  selected,
  onSelect,
}: {
  runtimes: readonly PreviewkitRuntimeSpec[];
  selected: PreviewkitRuntime;
  onSelect: (id: PreviewkitRuntime) => void;
}) {
  return (
    <div>
      <Label>Runtime</Label>
      <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-3">
        {runtimes.map((runtime) => {
          const active = runtime.id === selected;
          return (
            <button
              key={runtime.id}
              type="button"
              onClick={() => onSelect(runtime.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border-dim bg-surface-void hover:border-border-mid hover:bg-surface-raised",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-11 w-12 shrink-0 items-center justify-center font-mono text-sm font-bold",
                  active ? "bg-primary text-primary-foreground" : "bg-surface-raised text-text-secondary",
                )}
              >
                {runtime.abbr}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-text-primary">{runtime.label}</span>
                <span className="block font-mono text-3xs text-text-secondary">
                  {runtime.raw ? "bare image" : runtime.defaultVersion}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-2xs text-text-secondary">
        Pick a language, or Debian for a bare image you set up yourself.
      </p>
    </div>
  );
}

function SpecRail({ app, spec }: { app: AppDraft; spec: PreviewkitRuntimeSpec }) {
  const [showToolbelt, setShowToolbelt] = useState(false);
  const nameDisplay = app.name.trim() === "" ? "untitled-app" : app.name.trim();
  const image = previewkitRuntimeImage(
    app.runtime,
    app.runtimeVersion.trim() === "" ? undefined : app.runtimeVersion.trim(),
  );
  const entrypoint = app.entrypoint.trim() === "" ? spec.defaultEntrypoint : app.entrypoint.trim();
  // Drop any common-toolbelt entry the runtime already lists as a primary tool so
  // it is not shown twice (e.g. make appears in both for some runtimes).
  const toolbelt = PREVIEWKIT_TOOLBELT[spec.base].display.filter((tool) => !spec.tools.includes(tool));

  return (
    <div className="h-fit border border-border-dim bg-surface-base lg:sticky lg:top-20">
      <div className="flex items-center gap-2 border-b border-border-dim px-4 py-2.5">
        <span className="size-1.5 bg-primary" />
        <span className="font-mono text-3xs font-bold uppercase tracking-widest text-text-secondary">Build spec</span>
      </div>
      <div className="space-y-2 px-4 py-3 font-mono text-2xs">
        <SpecRow label="runtime">
          <span className="text-primary-ink">
            {spec.label} · {app.runtimeVersion.trim() === "" ? spec.defaultVersion : app.runtimeVersion.trim()}
          </span>
        </SpecRow>
        <SpecRow label="image">
          <a
            href={spec.dockerHubUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 truncate text-text-primary underline decoration-dotted underline-offset-2 hover:text-primary-ink"
          >
            {image}
            <ArrowSquareOutIcon size={11} className="shrink-0" />
          </a>
        </SpecRow>
        <SpecRow label="context">
          <span className="text-text-primary">repo root</span>
        </SpecRow>
        <SpecRow label="workdir">
          <span className="truncate text-text-primary">/workspace/{nameDisplay}</span>
        </SpecRow>
        <SpecRow label="entry">
          <span className="truncate text-text-primary">{entrypoint}</span>
        </SpecRow>
      </div>
      <div className="border-t border-border-dim px-4 py-3">
        <p className="font-mono text-4xs font-bold uppercase tracking-widest text-text-secondary">Installed for you</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {spec.tools.map((tool) => (
            <ToolChip key={tool} tool={tool} />
          ))}
          {showToolbelt ? toolbelt.map((tool) => <ToolChip key={tool} tool={tool} dim />) : undefined}
        </div>
        {toolbelt.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowToolbelt(!showToolbelt)}
            className="mt-2 font-mono text-4xs uppercase tracking-widest text-primary-ink hover:opacity-80"
          >
            {showToolbelt ? "Show less" : `+ ${toolbelt.length} common tools`}
          </button>
        ) : undefined}
      </div>
    </div>
  );
}

function SpecRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="w-14 shrink-0 text-text-secondary">{label}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function ToolChip({ tool, dim = false }: { tool: string; dim?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border border-border-mid px-1.5 py-0.5 font-mono text-4xs",
        dim ? "text-text-secondary" : "text-text-primary",
      )}
    >
      <span className={cn("size-1", dim ? "bg-border-highlight" : "bg-primary")} />
      {tool}
    </span>
  );
}

function hasFieldError(issues: DraftIssues, draftId: number, field: AppDraftField): boolean {
  return issues.fieldErrors.has(fieldIssueKey(draftId, field));
}

function invalidClass(issues: DraftIssues, draftId: number, field: AppDraftField): string | undefined {
  return hasFieldError(issues, draftId, field) ? "border-status-critical" : undefined;
}
