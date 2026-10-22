import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string;
  timedOut: boolean;
  durationMs: number;
  error: string | null;
  truncated: boolean;
}

export interface RunCommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputChars?: number;
  keepOutput?: "head" | "tail";
}

const DEFAULT_MAX_OUTPUT_CHARS = 64_000;

function appendCapped(
  current: string,
  chunk: string,
  maxChars: number,
  keep: "head" | "tail",
): { value: string; truncated: boolean } {
  if (maxChars <= 0) return { value: "", truncated: current.length + chunk.length > 0 };

  const combined = current + chunk;
  if (combined.length <= maxChars) {
    return { value: combined, truncated: false };
  }

  return {
    value:
      keep === "head"
        ? combined.slice(0, maxChars)
        : combined.slice(combined.length - maxChars),
    truncated: true,
  };
}

export function runCommand(
  file: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const keep = options.keepOutput ?? "tail";
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let spawnError: string | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, options.timeoutMs);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        output: [stdout, stderr].filter(Boolean).join("\n"),
        timedOut,
        durationMs: Date.now() - startedAt,
        error: spawnError,
        truncated,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const next = appendCapped(stdout, chunk.toString("utf8"), maxChars, keep);
      stdout = next.value;
      truncated = truncated || next.truncated;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const next = appendCapped(stderr, chunk.toString("utf8"), maxChars, keep);
      stderr = next.value;
      truncated = truncated || next.truncated;
    });
    child.on("error", (error) => {
      spawnError = error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
