import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PatchError, applyPatch, patchSha256 } from "./patch";
import type { CommandResult } from "./process";
import { runCommand } from "./process";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MAX_OUTPUT_CHARS = 4_096;
const COMMAND_MAX_OUTPUT_CHARS = 64_000;

const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export type TestStageStatus =
  | "passed"
  | "failed"
  | "patch_failed"
  | "error"
  | "timeout";

export interface TestCommandExecutor {
  run(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<CommandResult>;
}

export const localTestExecutor: TestCommandExecutor = {
  run(command, cwd, env, timeoutMs) {
    return runCommand("bash", ["-lc", command], {
      cwd,
      env,
      timeoutMs,
      maxOutputChars: COMMAND_MAX_OUTPUT_CHARS,
      keepOutput: "tail",
    });
  },
};

export interface TestStageOptions {
  repoDir: string;
  hiddenDir: string;
  patch: string;
  hiddenTestCommand: string;
  timeoutMs: number;
  maxOutputChars?: number;
  env?: NodeJS.ProcessEnv;
  executor?: TestCommandExecutor;
  tempRoot?: string;
}

export interface TestStageResult {
  status: TestStageStatus;
  testExitCode: number | null;
  testDurationMs: number | null;
  failureOutput: string | null;
  patchApplied: boolean;
  patchSha256: string;
  error: string | null;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function capOutput(
  value: string,
  maxChars = DEFAULT_MAX_OUTPUT_CHARS,
): string {
  const clean = stripAnsi(value);
  if (clean.length <= maxChars) return clean;
  return clean.slice(clean.length - maxChars);
}

async function copyContents(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    await cp(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      force: true,
      dereference: false,
    });
  }
}

function outputOrError(output: string, error: string): string {
  return capOutput(output.trim().length > 0 ? output : error);
}

export async function runTestStage(
  options: TestStageOptions,
): Promise<TestStageResult> {
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const executor = options.executor ?? localTestExecutor;
  const sha256 = patchSha256(options.patch);
  const root = await mkdtemp(
    join(options.tempRoot ?? tmpdir(), "omg-eval-test-"),
  );
  const workspace = join(root, "workspace");
  const home = join(root, "home");

  try {
    await mkdir(home, { recursive: true });
    await copyContents(options.repoDir, workspace);

    let applyResult;
    try {
      applyResult = await applyPatch(workspace, options.patch);
    } catch (error) {
      if (error instanceof PatchError) {
        return {
          status: "patch_failed",
          testExitCode: null,
          testDurationMs: null,
          failureOutput: capOutput(error.message, maxOutputChars),
          patchApplied: false,
          patchSha256: sha256,
          error: `patch_${error.code}`,
        };
      }
      throw error;
    }

    if (!applyResult.applied) {
      return {
        status: "patch_failed",
        testExitCode: null,
        testDurationMs: null,
        failureOutput: outputOrError(
          applyResult.output,
          "patch did not apply",
        ).slice(-maxOutputChars),
        patchApplied: false,
        patchSha256: sha256,
        error: "patch_apply_failed",
      };
    }

    await copyContents(options.hiddenDir, workspace);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
      HOME: home,
      GOCACHE: join(home, "go-cache"),
      GOMODCACHE: join(home, "go-mod"),
      PYTHONDONTWRITEBYTECODE: "1",
      CI: "1",
      NO_COLOR: "1",
      ...options.env,
    };

    let result: CommandResult;
    try {
      result = await executor.run(
        options.hiddenTestCommand,
        workspace,
        env,
        options.timeoutMs,
      );
    } catch (error) {
      return {
        status: "error",
        testExitCode: null,
        testDurationMs: null,
        failureOutput: capOutput(
          error instanceof Error ? error.message : String(error),
          maxOutputChars,
        ),
        patchApplied: true,
        patchSha256: sha256,
        error: "test_runner_error",
      };
    }

    if (result.timedOut) {
      return {
        status: "timeout",
        testExitCode: null,
        testDurationMs: result.durationMs,
        failureOutput: capOutput(result.output, maxOutputChars),
        patchApplied: true,
        patchSha256: sha256,
        error: "timeout",
      };
    }

    if (result.error) {
      return {
        status: "error",
        testExitCode: result.exitCode,
        testDurationMs: result.durationMs,
        failureOutput: capOutput(result.error, maxOutputChars),
        patchApplied: true,
        patchSha256: sha256,
        error: "test_runner_error",
      };
    }

    if (result.exitCode === 0) {
      return {
        status: "passed",
        testExitCode: 0,
        testDurationMs: result.durationMs,
        failureOutput: null,
        patchApplied: true,
        patchSha256: sha256,
        error: null,
      };
    }

    return {
      status: "failed",
      testExitCode: result.exitCode,
      testDurationMs: result.durationMs,
      failureOutput: capOutput(result.output, maxOutputChars),
      patchApplied: true,
      patchSha256: sha256,
      error: null,
    };
  } catch (error) {
    return {
      status: "error",
      testExitCode: null,
      testDurationMs: null,
      failureOutput: capOutput(
        error instanceof Error ? error.message : String(error),
        maxOutputChars,
      ),
      patchApplied: false,
      patchSha256: sha256,
      error: "test_workspace_error",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
