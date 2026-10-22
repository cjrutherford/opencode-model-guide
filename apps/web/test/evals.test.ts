import { describe, expect, it } from "vitest";

import {
  summarizeEvalRun,
  type EvalAttempt,
  type EvalLanguage,
  type EvalModel,
  type EvalMode,
  type EvalRun,
  type EvalStatus,
  type EvalTaskDescriptor,
  type EvalsFile,
} from "@omg/shared";

import {
  buildEvalTaskMatrix,
  findEvalModel,
  latestRunByMode,
  modelEvalResults,
  primaryModelEvalBadge,
  sortRunModels,
  type EvalModelRef,
} from "../src/lib/evals";
import {
  formatCount,
  formatDuration,
  formatPassRate,
} from "../src/lib/format";

const START = "2026-10-22T12:00:00.000Z";
const HASH = "a".repeat(64);

function task(id: string, language: EvalLanguage = "ts"): EvalTaskDescriptor {
  return {
    id,
    language,
    version: 1,
    prompt: `Fix ${id}.`,
    promptSha256: HASH,
    repoSha256: HASH,
    publicTestCommand: "pnpm test",
    hiddenTestCommand: "node hidden-test.mjs",
    timeoutMs: 600_000,
  };
}

const alpha: EvalModel = {
  modelKey: "opencode/alpha",
  name: "Alpha",
  provider: "opencode",
  id: "alpha",
  freeKind: "limited-time",
  context: 128_000,
  inputPrice: 0,
  outputPrice: 0,
};

const goAlpha: EvalModel = {
  ...alpha,
  modelKey: "opencode-go/alpha",
  provider: "opencode-go",
};

const beta: EvalModel = {
  ...alpha,
  modelKey: "opencode/beta",
  name: "Beta",
  id: "beta",
};

function ref(model: EvalModel): EvalModelRef {
  return { key: model.modelKey, id: model.id, provider: model.provider };
}

function attempt(
  model: EvalModel,
  taskId: string,
  status: EvalStatus,
  index = 0,
): EvalAttempt {
  const skipped = status === "skipped";
  return {
    id: `${model.modelKey}:${taskId}:${index}`,
    modelKey: model.modelKey,
    taskId,
    repeat: 1,
    status,
    startedAt: new Date(Date.parse(START) + index * 1_000).toISOString(),
    finishedAt: skipped
      ? null
      : new Date(Date.parse(START) + index * 1_000 + 900).toISOString(),
    durationMs: skipped ? 0 : 900 + index,
    testDurationMs: skipped ? null : 100,
    inputTokens: skipped ? null : 100,
    outputTokens: skipped ? null : 20,
    cachedInputTokens: null,
    reasoningTokens: null,
    costUsd: skipped ? null : 0,
    turns: skipped ? null : 1,
    toolCalls: null,
    patchSha256: skipped ? null : "b".repeat(64),
    diffLinesAdded: skipped ? null : 1,
    diffLinesRemoved: skipped ? null : 0,
    testExitCode: status === "passed" ? 0 : status === "failed" ? 1 : null,
    error: skipped ? "model_not_found" : null,
    failureOutput: status === "failed" ? "assertion failed" : null,
  };
}

function makeRun(options: {
  id?: string;
  mode?: EvalMode;
  startedAt?: string;
  models?: EvalModel[];
  tasks?: EvalTaskDescriptor[];
  statuses?: EvalStatus[];
  attempts?: EvalAttempt[];
} = {}): EvalRun {
  const models = options.models ?? [alpha];
  const tasks = options.tasks ?? [task("one")];
  const statuses = options.statuses ?? ["passed"];
  const attempts =
    options.attempts ??
    statuses.map((status, index) =>
      attempt(models[0]!, tasks[index]?.id ?? tasks[0]!.id, status, index),
    );
  const plannedAttempts = models.length * tasks.length;
  const status =
    attempts.length === plannedAttempts && attempts.length > 0
      ? "complete"
      : "partial";
  const run: EvalRun = {
    id: options.id ?? "run-01",
    mode: options.mode ?? "agent",
    status,
    startedAt: options.startedAt ?? START,
    finishedAt: status === "complete" ? START : null,
    harnessVersion: "0.0.0",
    corpusVersion: "1",
    snapshotGeneratedAt: START,
    snapshotSha256: HASH,
    opencodeVersion: "1.18.30",
    sandbox: {
      image: "omg-eval-sandbox:local",
      digest: `sha256:${HASH}`,
      platform: "linux/amd64",
    },
    limits: {
      attemptTimeoutMs: 600_000,
      runTimeoutMs: 18_000_000,
      maxWorkspaceBytes: 16_777_216,
    },
    access: "free",
    repeats: 1,
    plannedAttempts,
    models,
    tasks,
    attempts,
    summaries: [],
  };
  run.summaries = summarizeEvalRun(run);
  return run;
}

function evalsFile(runs: EvalRun[]): EvalsFile {
  return {
    schemaVersion: 1,
    generatedAt: runs[0]?.startedAt ?? START,
    runs,
  };
}

describe("eval run selection", () => {
  it("selects the latest run for each mode independently", () => {
    const oldAgent = makeRun({
      id: "agent-old",
      mode: "agent",
      startedAt: "2026-10-20T12:00:00.000Z",
    });
    const newAgent = makeRun({
      id: "agent-new",
      mode: "agent",
      startedAt: "2026-10-22T12:00:00.000Z",
    });
    const patch = makeRun({
      id: "patch",
      mode: "direct-patch",
      startedAt: "2026-10-21T12:00:00.000Z",
    });
    const file = evalsFile([newAgent, patch, oldAgent]);

    expect(latestRunByMode(file, "agent")?.id).toBe("agent-new");
    expect(latestRunByMode(file, "direct-patch")?.id).toBe("patch");
  });

  it("returns null for an empty file", () => {
    const file = evalsFile([]);

    expect(latestRunByMode(file, "agent")).toBeNull();
    expect(primaryModelEvalBadge(file, ref(alpha))).toBeNull();
  });
});

describe("eval badges and model matching", () => {
  const tasks = Array.from({ length: 12 }, (_, index) => task(`task-${index}`));

  it("uses passed/total tasks and prefers agent mode", () => {
    const agent = makeRun({
      id: "agent",
      mode: "agent",
      tasks,
      statuses: [
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "failed",
        "failed",
        "failed",
        "failed",
        "failed",
      ],
      startedAt: "2026-10-20T12:00:00.000Z",
    });
    const patch = makeRun({
      id: "patch",
      mode: "direct-patch",
      tasks,
      statuses: [
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "failed",
        "failed",
        "failed",
        "failed",
      ],
      startedAt: "2026-10-22T12:00:00.000Z",
    });
    const file = evalsFile([patch, agent]);

    const results = modelEvalResults(file, ref(alpha));
    expect(results.map((result) => result.run.mode)).toEqual([
      "agent",
      "direct-patch",
    ]);
    expect(primaryModelEvalBadge(file, ref(alpha))).toMatchObject({
      mode: "agent",
      label: "Eval 7/12",
      passed: 7,
      totalAttempts: 12,
    });
  });

  it("labels a direct-patch-only model as Patch", () => {
    const patch = makeRun({
      id: "patch",
      mode: "direct-patch",
      tasks,
      statuses: [
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "passed",
        "failed",
        "failed",
        "failed",
        "failed",
      ],
    });

    expect(primaryModelEvalBadge(evalsFile([patch]), ref(alpha))).toMatchObject({
      mode: "direct-patch",
      label: "Patch 8/12",
    });
  });

  it("matches an exact model key before falling back to the model id", () => {
    const run = makeRun({
      models: [alpha, goAlpha],
      tasks: [task("one")],
      attempts: [
        attempt(alpha, "one", "passed"),
        attempt(goAlpha, "one", "failed", 1),
      ],
    });

    expect(findEvalModel(run, ref(goAlpha))?.model.modelKey).toBe("opencode-go/alpha");
    expect(findEvalModel(run, { ...ref(goAlpha), key: "other/alpha" })?.model.modelKey).toBe(
      "opencode/alpha",
    );
  });

  it("does not invent a badge when the latest run does not cover the model", () => {
    const run = makeRun({ models: [alpha], tasks: [task("one")] });

    expect(primaryModelEvalBadge(evalsFile([run]), ref(beta))).toBeNull();
  });
});

describe("eval task matrix", () => {
  it("maps each status to a labeled cell and leaves missing attempts not run", () => {
    const tasks = Array.from({ length: 7 }, (_, index) => task(`task-${index}`));
    const run = makeRun({
      tasks,
      statuses: [
        "passed",
        "failed",
        "patch_failed",
        "error",
        "timeout",
        "skipped",
      ],
    });
    const rows = buildEvalTaskMatrix(run);

    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.cells[0]!.label)).toEqual([
      "Pass",
      "Fail",
      "Patch fail",
      "Error",
      "Timeout",
      "Skipped",
      "Not run",
    ]);
    expect(rows.map((row) => row.cells[0]!.tone)).toEqual([
      "good",
      "bad",
      "bad",
      "warn",
      "warn",
      "muted",
      "muted",
    ]);
    expect(rows[3]!.cells[0]!.title).toContain("0/1 completed");
  });
});

describe("eval summary ordering", () => {
  it("sorts by completed attempts, then pass rate, then token efficiency", () => {
    const tasks = [task("one"), task("two")];
    const run = makeRun({
      models: [alpha, beta],
      tasks,
      attempts: [
        attempt(alpha, "one", "passed"),
        attempt(alpha, "two", "passed", 1),
        attempt(beta, "one", "passed", 2),
        attempt(beta, "two", "failed", 3),
      ],
    });
    const entries = sortRunModels(run);

    expect(entries.map((entry) => entry.model.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("eval formatters", () => {
  it("keeps missing values explicit", () => {
    expect(formatPassRate(null)).toBe("—");
    expect(formatPassRate(0)).toBe("0%");
    expect(formatPassRate(7 / 12)).toBe("58%");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(500)).toBe("500 ms");
    expect(formatDuration(1_500)).toBe("1.5 s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatCount(null)).toBe("—");
    expect(formatCount(1_200)).toBe("1,200");
  });
});
