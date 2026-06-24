import { StringDecoder } from "node:string_decoder";

/**
 * Splits a streamed byte sequence into complete lines and forwards each (minus
 * its trailing newline) to `onLine` as it arrives. A trailing partial line is
 * held until the next chunk; `flush` emits whatever remains once the stream
 * ends. A StringDecoder keeps multi-byte UTF-8 characters that straddle a chunk
 * boundary intact. A no-op when `onLine` is absent.
 */
export function makeLineRelay(
    stream: "stdout" | "stderr",
    onLine?: (stream: "stdout" | "stderr", line: string) => void,
) {
    const decoder = new StringDecoder("utf-8");
    let partial = "";
    return {
        push(chunk: Buffer): void {
            if (onLine == null) return;
            partial += decoder.write(chunk);
            const lastNewline = partial.lastIndexOf("\n");
            if (lastNewline === -1) return;
            const complete = partial.slice(0, lastNewline);
            partial = partial.slice(lastNewline + 1);
            for (const line of complete.split("\n")) onLine(stream, line);
        },
        flush(): void {
            if (onLine == null) return;
            partial += decoder.end();
            if (partial.length > 0) {
                onLine(stream, partial);
                partial = "";
            }
        },
    };
}
