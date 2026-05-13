import { db } from "@autonoma/db";

/**
 * Stamps `appliedAt` on a RefinementAction row. The id is optional so apply*
 * activities can be invoked outside the refinement loop (where there is no
 * action row to update); pass undefined to skip.
 */
export async function markActionApplied(refinementActionId?: string): Promise<void> {
    if (refinementActionId == null) return;
    await db.refinementAction.update({
        where: { id: refinementActionId },
        data: { appliedAt: new Date() },
    });
}
