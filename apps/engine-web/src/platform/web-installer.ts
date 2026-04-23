import { Installer } from "@autonoma/engine";
import { getScreenshotConfig } from "@autonoma/image";
import type { Browser, BrowserContext, Page } from "playwright";
import z from "zod";
import { ActivePageManager } from "./active-page-manager";
import { PlaywrightApplicationDriver } from "./drivers/playwright-application.driver";
import { PlaywrightClipboardDriver } from "./drivers/playwright-clipboard.driver";
import { PlaywrightKeyboardDriver } from "./drivers/playwright-keyboard.driver";
import { PlaywrightMouseDriver } from "./drivers/playwright-mouse.driver";
import { PlaywrightNavigationDriver } from "./drivers/playwright-navigation.driver";
import { PlaywrightScreenDriver } from "./drivers/playwright-screen.driver";
import { PlaywrightImageStream } from "./playwright-image-stream";
import type { WebApplicationData } from "./web-application-data";
import type { WebContext } from "./web-context";
import { WebVideoRecorder } from "./web-video-recorder";

export class WebInstaller extends Installer<WebApplicationData, WebContext> {
    readonly paramsSchema = z.object({
        url: z.string(),
        file: z.string().optional(),
        cookies: z
            .array(
                z.object({
                    name: z.string(),
                    value: z.string(),
                    url: z.string().optional(),
                    domain: z.string().optional(),
                    path: z.string().optional(),
                    expires: z.number().optional(),
                    httpOnly: z.boolean().optional(),
                    secure: z.boolean().optional(),
                    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
                    partitionKey: z.string().optional(),
                }),
            )
            .optional(),
        headers: z.record(z.string(), z.string()).optional(),
    });

    constructor(
        private readonly browser: Browser,
        private readonly context: BrowserContext,
    ) {
        super();
    }

    protected async buildContext({ url, file, cookies, headers }: WebApplicationData) {
        this.logger.info("Building web context for test case", { url });

        if (cookies != null && cookies.length > 0) {
            this.logger.info("Applying scenario auth cookies", {
                cookieCount: cookies.length,
                shapes: cookies.map((c) => ({
                    name: c.name,
                    url: c.url,
                    domain: c.domain,
                    path: c.path,
                    sameSite: c.sameSite,
                    httpOnly: c.httpOnly,
                    secure: c.secure,
                })),
            });
            await this.context.addCookies(cookies);
            const storedBeforeNavigation = await this.context.cookies();
            this.logger.info("Scenario auth cookies applied", {
                requestedCount: cookies.length,
                storedCount: storedBeforeNavigation.length,
                storedNames: storedBeforeNavigation.map((c) => c.name),
                storedDomains: storedBeforeNavigation.map((c) => c.domain),
            });
        }

        if (headers != null && Object.keys(headers).length > 0) {
            await this.context.setExtraHTTPHeaders(headers);
            this.logger.info("Scenario auth headers applied", { headerCount: Object.keys(headers).length });
        }

        const page = await this.context.newPage();
        const pageManager = new ActivePageManager(page, this.context);

        if (file != null) {
            this.attachUploadListener(page, file);
            pageManager.onPageChange((newPage) => this.attachUploadListener(newPage, file));
        }

        const { screenResolution } = getScreenshotConfig();
        if (screenResolution == null) throw new Error("Screen resolution not found");

        const context = {
            screen: new PlaywrightScreenDriver(pageManager),
            mouse: new PlaywrightMouseDriver(pageManager, screenResolution),
            keyboard: new PlaywrightKeyboardDriver(pageManager),
            clipboard: new PlaywrightClipboardDriver(pageManager),
            application: new PlaywrightApplicationDriver(pageManager),
            navigation: new PlaywrightNavigationDriver(pageManager),
        };

        // Navigate to the URL
        await context.navigation.navigate(url);

        if (cookies != null && cookies.length > 0) {
            const storedAfterNavigation = await this.context.cookies(url);
            this.logger.info("Cookies visible to target URL after navigation", {
                url,
                storedCount: storedAfterNavigation.length,
                storedNames: storedAfterNavigation.map((c) => c.name),
            });
        }

        return {
            context,
            imageStream: new PlaywrightImageStream(pageManager),
            // Note: WebVideoRecorder is tied to the initial page because Playwright's video
            // API records per-page. New tabs opened during the test are not included in
            // this recording. Supporting multi-tab video would require FFmpeg screen capture.
            videoRecorder: new WebVideoRecorder(page),
        };
    }

    private attachUploadListener(page: Page, file: string) {
        page.on("filechooser", async (fileChooser) => {
            await fileChooser.setFiles(file);
        });
    }

    async cleanup(): Promise<void> {
        try {
            this.logger.info("Cleaning up browser context");
            await this.context.close();
        } catch (error) {
            this.logger.fatal("Error closing browser context", error);
        }

        try {
            this.logger.info("Cleaning up browser");
            await this.browser.close();
        } catch (error) {
            this.logger.fatal("Error closing browser", error);
        }
    }
}
