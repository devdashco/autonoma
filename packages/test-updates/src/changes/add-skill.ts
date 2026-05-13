import { type ApplyChangeParams, TestSuiteChange } from "./test-suite-change";

export interface AddSkillParams {
    name: string;
    description: string;
    plan: string;
}

export class AddSkill extends TestSuiteChange<AddSkillParams, { skillId: string; planId: string }> {
    async apply({ snapshotDraft }: ApplyChangeParams): Promise<{ skillId: string; planId: string }> {
        return snapshotDraft.addSkill(this.params);
    }
}
