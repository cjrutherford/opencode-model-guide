import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SnapshotSchema,
  summarizeEvalRun,
  type EvalAttempt,
  type EvalModel,
  type EvalRun,
  type EvalStatus,
  type EvalTaskDescriptor,
  type ModelRecord,
  type Snapshot,
} from "@omg/shared";

import {
  AgentAbortError,
  runAgentAttempt,
  type AgentAttemptResult,
} from "./adapters/agent";
import {
  DirectPatchAbortError,
  runDirectPatchAttempt,
  type DirectPatchAttemptResult,
} from "./adapters/directPatch";
import {
  DEFAULT_RETRIES,
  formatUsage,
  generateRunId,
  parseArgs,
  type EvalArgs,
} from "./args";
import { loadCorpus, sha256Hex, type LoadedCorpus, type LoadedCorpusTask } from "./corpus";
import {
  DEFAULT_EVALS_PATH,
  commitRun,
  readEvalsFile,
  runIdExists,
} from "./dataFile";
import { selectFreeModels } from "./models";
import { PatchError, capturePatch } from "./patch";
import { renderAgentPrompt } from "./prompt";
import { runCommand } from "./process";
import { createDockerTestExecutor } from "./sandbox/testContainer";
import {
  docker,
  ensureControlNetwork,
  ensureNetwork,
  inspectImage,
  removeNetwork,
  uniqueName,
} from "./sandbox/docker";
import {
  startEgressTunnelContainer,
  type EgressTunnelContainerHandle,
} from "./sandbox/egressTunnelContainer";
import { runTestStage, type TestCommandExecutor } from "./testRunner";
import { emptyUsage, type NormalizedUsage } from "./usage";
import {
  DEFAULT_RUNS_ROOT,
  RunStore,
} from "./runStore";

export const HARNESS_VERSION = "s14";
export const DEFAULT_IMAGE = "omg-eval-sandbox:local";
export const DEFAULT_SNAPSHOT_PATH = "data/snapshot.json";
export const DEFAULT_RUN_TIMEOUT_MS = 5 * 60 * 60_000;
export const DEFAULT_WORKSPACE_BYTES = 512 * 1024 * 1024;

const MAX_ERROR_CHARS = 2_000;
const MAX_FAILURE_OUTPUT_CHARS = 4_096;

export interface PlannedAttempt {
  id: string;
  model: EvalModel;
  task: LoadedCorpusTask;
  repeat: number;
}

export interface AttemptExecution {
  status: EvalStatus;
  skipReason: "model_not_found" | null;
  usage: NormalizedUsage;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  testDurationMs?: number | null;
  patchSha256?: string | null;
  diffLinesAdded?: number | null;
  diffLinesRemoved?: number | null;
  testExitCode?: number | null;
  error?: string | null;
  failureOutput?: string | null;
}

export type AttemptExecutor = (
  plan: PlannedAttempt,
) => Promise<AttemptExecution>;

export interface OnProgress {
  (message: string): void;
}

export interface ExecuteRunOptions {
  store: RunStore;
  plans: PlannedAttempt[];
  executor: AttemptExecutor;
  commit: boolean;
  dataPath?: string;
  retries?: number;
  retryDelayMs?: number;
  runTimeoutMs?: number;
  now?: () => Date;
  log?: OnProgress;
}

export interface ExecuteRunResult {
  run: EvalRun;
  committed: boolean;
  aborted: boolean;
  error: string | null;
}

export interface RunSkeletonOptions {
  id: string;
  mode: EvalArgs["mode"];
  models: EvalModel[];
  tasks: LoadedCorpusTask[];
  repeats: number;
  snapshotGeneratedAt: string;
  snapshotSha256: string;
  opencodeVersion: string;
  sandbox: EvalRun["sandbox"];
  harnessVersion?: string;
  attemptTimeoutMs?: number;
  runTimeoutMs?: number;
  maxWorkspaceBytes?: number;
  now?: Date;
  notes?: string;
}

function cap(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return cap(error.message, MAX_ERROR_CHARS);
  if (typeof error === "string") return cap(error, MAX_ERROR_CHARS);
  try {
    return cap(JSON.stringify(error) ?? "unknown error", MAX_ERROR_CHARS);
  } catch {
    return "unknown error";
  }
}

function isAuthAbort(error: unknown): boolean {
  return (
    error instanceof AgentAbortError ||
    error instanceof DirectPatchAbortError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "auth")
  );
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function skippedExecution(
  at: string,
  error = "model_not_found",
  skipReason: AttemptExecution["skipReason"] = "model_not_found",
): AttemptExecution {
  return {
    status: "skipped",
    skipReason,
    usage: emptyUsage(),
    startedAt: at,
    finishedAt: at,
    durationMs: 0,
    error,
  };
}

function errorExecution(error: unknown, at: string): AttemptExecution {
  return {
    status: "error",
    skipReason: null,
    usage: emptyUsage(),
    startedAt: at,
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    error: errorText(error),
  };
}

export function toTaskDescriptor(task: LoadedCorpusTask): EvalTaskDescriptor {
  return {
    id: task.manifest.id,
    language: task.manifest.language,
    version: task.manifest.version,
    prompt: task.manifest.prompt,
    promptSha256: task.promptSha256,
    repoSha256: task.repoSha256,
    publicTestCommand: task.manifest.publicTestCommand,
    hiddenTestCommand: task.manifest.hiddenTestCommand,
    timeoutMs: task.manifest.timeoutMs,
  };
}

export function createRunSkeleton(options: RunSkeletonOptions): EvalRun {
  const now = options.now ?? new Date();
  const models = options.models;
  const tasks = options.tasks;
  const plannedAttempts = models.length * tasks.length * options.repeats;
  const attemptTimeoutMs =
    options.attemptTimeoutMs ??
    Math.max(...tasks.map((task) => task.manifest.timeoutMs));

  const run: EvalRun = {
    id: options.id,
    mode: options.mode,
    status: "partial",
    startedAt: now.toISOString(),
    finishedAt: null,
    harnessVersion: options.harnessVersion ?? HARNESS_VERSION,
    // main replaces this with the loaded corpus version before the store is
    // created. Keeping it explicit prevents a guessed value from being
    // mistaken for a verified corpus version.
    corpusVersion: "unknown",
    snapshotGeneratedAt: options.snapshotGeneratedAt,
    snapshotSha256: options.snapshotSha256,
    opencodeVersion: options.opencodeVersion,
    sandbox: options.sandbox,
    limits: {
      attemptTimeoutMs,
      runTimeoutMs: options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
      maxWorkspaceBytes:
        options.maxWorkspaceBytes ?? DEFAULT_WORKSPACE_BYTES,
    },
    access: "free",
    repeats: options.repeats,
    plannedAttempts,
    models,
    tasks: tasks.map(toTaskDescriptor),
    attempts: [],
    summaries: summarizeEvalRun({ models, attempts: [] }),
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };

  return run;
}

/**
 * The corpus version is not part of LoadedCorpusTask. Keep it explicit so a
 * run skeleton cannot accidentally record a guessed value.
 */
export function withCorpusVersion(
  run: EvalRun,
  corpusVersion: string,
): EvalRun {
  return { ...run, corpusVersion };
}

export function selectTasks(
  corpus: LoadedCorpus,
  selection: "all" | string[],
): LoadedCorpusTask[] {
  if (selection === "all") return [...corpus.tasks];

  const byId = new Map(
    corpus.tasks.map((task) => [task.manifest.id, task] as const),
  );
  const selected: LoadedCorpusTask[] = [];
  const seen = new Set<string>();

  for (const id of selection) {
    if (seen.has(id)) throw new Error(`duplicate task id: ${id}`);
    seen.add(id);
    const task = byId.get(id);
    if (!task) throw new Error(`unknown task id: ${id}`);
    selected.push(task);
  }

  return selected;
}

export function planAttempts(
  models: EvalModel[],
  tasks: LoadedCorpusTask[],
  repeats: number,
): PlannedAttempt[] {
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error("repeats must be a positive integer");
  }

  const plans: PlannedAttempt[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    for (const task of tasks) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        const id = `${model.modelKey}:${task.manifest.id}:${repeat}`;
        if (seen.has(id)) throw new Error(`duplicate attempt id: ${id}`);
        seen.add(id);
        plans.push({ id, model, task, repeat });
      }
    }
  }

  return plans;
}

function executionToAttempt(
  plan: PlannedAttempt,
  execution: AttemptExecution,
): EvalAttempt {
  const computedCost =
    execution.usage.inputTokens !== null &&
    execution.usage.outputTokens !== null
      ? (execution.usage.inputTokens / 1_000_000) * plan.model.inputPrice +
        (execution.usage.outputTokens / 1_000_000) * plan.model.outputPrice
      : null;
  const attempt: EvalAttempt = {
    id: plan.id,
    modelKey: plan.model.modelKey,
    taskId: plan.task.manifest.id,
    repeat: plan.repeat,
    status: execution.status,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationMs: Math.max(0, Math.round(execution.durationMs)),
    testDurationMs: execution.testDurationMs ?? null,
    inputTokens: execution.usage.inputTokens,
    outputTokens: execution.usage.outputTokens,
    cachedInputTokens: execution.usage.cachedInputTokens,
    reasoningTokens: execution.usage.reasoningTokens,
    costUsd: execution.usage.costUsd ?? computedCost,
    turns: execution.usage.turns,
    toolCalls: execution.usage.toolCalls,
    patchSha256: execution.patchSha256 ?? null,
    diffLinesAdded: execution.diffLinesAdded ?? null,
    diffLinesRemoved: execution.diffLinesRemoved ?? null,
    testExitCode: execution.testExitCode ?? null,
    error:
      execution.error === undefined || execution.error === null
        ? null
        : cap(execution.error, MAX_ERROR_CHARS),
    failureOutput:
      execution.failureOutput === undefined || execution.failureOutput === null
        ? null
        : cap(execution.failureOutput, MAX_FAILURE_OUTPUT_CHARS),
  };

  return attempt;
}

function isTerminal(attempt: EvalAttempt | undefined): boolean {
  return Boolean(attempt && attempt.finishedAt !== null);
}

export async function executePlannedRun(
  options: ExecuteRunOptions,
): Promise<ExecuteRunResult> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const retries = options.retries ?? 0;
  // Free-tier capacity errors and upstream 5xx responses are transient, so
  // space retries out instead of hammering the same endpoint immediately.
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  const runTimeoutMs =
    options.runTimeoutMs ?? options.store.run.limits.runTimeoutMs;
  const dataPath = options.dataPath ?? DEFAULT_EVALS_PATH;

  if (options.plans.length !== options.store.run.plannedAttempts) {
    throw new Error(
      `planned attempts ${options.plans.length} do not match run metadata ${options.store.run.plannedAttempts}`,
    );
  }

  const existing = new Map(
    options.store.run.attempts.map((attempt) => [attempt.id, attempt] as const),
  );
  const plannedIds = new Set(options.plans.map((plan) => plan.id));
  for (const attempt of existing.values()) {
    if (!plannedIds.has(attempt.id)) {
      throw new Error(
        `stored attempt is not part of the planned run: ${attempt.id}`,
      );
    }
  }

  const skipModels = new Set<string>();
  for (const attempt of existing.values()) {
    if (
      isTerminal(attempt) &&
      attempt.status === "skipped" &&
      attempt.error === "model_not_found"
    ) {
      skipModels.add(attempt.modelKey);
    }
  }

  const finished = new Set(
    [...existing.values()]
      .filter((attempt) => isTerminal(attempt))
      .map((attempt) => attempt.id),
  );

  const runStartedAtMs = new Date(options.store.run.startedAt).getTime();
  let runTimedOut = options.store.run.attempts.some(
    (attempt) => attempt.status === "skipped" && attempt.error === "run_timeout",
  );

  for (let index = 0; index < options.plans.length; index += 1) {
    const plan = options.plans[index]!;
    if (finished.has(plan.id)) {
      log(`skip terminal attempt ${plan.id}`);
      continue;
    }

    if (now().getTime() - runStartedAtMs > runTimeoutMs) {
      runTimedOut = true;
      log("run timeout reached; marking remaining attempts skipped");
      for (const remaining of options.plans.slice(index)) {
        if (finished.has(remaining.id)) continue;
        const attempt = executionToAttempt(
          remaining,
          skippedExecution(nowIso(now), "run_timeout", null),
        );
        await options.store.recordAttempt(attempt);
        finished.add(remaining.id);
        log(`skip ${remaining.id}: run_timeout`);
      }
      break;
    }

    if (skipModels.has(plan.model.modelKey)) {
      const at = nowIso(now);
      const attempt = executionToAttempt(plan, skippedExecution(at));
      await options.store.recordAttempt(attempt);
      finished.add(plan.id);
      log(`skip ${plan.id}: model_not_found`);
      continue;
    }

    let execution: AttemptExecution | null = null;
    let lastError: unknown = null;

    for (let round = 0; round <= retries; round += 1) {
      try {
        execution = await options.executor(plan);
        lastError = null;
      } catch (error) {
        if (isAuthAbort(error)) {
          const message = `authentication failure: ${errorText(error)}`;
          await options.store.finish("failed", message);
          return {
            run: options.store.run,
            committed: false,
            aborted: true,
            error: message,
          };
        }
        lastError = error;
        execution = errorExecution(error, nowIso(now));
      }

      if (execution.status !== "error" || round === retries) break;
      const waitMs = retryDelayMs * 2 ** round;
      log(
        `retry ${plan.id} after error: ${execution.error ?? "unknown error"} (waiting ${waitMs}ms)`,
      );
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    if (!execution) {
      execution = errorExecution(lastError, nowIso(now));
    }

    if (
      execution.status === "skipped" &&
      execution.skipReason === "model_not_found"
    ) {
      skipModels.add(plan.model.modelKey);
    }

    const attempt = executionToAttempt(plan, execution);
    await options.store.recordAttempt(attempt);
    finished.add(plan.id);
    log(
      `attempt ${plan.id}: ${attempt.status}` +
        (attempt.error ? ` (${attempt.error})` : ""),
    );
  }

  const complete =
    !runTimedOut &&
    options.store.run.attempts.length === options.store.run.plannedAttempts;
  await options.store.finish(
    runTimedOut ? "partial" : complete ? "complete" : "partial",
  );

  let committed = false;
  if (options.commit) {
    await commitRun(options.store.run, dataPath);
    committed = true;
  }

  return {
    run: options.store.run,
    committed,
    aborted: false,
    error: null,
  };
}

export async function readSnapshotFile(
  path = DEFAULT_SNAPSHOT_PATH,
): Promise<{ snapshot: Snapshot; sha256: string }> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in ${path}: ${errorText(error)}`);
  }
  const snapshot = SnapshotSchema.parse(parsed);
  return { snapshot, sha256: sha256Hex(raw) };
}

async function copyContents(
  source: string,
  destination: string,
): Promise<void> {
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

async function initGitBaseline(workspace: string): Promise<void> {
  const commands: Array<[string, string[]]> = [
    ["git", ["init", "--quiet"]],
    ["git", ["config", "user.email", "eval@example.invalid"]],
    ["git", ["config", "user.name", "Eval Harness"]],
    ["git", ["config", "commit.gpgsign", "false"]],
    ["git", ["add", "-A"]],
    ["git", ["commit", "--quiet", "-m", "baseline"]],
  ];

  for (const [command, args] of commands) {
    const result = await runCommand(command, args, {
      cwd: workspace,
      timeoutMs: 30_000,
      maxOutputChars: 16_000,
      keepOutput: "tail",
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed while preparing baseline: ${result.output.slice(-1_000)}`,
      );
    }
  }
}

function workKey(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 20);
}

export interface LiveExecutorOptions {
  mode: EvalArgs["mode"];
  store: RunStore;
  image: string;
  network: string;
  controlNetwork: string;
  agentEgressUrl?: string;
  directProxyUrl?: string;
  apiKey: string;
  testExecutor: TestCommandExecutor;
  modelRecords: Map<string, ModelRecord>;
  log?: OnProgress;
}

function agentStatusToExecution(
  result: AgentAttemptResult,
  test?: Awaited<ReturnType<typeof runTestStage>> | null,
  captured?: Awaited<ReturnType<typeof capturePatch>> | null,
): AttemptExecution {
  const status: EvalStatus =
    result.status === "completed"
      ? test?.status === "passed"
        ? "passed"
        : test?.status === "failed"
          ? "failed"
          : test?.status === "patch_failed"
            ? "patch_failed"
            : test?.status === "timeout"
              ? "timeout"
              : "error"
      : result.status === "skipped"
        ? "skipped"
        : result.status;

  return {
    status,
    skipReason: result.skipReason,
    usage: result.usage,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    testDurationMs: test?.testDurationMs ?? null,
    patchSha256: captured?.sha256 ?? test?.patchSha256 ?? null,
    diffLinesAdded: captured?.linesAdded ?? null,
    diffLinesRemoved: captured?.linesRemoved ?? null,
    testExitCode: test?.testExitCode ?? null,
    error: test?.error ?? result.error,
    failureOutput: test?.failureOutput ?? null,
  };
}

export function createLiveAttemptExecutor(
  options: LiveExecutorOptions,
): AttemptExecutor {
  return async (plan) => {
    if (options.mode === "direct-patch") {
      if (!options.directProxyUrl) {
        throw new Error("direct-patch mode requires the inference proxy");
      }
      const result: DirectPatchAttemptResult = await runDirectPatchAttempt({
        attemptId: plan.id,
        model: plan.model,
        task: {
          prompt: plan.task.manifest.prompt,
          repoDir: plan.task.repoDir,
          hiddenDir: plan.task.hiddenDir,
          hiddenTestCommand: plan.task.manifest.hiddenTestCommand,
          timeoutMs: plan.task.manifest.timeoutMs,
        },
        baseUrl: options.directProxyUrl,
        testTimeoutMs: plan.task.manifest.timeoutMs,
        testExecutor: options.testExecutor,
      });

      if (result.patch) {
        await options.store.writeArtifact(plan.id, "patch.diff", result.patch);
      }

      return {
        status: result.status,
        skipReason: result.skipReason,
        usage: result.usage,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        testDurationMs: result.test?.testDurationMs ?? null,
        patchSha256: result.patchSha256,
        diffLinesAdded: result.diffLinesAdded,
        diffLinesRemoved: result.diffLinesRemoved,
        testExitCode: result.test?.testExitCode ?? null,
        error: result.error,
        failureOutput: result.test?.failureOutput ?? null,
      };
    }

    const workRoot = join(
      options.store.runDir,
      "work",
      workKey(plan.id),
    );
    const workspace = join(workRoot, "workspace");
    const capture = join(workRoot, "capture");
    const rendered = renderAgentPrompt({
      id: plan.task.manifest.id,
      language: plan.task.manifest.language,
      prompt: plan.task.manifest.prompt,
      publicTestCommand: plan.task.manifest.publicTestCommand,
    });
    const record = options.modelRecords.get(plan.model.modelKey);

    try {
      await copyContents(plan.task.repoDir, workspace);
      await writeFile(join(workspace, "TASK.md"), rendered.taskMarkdown, "utf8");
      await initGitBaseline(workspace);

      const result = await runAgentAttempt({
        attemptId: plan.id,
        model: plan.model,
        prompt: rendered.prompt,
        workspaceDir: workspace,
        captureDir: capture,
        image: options.image,
        network: options.network,
        controlNetwork: options.controlNetwork,
        timeoutMs: plan.task.manifest.timeoutMs,
        apiKey: options.apiKey,
        egressProxyUrl: options.agentEgressUrl,
        modelMetadata: record
          ? {
              output: record.limits.output,
              reasoning: record.capabilities.reasoning,
              attachment: record.capabilities.attachment,
              toolCall: record.capabilities.toolCall,
            }
          : undefined,
      });

      if (result.logs) {
        await options.store.writeArtifact(plan.id, "agent.log", result.logs);
      }

      if (result.status !== "completed") {
        if (result.status === "timeout") {
          try {
            const captured = await capturePatch(capture);
            if (captured.patch) {
              await options.store.writeArtifact(
                plan.id,
                "patch.diff",
                captured.patch,
              );
            }
          } catch {
            // Diagnostics are best effort for a timed-out attempt.
          }
        }
        return agentStatusToExecution(result);
      }

      let captured;
      try {
        captured = await capturePatch(capture);
      } catch (error) {
        const code = error instanceof PatchError ? error.code : "capture_failed";
        return {
          status: "patch_failed",
          skipReason: null,
          usage: result.usage,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          durationMs: result.durationMs,
          error: `patch_${code}`,
        };
      }

      if (captured.patch) {
        await options.store.writeArtifact(
          plan.id,
          "patch.diff",
          captured.patch,
        );
      }

      const test = await runTestStage({
        repoDir: plan.task.repoDir,
        hiddenDir: plan.task.hiddenDir,
        patch: captured.patch,
        hiddenTestCommand: plan.task.manifest.hiddenTestCommand,
        timeoutMs: plan.task.manifest.timeoutMs,
        executor: options.testExecutor,
      });

      if (test.failureOutput) {
        await options.store.writeArtifact(
          plan.id,
          "test-output.txt",
          test.failureOutput,
        );
      }

      return agentStatusToExecution(result, test, captured);
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

async function readOpencodeVersion(image: string): Promise<string> {
  const result = await docker(
    [
      "run",
      "--rm",
      "--entrypoint",
      "/bin/bash",
      image,
      "-lc",
      "opencode --version",
    ],
    { timeoutMs: 60_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `could not read OpenCode version from ${image}: ${result.output.slice(-2_000)}`,
    );
  }
  const version = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!version) throw new Error(`OpenCode version is empty for ${image}`);
  return version;
}

async function existingRunIds(
  runsRoot: string,
  dataPath: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const run of (await readEvalsFile(dataPath)).runs) ids.add(run.id);

  try {
    for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      (error as { code?: string }).code !== "ENOENT"
    ) {
      throw error;
    }
  }

  return ids;
}

function validateResumeSelection(
  args: EvalArgs,
  run: EvalRun,
  corpus: LoadedCorpus,
): LoadedCorpusTask[] {
  if (args.mode !== run.mode) {
    throw new Error(
      `resume mode mismatch: run is ${run.mode}, command requested ${args.mode}`,
    );
  }
  if (args.repeats !== run.repeats) {
    throw new Error(
      `resume repeats mismatch: run has ${run.repeats}, command requested ${args.repeats}`,
    );
  }

  if (Array.isArray(args.models)) {
    const requested = [...args.models].sort();
    const stored = run.models.map((model) => model.modelKey).sort();
    if (JSON.stringify(requested) !== JSON.stringify(stored)) {
      throw new Error("resume model selection does not match the stored run");
    }
  }

  const taskIds =
    args.tasks === "all"
      ? run.tasks.map((task) => task.id)
      : [...args.tasks];
  const byId = new Map(
    corpus.tasks.map((task) => [task.manifest.id, task] as const),
  );
  const selected: LoadedCorpusTask[] = [];

  for (const descriptor of run.tasks) {
    if (!taskIds.includes(descriptor.id)) {
      throw new Error(
        `stored task ${descriptor.id} is not part of the requested task selection`,
      );
    }
    const current = byId.get(descriptor.id);
    if (!current) {
      throw new Error(`task no longer exists in the corpus: ${descriptor.id}`);
    }
    if (
      current.promptSha256 !== descriptor.promptSha256 ||
      current.repoSha256 !== descriptor.repoSha256 ||
      current.manifest.hiddenTestCommand !== descriptor.hiddenTestCommand
    ) {
      throw new Error(
        `corpus changed since the run started: ${descriptor.id}`,
      );
    }
    selected.push(current);
  }

  const ordered = args.tasks === "all" ? selected : taskIds.map((id) => {
    const task = selected.find(
      (candidate) => candidate.manifest.id === id,
    );
    if (!task) throw new Error(`task not in stored run: ${id}`);
    return task;
  });

  return ordered;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(formatUsage());
    return;
  }

  const args = parseArgs(argv);
  if (args.mode === "direct-patch") {
    throw new Error(
      "direct-patch mode is not supported with free-tier models: raw chat-completion requests are rejected by OpenCode's client gate. Use --mode agent. A one-shot OpenCode direct-patch adapter is pending.",
    );
  }
  const now = new Date();
  const runsRoot = process.env.OMG_EVAL_RUNS_ROOT ?? DEFAULT_RUNS_ROOT;
  const dataPath = process.env.OMG_EVAL_DATA_PATH ?? DEFAULT_EVALS_PATH;
  const snapshotPath =
    process.env.OMG_EVAL_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
  const image = process.env.OMG_EVAL_IMAGE ?? DEFAULT_IMAGE;
  const corpus = loadCorpus();
  const { snapshot, sha256: snapshotSha256 } = await readSnapshotFile(
    snapshotPath,
  );

  const runId =
    args.resume ??
    args.runId ??
    generateRunId(args.mode, now, await existingRunIds(runsRoot, dataPath));

  let store: RunStore;
  let plans: PlannedAttempt[];
  let runTimeoutMs: number;

  if (args.resume) {
    store = await RunStore.resume(runId, runsRoot);
    const tasks = validateResumeSelection(args, store.run, corpus);
    plans = planAttempts(store.run.models, tasks, store.run.repeats);
    runTimeoutMs = store.run.limits.runTimeoutMs;
  } else {
    if (await runIdExists(runId, dataPath)) {
      throw new Error(`run id already exists in ${dataPath}: ${runId}`);
    }

    const models = selectFreeModels(snapshot, {
      modelKeys: args.models === "all-free" ? undefined : args.models,
    });
    const tasks = selectTasks(corpus, args.tasks);
    const imageInfo = await inspectImage(image);
    if (!imageInfo) {
      throw new Error(
        `sandbox image is not built: ${image}. Run pnpm eval:build-image first.`,
      );
    }
    const opencodeVersion = await readOpencodeVersion(image);
    const skeleton = withCorpusVersion(
      createRunSkeleton({
        id: runId,
        mode: args.mode,
        models,
        tasks,
        repeats: args.repeats,
        snapshotGeneratedAt: snapshot.generatedAt,
        snapshotSha256,
        opencodeVersion,
        sandbox: {
          image,
          digest: imageInfo.id,
          platform: imageInfo.platform,
        },
        now,
      }),
      corpus.corpusVersion,
    );
    store = await RunStore.create(skeleton, runsRoot);
    plans = planAttempts(models, tasks, args.repeats);
    runTimeoutMs = skeleton.limits.runTimeoutMs;
  }

  const missing = plans.some(
    (plan) =>
      !store.run.attempts.some(
        (attempt) =>
          attempt.id === plan.id && attempt.finishedAt !== null,
      ),
  );

  if (!missing) {
    const result = await executePlannedRun({
      store,
      plans,
      executor: async () => {
        throw new Error("no missing attempts should be executed");
      },
      commit: args.commit,
      dataPath,
      retries: 0,
      runTimeoutMs,
      log: (message) => console.log(message),
    });
    console.log(
      `run ${result.run.id}: ${result.run.status} (${result.run.attempts.length}/${result.run.plannedAttempts} attempts, ${result.committed ? "committed" : "not committed"})`,
    );
    return;
  }

  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENCODE_API_KEY is missing. Add it to .secrets or the environment; agent attempts receive it only inside the disposable container.",
    );
  }

  const network = uniqueName("omg-eval-net");
  const controlNetwork = uniqueName("omg-eval-control");
  await ensureNetwork(network);
  await ensureControlNetwork(controlNetwork);

  let tunnel: EgressTunnelContainerHandle | null = null;
  try {
    tunnel = await startEgressTunnelContainer({
      image,
      name: uniqueName("omg-eval-tunnel"),
      network,
      controlNetwork,
    });

    const modelRecords = new Map(
      snapshot.models.map((model) => [model.key, model] as const),
    );
    const executor = createLiveAttemptExecutor({
      mode: store.run.mode,
      store,
      image,
      network,
      controlNetwork,
      agentEgressUrl: tunnel.url,
      apiKey,
      testExecutor: createDockerTestExecutor({
        image,
        namePrefix: "omg-eval-test",
      }),
      modelRecords,
      log: (message) => console.log(message),
    });

    const result = await executePlannedRun({
      store,
      plans,
      executor,
      commit: args.commit,
      dataPath,
      retries: args.retries ?? DEFAULT_RETRIES,
      runTimeoutMs,
      log: (message) => console.log(message),
    });

    if (result.aborted) {
      process.stderr.write(`${result.error ?? "run aborted"}\n`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `run ${result.run.id}: ${result.run.status} (${result.run.attempts.length}/${result.run.plannedAttempts} attempts, ${result.committed ? "committed" : "not committed"})`,
    );
  } finally {
    await tunnel?.stop();
    await removeNetwork(network);
    await removeNetwork(controlNetwork);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
