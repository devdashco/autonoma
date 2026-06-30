import { existsSync } from "fs";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { buildDefaultStepLogger, runAgent } from "../../core/agent";
import { getModel } from "../../core/model";
import { buildCodebaseTools } from "../../tools";

export interface PageFinderGeneratorInput {
    projectRoot: string;
    modelId?: string;
    nonInteractive?: boolean;
    outputDir: string;
    extraMessage?: string;
}

const Page = z.object({
    route: z.string().min(1),
    path: z.string().min(1),
    description: z.string().min(10),
});
type Page = z.infer<typeof Page>;

class PageCollector {
    // the key is the path
    readonly pages = new Map<string, Page>();

    addPage(page: Page): void {
        if (this.pages.has(page.path)) {
            console.warn(`page with path ${page.path} was already set. overwritting`);
        }
        this.pages.set(page.path, page);
    }

    viewPages(): string {
        return Array.from(this.pages)
            .sort(([, aValue], [, bValue]) => aValue.path.localeCompare(bValue.path))
            .join("\n");
    }

    static from(obj: unknown): Page | Error {
        const result = Page.safeParse(obj);
        if (!result.success) return result.error;

        const data = result.data;

        const foundPath = path.resolve(data.path);
        if (!existsSync(foundPath)) {
            return new Error(`resolved path ${foundPath} from returned path ${data.path} didn't exist`);
        }

        return data;
    }
}

export async function runPageFinder(input: PageFinderGeneratorInput): Promise<Map<string, Page>> {
    const model = getModel(input.modelId);

    const pageCollector = new PageCollector();

    const { logger, onStepFinish } = buildDefaultStepLogger("pages", 150);

    let prompt = `You need to run the search on this directory ${input.projectRoot}.`;

    if (input.extraMessage != null) {
        prompt += `\n${input.extraMessage}`;
    }

    const agentConfig = {
        id: "pages-finder",
        systemPrompt:
            "You are an agent in charge of finding all the pages in a codebase. You have a set of tools for " +
            "exploring the codebase and you're encouraged to use them extensively. Once you find a page, call the add_page tool.\n\n" +
            "The objective is to capture 100% of all the pages on the codebase. A page is a top-level route that renders a distinct view.\n\n" +
            "Start by understanding which technologies and frameworks the project uses - read config files, package manifests, " +
            "and project structure. Then use glob, grep, and list_directory to find all route/page definitions based on what you discover.\n\n" +
            "Ignore storybooks, docs, and test files. Focus on pages of the main application.\n\n" +
            "For monorepos: identify which package/app is the main frontend application and focus your search there.\n\n" +
            "Consider that list_directory has a default depth of 10 and you WON'T SEE MORE CHILDREN. " +
            "If you do list_directory, drill down to validate there are no more levels.",
        model,
        maxSteps: 150,
        tools: async (heartbeat: () => void) => {
            const tools = await buildCodebaseTools(model, input.projectRoot, input.outputDir, heartbeat);
            return {
                ...tools,
                add_page: tool({
                    description: "use this tool to add a page that you found",
                    inputSchema: Page,
                    execute: (input) => {
                        const pageOrError = PageCollector.from(input);
                        if (pageOrError instanceof Error) {
                            return pageOrError.message;
                        }

                        pageCollector.addPage(pageOrError);

                        return `page ${JSON.stringify(input)} added`;
                    },
                }),
                view_pages: tool({
                    description: "use this tool to view all the pages that you already added",
                    inputSchema: z.object(),
                    execute: () => pageCollector.viewPages(),
                }),
            };
        },
        onStepFinish,
    };

    await runAgent(agentConfig, prompt, () => undefined);
    logger.summary();

    return pageCollector.pages;
}
