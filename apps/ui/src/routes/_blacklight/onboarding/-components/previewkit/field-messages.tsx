import { fieldIssueKey, type AppDraftField, type DraftIssues } from "./topology-draft";

/** Inline per-field error + warning messages for one app draft field. Shared by the app card and its build editor. */
export function FieldMessages({
  issues,
  draftId,
  field,
}: {
  issues: DraftIssues;
  draftId: number;
  field: AppDraftField;
}) {
  const key = fieldIssueKey(draftId, field);
  const errors = issues.fieldErrors.get(key) ?? [];
  const warnings = issues.fieldWarnings.get(key) ?? [];
  if (errors.length === 0 && warnings.length === 0) return undefined;
  return (
    <div className="mt-1 space-y-1">
      {errors.map((message) => (
        <p key={message} className="text-2xs text-status-critical">
          {message}
        </p>
      ))}
      {warnings.map((message) => (
        <p key={message} className="text-2xs text-status-warn">
          {message}
        </p>
      ))}
    </div>
  );
}
