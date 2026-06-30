/**
 * The extra fields Node's `child_process` attaches to the error it throws when
 * a spawned command fails (non-zero exit, timeout, ...). The error is typed
 * `unknown` in a catch clause, so this reads each field defensively - no type
 * assertion, and any field whose runtime type doesn't match comes back as
 * undefined rather than a lie.
 */
export interface ExecErrorFields {
    code?: number;
    stdout?: string;
    stderr?: string;
    killed?: boolean;
}

export function readExecError(error: unknown): ExecErrorFields {
    if (typeof error !== "object" || error === null) return {};
    const code = Reflect.get(error, "code");
    const stdout = Reflect.get(error, "stdout");
    const stderr = Reflect.get(error, "stderr");
    const killed = Reflect.get(error, "killed");
    return {
        code: typeof code === "number" ? code : undefined,
        stdout: typeof stdout === "string" ? stdout : undefined,
        stderr: typeof stderr === "string" ? stderr : undefined,
        killed: typeof killed === "boolean" ? killed : undefined,
    };
}
