import { describe, it, expect } from "vitest";
import { makeLineRelay } from "../../src/deployer/line-relay";

/** Collect everything a relay emits, tagged with its stream, for assertions. */
function collectingRelay(stream: "stdout" | "stderr" = "stdout") {
    const lines: { stream: "stdout" | "stderr"; line: string }[] = [];
    const relay = makeLineRelay(stream, (s, line) => lines.push({ stream: s, line }));
    return { relay, lines };
}

describe("makeLineRelay", () => {
    it("emits each complete line in a chunk, without the trailing newline", () => {
        const { relay, lines } = collectingRelay();
        relay.push(Buffer.from("first\nsecond\nthird\n"));
        expect(lines.map((l) => l.line)).toEqual(["first", "second", "third"]);
    });

    it("does not emit a trailing line until a newline arrives", () => {
        const { relay, lines } = collectingRelay();
        relay.push(Buffer.from("no newline yet"));
        expect(lines).toEqual([]);
    });

    it("joins a line split across two chunks and emits it exactly once", () => {
        const { relay, lines } = collectingRelay();
        relay.push(Buffer.from("hello, "));
        relay.push(Buffer.from("world\n"));
        expect(lines.map((l) => l.line)).toEqual(["hello, world"]);
    });

    it("flush emits a trailing line that never got a newline", () => {
        const { relay, lines } = collectingRelay();
        relay.push(Buffer.from("done\ntail without newline"));
        expect(lines.map((l) => l.line)).toEqual(["done"]);
        relay.flush();
        expect(lines.map((l) => l.line)).toEqual(["done", "tail without newline"]);
    });

    it("flush is a no-op when the buffer is empty (no spurious blank line)", () => {
        const { relay, lines } = collectingRelay();
        relay.push(Buffer.from("line\n"));
        relay.flush();
        expect(lines.map((l) => l.line)).toEqual(["line"]);
    });

    it("preserves blank lines between content", () => {
        const { relay, lines } = collectingRelay();
        relay.push(Buffer.from("a\n\nb\n"));
        expect(lines.map((l) => l.line)).toEqual(["a", "", "b"]);
    });

    it("keeps a multi-byte UTF-8 character intact when it straddles a chunk boundary", () => {
        const { relay, lines } = collectingRelay();
        const euro = Buffer.from("€", "utf-8"); // 3 bytes: e2 82 ac
        relay.push(euro.subarray(0, 2));
        relay.push(euro.subarray(2));
        relay.push(Buffer.from("\n"));
        expect(lines.map((l) => l.line)).toEqual(["€"]);
    });

    it("tags emitted lines with the relay's stream", () => {
        const { relay, lines } = collectingRelay("stderr");
        relay.push(Buffer.from("oops\n"));
        expect(lines).toEqual([{ stream: "stderr", line: "oops" }]);
    });

    it("is a no-op (and never throws) when no onLine callback is given", () => {
        const relay = makeLineRelay("stdout");
        expect(() => {
            relay.push(Buffer.from("ignored\n"));
            relay.flush();
        }).not.toThrow();
    });
});
