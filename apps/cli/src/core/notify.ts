import { execFile } from "node:child_process";
import { platform } from "node:os";

export function notify(title: string, message: string): void {
    process.stderr.write("\x07");

    const os = platform();
    if (os === "darwin") {
        execFile(
            "osascript",
            ["-e", `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`],
            () => {},
        );
    } else if (os === "linux") {
        execFile("notify-send", [title, message], () => {});
    }
}
