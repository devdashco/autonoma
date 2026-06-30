import type { LanguageModel } from "ai";
import { loadGitignorePatterns } from "../core/gitignore";
import { buildBashTool } from "./bash";
import { buildGlobTool } from "./glob";
import { buildGrepTool } from "./grep";
import { buildListDirectoryTool } from "./list-directory";
import { buildReadFileTool } from "./read-file";
import { buildSubagentTool } from "./subagent";
import { buildWriteFileTool } from "./write-file";

export async function buildCodebaseTools(
    model: LanguageModel,
    projectRoot: string,
    outputDir: string,
    onHeartbeat?: () => void,
    onFileRead?: (path: string) => void,
) {
    const ignorePatterns = await loadGitignorePatterns(projectRoot);

    return {
        read_file: buildReadFileTool(projectRoot),
        read_output: buildReadFileTool(outputDir),
        write_file: buildWriteFileTool(outputDir),
        glob: buildGlobTool(projectRoot, ignorePatterns),
        grep: buildGrepTool(projectRoot),
        bash: buildBashTool(projectRoot),
        list_directory: await buildListDirectoryTool(projectRoot),
        subagent: buildSubagentTool(model, projectRoot, onHeartbeat, onFileRead),
    };
}

export {
    buildBashTool,
    buildGlobTool,
    buildGrepTool,
    buildListDirectoryTool,
    buildReadFileTool,
    buildSubagentTool,
    buildWriteFileTool,
};

export { buildAskUserTool } from "./ask-user";
