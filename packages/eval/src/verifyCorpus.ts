import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { LoadedCorpus, LoadedCorpusTask } from "./corpus";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MAX_OUTPUT_CHARS = 16_384;
const PATCH_TIMEOUT_MS = 30_000;

export type CheckStatus = "pass" | "fail";

export interface CheckResult {
  status: CheckStatus;
  note: string;
  exitCode: number | null;
  output: string;
}

export interface TaskVerification {
  id: string;
  publicBaseline: CheckResult;
  hiddenBaseline: CheckResult;
  solution: CheckResult;
  ok: boolean;
}

export interface CorpusVerification {
  ok: boolean;
  tasks: TaskVerification[];
}

interface ProcessResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

function appendCapped(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > MAX_OUTPUT_CHARS
    ? next.slice(next.length - MAX_OUTPUT_CHARS)
    : next;
}

function runProcess(
  file: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
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
        output: [stdout, stderr].filter(Boolean).join("\n"),
        timedOut,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      stderr = appendCapped(stderr, error.message);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
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

async function makeAttemptDir(
  tempRoot: string,
  task: LoadedCorpusTask,
  includeHidden: boolean,
): Promise<string> {
  const directory = await mkdtemp(join(tempRoot, `${task.manifest.id}-`));
  await copyContents(task.repoDir, directory);
  if (includeHidden) {
    await copyContents(task.hiddenDir, directory);
  }
  return directory;
}

function fail(
  note: string,
  result?: ProcessResult,
): CheckResult {
  return {
    status: "fail",
    note,
    exitCode: result?.exitCode ?? null,
    output: result?.output ?? "",
  };
}

function pass(note: string, result: ProcessResult): CheckResult {
  return {
    status: "pass",
    note,
    exitCode: result.exitCode,
    output: result.output,
  };
}

function checkExpectedFailure(
  label: string,
  expectedMarker: string,
  result: ProcessResult,
): CheckResult {
  if (result.timedOut) {
    return fail(`${label} timed out`, result);
  }
  if (result.exitCode === 0) {
    return fail(`${label} unexpectedly passed`, result);
  }
  if (result.exitCode === null) {
    return fail(`${label} could not run`, result);
  }
  if (!result.output.includes(expectedMarker)) {
    return fail(
      `${label} failed without the expected marker: ${expectedMarker}`,
      result,
    );
  }
  return pass(`${label} failed as expected`, result);
}

export async function verifyCorpus(
  corpus: LoadedCorpus,
): Promise<CorpusVerification> {
  const tempRoot = await mkdtemp(join(tmpdir(), "omg-eval-verify-"));
  const home = join(tempRoot, "home");
  await mkdir(home, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(REPO_ROOT, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    HOME: home,
    GOCACHE: join(home, "go-cache"),
    GOMODCACHE: join(home, "go-mod"),
    PYTHONDONTWRITEBYTECODE: "1",
    CI: "1",
    NO_COLOR: "1",
  };

  const tasks: TaskVerification[] = [];

  try {
    for (const task of corpus.tasks) {
      const timeoutMs = task.manifest.timeoutMs;
      const expected = task.manifest.expectedBaselineFailure;

      const publicDir = await makeAttemptDir(tempRoot, task, false);
      const publicResult = await runProcess(
        "bash",
        ["-lc", task.manifest.publicTestCommand],
        { cwd: publicDir, env, timeoutMs },
      );
      const publicBaseline = checkExpectedFailure(
        "public baseline",
        expected,
        publicResult,
      );

      const hiddenDir = await makeAttemptDir(tempRoot, task, true);
      const hiddenResult = await runProcess(
        "bash",
        ["-lc", task.manifest.hiddenTestCommand],
        { cwd: hiddenDir, env, timeoutMs },
      );
      const hiddenBaseline = checkExpectedFailure(
        "hidden baseline",
        expected,
        hiddenResult,
      );

      const solutionDir = await makeAttemptDir(tempRoot, task, true);
      const patchResult = await runProcess(
        "patch",
        [
          "-p1",
          "--batch",
          "--forward",
          "-i",
          task.solutionPath,
        ],
        { cwd: solutionDir, env, timeoutMs: PATCH_TIMEOUT_MS },
      );

      let solution: CheckResult;
      if (patchResult.timedOut || patchResult.exitCode !== 0) {
        solution = fail(
          "reference solution patch did not apply",
          patchResult,
        );
      } else {
        const solutionResult = await runProcess(
          "bash",
          ["-lc", task.manifest.hiddenTestCommand],
          { cwd: solutionDir, env, timeoutMs },
        );
        if (solutionResult.timedOut) {
          solution = fail("reference solution timed out", solutionResult);
        } else if (solutionResult.exitCode === 0) {
          solution = pass("reference solution passed hidden tests", solutionResult);
        } else {
          solution = fail(
            "reference solution did not pass hidden tests",
            solutionResult,
          );
        }
      }

      tasks.push({
        id: task.manifest.id,
        publicBaseline,
        hiddenBaseline,
        solution,
        ok:
          publicBaseline.status === "pass" &&
          hiddenBaseline.status === "pass" &&
          solution.status === "pass",
      });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  return {
    ok: tasks.every((task) => task.ok),
    tasks,
  };
}
