import { z } from "zod";
import { ScenarioRecipesFileSchema } from "./scenarios";

export const SetupEventTypeSchema = z.enum([
    "step.started",
    "step.completed",
    "file.read",
    "file.created",
    "log",
    "error",
]);
export type SetupEventType = z.infer<typeof SetupEventTypeSchema>;

export const SetupStepNames = [
    "SDK Integration",
    "Knowledge Base",
    "Scenarios",
    "E2E Tests",
    "Scenario Validation",
] as const;

export const TOTAL_SETUP_STEPS = SetupStepNames.length;

const StepDataSchema = z.object({
    step: z
        .number()
        .int()
        .min(0)
        .max(TOTAL_SETUP_STEPS - 1),
    name: z.string(),
});

const FileDataSchema = z.object({
    filePath: z.string(),
});

const MessageDataSchema = z.object({
    message: z.string(),
});

export const SetupEventBodySchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("step.started"), data: StepDataSchema }),
    z.object({ type: z.literal("step.completed"), data: StepDataSchema }),
    z.object({ type: z.literal("file.read"), data: FileDataSchema }),
    z.object({ type: z.literal("file.created"), data: FileDataSchema }),
    z.object({ type: z.literal("log"), data: MessageDataSchema }),
    z.object({ type: z.literal("error"), data: MessageDataSchema }),
]);
export type SetupEventBody = z.infer<typeof SetupEventBodySchema>;

export const CreateSetupBodySchema = z.object({
    applicationId: z.string(),
    repoName: z.string().optional(),
});
export type CreateSetupBody = z.infer<typeof CreateSetupBodySchema>;

export const UpdateSetupBodySchema = z.object({
    name: z.string().optional(),
    status: z.enum(["completed", "partial_failure", "failed"]).optional(),
    errorMessage: z.string().optional(),
});
export type UpdateSetupBody = z.infer<typeof UpdateSetupBodySchema>;

export const SetupStatusSchema = z.enum(["running", "completed", "partial_failure", "failed"]);
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

const UploadFileSchema = z.object({
    name: z.string(),
    content: z.string(),
    folder: z.string().optional(),
});

export const UploadArtifactsBodySchema = z.object({
    skills: z.array(UploadFileSchema).optional(),
    testCases: z.array(UploadFileSchema).optional(),
    artifacts: z.array(UploadFileSchema).optional(),
});
export type UploadArtifactsBody = z.infer<typeof UploadArtifactsBodySchema>;

/** Canonical body for `POST /v1/setup/setups/:id/scenario-recipe-versions`. */
export const UploadScenarioRecipeVersionsBodySchema = ScenarioRecipesFileSchema;
export type UploadScenarioRecipeVersionsBody = z.infer<typeof UploadScenarioRecipeVersionsBodySchema>;
