export interface RunStepData {
    order: number;
    interaction: string;
    params: unknown;
    output: unknown;
    screenshotBeforeKey?: string;
    screenshotAfterKey?: string;
}

export interface RunContext {
    runId: string;
    organizationId: string;
    testPlanPrompt: string;
    testCaseName: string;
    steps: RunStepData[];
    videoS3Key?: string;
    finalScreenshotKey?: string;
}
