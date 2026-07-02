import { integrationTestSuite } from "@autonoma/integration-test";
import { expect, vi } from "vitest";
import type { ResendOnboardingService } from "../../src/signup-hooks/resend.service";
import { SignupHooks } from "../../src/signup-hooks/signup-hooks";
import { OnboardingTestHarness } from "../onboarding/onboarding-harness";

function createTestSignupHooks() {
    const hooks = new SignupHooks({
        resendApiKey: "re_test",
        resendAudienceId: "aud_test",
        resendFromEmail: "test@autonoma.app",
        calLink: "https://cal.com/test",
        discordInviteUrl: "https://discord.gg/test",
    });

    const resend = (hooks as unknown as { resend: ResendOnboardingService }).resend;
    const addToNewsletterSpy = vi.spyOn(resend, "addToNewsletterAudience").mockResolvedValue(undefined);
    const sendWelcomeEmailSpy = vi.spyOn(resend, "sendWelcomeEmail").mockResolvedValue(undefined);

    return { hooks, addToNewsletterSpy, sendWelcomeEmailSpy };
}

async function createUser(harness: OnboardingTestHarness) {
    const ts = Date.now();
    const orgId = await harness.createOrg();
    const user = await harness.db.user.create({
        data: { name: "Test User", email: `test-${ts}-${Math.random()}@example.com` },
    });
    return { orgId, user };
}

function makeParams(db: unknown, userId: string, email: string, orgId: string) {
    return {
        db: db as never,
        userId,
        email,
        name: "Test User",
        organizationId: orgId,
        orgName: "Test Org",
        orgSlug: "test-org",
    };
}

integrationTestSuite({
    name: "SignupHooks - race condition fix",
    createHarness: () => OnboardingTestHarness.create(),
    seed: async () => ({}),
    cases: (test) => {
        test("onUserCreated is idempotent - second call is a no-op", async ({ harness }) => {
            const { orgId, user } = await createUser(harness);
            const { hooks, addToNewsletterSpy, sendWelcomeEmailSpy } = createTestSignupHooks();
            const params = makeParams(harness.db, user.id, user.email, orgId);

            await hooks.onUserCreated(params);
            addToNewsletterSpy.mockClear();
            sendWelcomeEmailSpy.mockClear();

            await hooks.onUserCreated(params);

            expect(addToNewsletterSpy).not.toHaveBeenCalled();
            expect(sendWelcomeEmailSpy).not.toHaveBeenCalled();
        });

        test("onUserAuthenticated is idempotent after onUserCreated already ran", async ({ harness }) => {
            const { orgId, user } = await createUser(harness);
            const { hooks, addToNewsletterSpy, sendWelcomeEmailSpy } = createTestSignupHooks();
            const params = makeParams(harness.db, user.id, user.email, orgId);

            await hooks.onUserCreated(params);
            addToNewsletterSpy.mockClear();
            sendWelcomeEmailSpy.mockClear();

            await hooks.onUserAuthenticated(params);

            expect(addToNewsletterSpy).not.toHaveBeenCalled();
            expect(sendWelcomeEmailSpy).not.toHaveBeenCalled();
        });
    },
});
