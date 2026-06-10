export const TaskQueue = {
    WEB: "web",
    MOBILE: "mobile",
    GENERAL: "general",
    DIFFS: "diffs",
    PREVIEWKIT: "previewkit",
} as const;

export type TaskQueue = (typeof TaskQueue)[keyof typeof TaskQueue];
