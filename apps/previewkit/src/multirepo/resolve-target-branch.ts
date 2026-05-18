import type { BranchConvention } from "../config/schema";

export function resolveTargetBranch(
    headRef: string,
    convention: BranchConvention | undefined,
    fallbackBranch: string,
): string {
    if (convention == null) {
        return fallbackBranch;
    }

    switch (convention.type) {
        case "manual":
            return fallbackBranch;
        case "same_branch_name":
            return headRef;
        case "regex": {
            const regex = new RegExp(convention.pattern);
            return regex.test(headRef) ? headRef.replace(regex, convention.replacement) : fallbackBranch;
        }
        default: {
            const _: never = convention;
            throw new Error(`Unhandled branch convention type: ${JSON.stringify(_)}`);
        }
    }
}
