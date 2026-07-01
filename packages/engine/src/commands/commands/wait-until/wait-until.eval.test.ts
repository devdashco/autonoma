import { VisualConditionChecker } from "@autonoma/ai";
import { describe, expect } from "vitest";
import { baseFakeContext, commandTestFunction } from "../../test-utils/command-test";
import { getTestImage } from "../../test-utils/test-images";
import { testModelRegistry } from "../../test-utils/test-model-registry";
import { WaitUntilCommand, WaitUntilTimeoutError } from "./wait-until.command";

const waitTest = commandTestFunction(baseFakeContext);

describe("WaitUntilCommand", () => {
    const MELI_HOMEPAGE = getTestImage("MELI_HOMEPAGE");
    const KAVAK_HOMEPAGE = getTestImage("KAVAK_HOMEPAGE");
    const KAVAK_HOMEPAGE_SCROLLED = getTestImage("KAVAK_HOMEPAGE_SCROLLED");

    const visualConditionChecker = new VisualConditionChecker({
        model: testModelRegistry.getModel({ model: "smart-visual", tag: "visual-condition" }),
    });

    const waitUntilCommand = new WaitUntilCommand(visualConditionChecker);

    waitTest("resolves immediately when condition is already met", async ({ makeContext }) => {
        const context = makeContext();
        const { screen } = context;
        screen.setScreenshot(MELI_HOMEPAGE);

        const result = await waitUntilCommand.execute(
            { condition: "The Mercado Libre logo is visible", timeout: 3000 },
            context,
        );

        expect(result.conditionMet).toBe(true);
    });

    waitTest("polls until condition is met", async ({ makeContext }) => {
        const context = makeContext();
        const { screen } = context;
        screen.setScreenshot(KAVAK_HOMEPAGE);

        // Switch to the scrolled screenshot after 1.5s so the condition becomes met on retry
        setTimeout(() => screen.setScreenshot(KAVAK_HOMEPAGE_SCROLLED), 1500);

        const result = await waitUntilCommand.execute(
            { condition: "the blue Simular button is visible", timeout: 10000 },
            context,
        );

        expect(result.conditionMet).toBe(true);
    });

    waitTest("throws WaitUntilTimeoutError when condition never met", async ({ makeContext }) => {
        const context = makeContext();
        const { screen } = context;
        screen.setScreenshot(MELI_HOMEPAGE);

        await expect(
            waitUntilCommand.execute({ condition: "a purple elephant is visible", timeout: 2000 }, context),
        ).rejects.toThrow(WaitUntilTimeoutError);
    });
});
