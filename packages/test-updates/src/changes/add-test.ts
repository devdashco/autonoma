import { type ApplyChangeParams, TestSuiteChange } from "./test-suite-change";

export interface AddTestParams {
    name: string;
    description?: string;
    plan: string;
    folderId: string;
    scenarioId?: string;
    scenarioName?: string;
}

export class AddTest extends TestSuiteChange<AddTestParams, { testCaseId: string; planId: string }> {
    async apply({
        snapshotDraft,
        generationManager,
    }: ApplyChangeParams): Promise<{ testCaseId: string; planId: string }> {
        const { testCaseId, planId } = await snapshotDraft.addTestCase(this.params);

        await generationManager.addJob(planId);

        return { testCaseId, planId };
    }
}
