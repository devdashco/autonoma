import { describe, expect, test } from "vitest";
import { findForbiddenPlaceholder } from "../../src/agents/05-test-generator/tools";

describe("findForbiddenPlaceholder", () => {
    test("accepts steps with only concrete values", () => {
        const steps = `**Steps**
1. click: the "New deal" button
2. type: "Acme Corp" into the Company field
3. assert: text "Acme Corp" is visible in the deals list`;
        expect(findForbiddenPlaceholder(steps)).toBeUndefined();
    });

    test("rejects a {{token}} placeholder (no variable mechanism exists)", () => {
        const steps = `**Steps**
1. type: "{{user_email}}" into the Email field
2. click: the "Save" button`;
        const result = findForbiddenPlaceholder(steps);
        expect(result?.name).toBe("{{token}} placeholder");
        expect(result?.match).toBe("{{user_email}}");
    });

    test("rejects a bare {variable} placeholder", () => {
        const result = findForbiddenPlaceholder(`**Steps**\n1. type: {email} into the field`);
        expect(result?.name).toBe("bare {variable}");
    });

    test("rejects 'Dynamic:' and 'e.g.' placeholders", () => {
        expect(findForbiddenPlaceholder(`**Steps**\n1. assert: Dynamic: some id`)?.name).toBe('"Dynamic:" placeholder');
        expect(findForbiddenPlaceholder(`**Steps**\n1. click: the button (e.g. Save)`)?.name).toBe('"(e.g." example');
    });
});
