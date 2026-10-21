import { describe, expect, it } from "vitest";

import {
  EvalsFileSchema,
  EvalRunSchema,
  summarizeEvalRun,
  wilson95,
  type EvalAttempt,
  type EvalModel,
  type EvalRun,
  type EvalTaskDescriptor,
} from "../src/evals";

const model: EvalModel = {
  modelKey: "opencode/mimo-v2.6-flash-free",
  name: "MiMo-V2.6-Flash Free",
  provider: "opencode",
  id: "mimo-v2.6-flash-free",
  freeKind: "limited-time",
  context: 200_000,
  inputPrice: 0,
  outputPrice: 0,
};

const task: EvalTaskDescriptor = {
  id: "ts-debounce",
  language: "ts",
  version: 1,
  prompt: "Fix the debounce utility.",
  promptSha256: "a".repeat(64),
  repoSha256: "b".repeat(64),
  publicTestCommand: "tsx --test test/public/*.test.ts",
  hiddenTestCommand: "tsx --test test/hidden/*.test.ts",
  timeoutMs: 480_000,
};

function attempt(overrides: Partial<EvalAttempt> = {}): EvalAttempt {
  return {
    id: "opencode/mimo-v2.6-flash-free:ts-debounce:1",
    modelKey: model.modelKey,
    taskId: task.id,
    repeat: 1,
    status: "passed",
    startedAt: "2026-10-21T10:00:00.000Z",
    finishedAt: "2026-10-21T10:01:00.000Z",
    durationMs: 60_000,
    testDurationMs: 1_000,
    inputTokens: 1_000,
    outputTokens: 500,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    turns: 3,
    toolCalls: 2,
    patchSha256: "c".repeat(64),
    diffLinesAdded: 10,
    diffLinesRemoved: 2,
    testExitCode: 0,
    error: null,
    failureOutput: null,
    ...overrides,
  };
}

function runBase(overrides: Partial<EvalRun> = {}): Omit<EvalRun, "summaries"> {
  return {
    id: "2026-10-21-free-agent-01",
    mode: "agent",
    status: "complete",
    startedAt: "2026-10-21T10:00:00.000Z",
    finishedAt: "2026-10-21T11:00:00.000Z",
    harnessVersion: "0.1.0",
    corpusVersion: "2026-10-21.1",
    snapshotGeneratedAt: "2026-10-21T09:00:00.000Z",
    snapshotSha256: "d".repeat(64),
    opencodeVersion: "1.18.30",
    sandbox: {
      image: "omg-eval-sandbox:1",
      digest: `sha256:${"e".repeat(64)}`,
      platform: "linux/amd64",
    },
    limits: {
      attemptTimeoutMs: 480_000,
      runTimeoutMs: 21_600_000,
      maxWorkspaceBytes: 536_870_912,
    },
    access: "free",
    repeats: 1,
    plannedAttempts: 1,
    models: [model],
    tasks: [task],
    attempts: [attempt()],
    ...overrides,
  };
}

function run(overrides: Partial<EvalRun> = {}): EvalRun {
  const base = runBase(overrides);
  return {
    ...base,
    summaries: summarizeEvalRun(base),
    ...overrides,
  };
}

describe("EvalRunSchema", () => {
  it("accepts a complete agent run with matching summaries", () => {
    const parsed = EvalRunSchema.parse(run());

    expect(parsed.mode).toBe("agent");
    expect(parsed.summaries).toHaveLength(1);
    expect(parsed.summaries[0]?.passed).toBe(1);
    expect(parsed.summaries[0]?.completed).toBe(1);
  });

  it("accepts a direct-patch run", () => {
    const parsed = EvalRunSchema.parse(run({ mode: "direct-patch" }));
    expect(parsed.mode).toBe("direct-patch");
  });

  it("rejects duplicate attempt IDs", () => {
    const base = runBase({
      plannedAttempts: 2,
      attempts: [attempt(), attempt()],
    });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow(/duplicate attempt/i);
  });

  it("rejects an attempt that references an unknown model", () => {
    const base = runBase({
      attempts: [attempt({ modelKey: "opencode/unknown" })],
    });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow(/unknown model/i);
  });

  it("rejects an attempt that references an unknown task", () => {
    const base = runBase({
      attempts: [attempt({ taskId: "missing-task" })],
    });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow(/unknown task/i);
  });

  it("rejects summaries that do not match the attempts", () => {
    const valid = run();
    const tampered = {
      ...valid,
      summaries: [
        {
          ...valid.summaries[0]!,
          passed: 0,
          failed: 1,
          passRate: 0,
        },
      ],
    };

    expect(() => EvalRunSchema.parse(tampered)).toThrow(/summary/i);
  });

  it("rejects negative token counts", () => {
    const base = runBase({
      attempts: [attempt({ inputTokens: -1 })],
    });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow();
  });

  it("rejects invalid statuses", () => {
    const base = runBase({
      attempts: [attempt({ status: "done" as EvalAttempt["status"] })],
    });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow();
  });

  it("rejects a planned attempt count that does not match models x tasks x repeats", () => {
    const base = runBase({ plannedAttempts: 2 });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow(/planned/i);
  });

  it("rejects a completed run with fewer recorded attempts than planned", () => {
    const base = runBase({ plannedAttempts: 2 });
    expect(() =>
      EvalRunSchema.parse({ ...base, summaries: summarizeEvalRun(base) }),
    ).toThrow();
  });
});

describe("EvalsFileSchema", () => {
  it("accepts an empty file and a file with a run", () => {
    expect(
      EvalsFileSchema.parse({
        schemaVersion: 1,
        generatedAt: "2026-10-21T12:00:00.000Z",
        runs: [],
      }).runs,
    ).toEqual([]);

    const parsed = EvalsFileSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-10-21T12:00:00.000Z",
      runs: [run()],
    });
    expect(parsed.runs).toHaveLength(1);
  });

  it("rejects duplicate run IDs", () => {
    expect(() =>
      EvalsFileSchema.parse({
        schemaVersion: 1,
        generatedAt: "2026-10-21T12:00:00.000Z",
        runs: [run(), run()],
      }),
    ).toThrow(/duplicate run/i);
  });

  it("rejects runs that are not newest first", () => {
    const newer = run({
      id: "newer",
      startedAt: "2026-10-22T10:00:00.000Z",
      finishedAt: "2026-10-22T11:00:00.000Z",
    });
    const older = run({
      id: "older",
      startedAt: "2026-10-21T10:00:00.000Z",
      finishedAt: "2026-10-21T11:00:00.000Z",
    });

    expect(() =>
      EvalsFileSchema.parse({
        schemaVersion: 1,
        generatedAt: "2026-10-22T12:00:00.000Z",
        runs: [older, newer],
      }),
    ).toThrow(/newest/i);
  });
});

describe("wilson95", () => {
  it("returns null for no completed attempts", () => {
    expect(wilson95(0, 0)).toBeNull();
  });

  it("returns a bounded interval for all passes and all failures", () => {
    const allPass = wilson95(1, 1);
    expect(allPass?.[0]).toBeGreaterThan(0);
    expect(allPass?.[1]).toBe(1);

    const allFail = wilson95(0, 1);
    expect(allFail?.[0]).toBe(0);
    expect(allFail?.[1]).toBeLessThan(1);
  });

  it("is centered near the observed rate", () => {
    const interval = wilson95(5, 10);
    expect(interval?.[0]).toBeLessThan(0.5);
    expect(interval?.[1]).toBeGreaterThan(0.5);
  });

  it("rejects impossible counts", () => {
    expect(() => wilson95(2, 1)).toThrow();
    expect(() => wilson95(-1, 1)).toThrow();
  });
});

describe("summarizeEvalRun", () => {
  it("counts statuses and keeps errors out of completed/pass rate", () => {
    const attempts: EvalAttempt[] = [
      attempt({ id: "a", status: "passed", durationMs: 1_000 }),
      attempt({
        id: "b",
        status: "failed",
        durationMs: 3_000,
        inputTokens: 200,
        outputTokens: 100,
      }),
      attempt({
        id: "c",
        status: "error",
        durationMs: 500,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      }),
      attempt({
        id: "d",
        status: "skipped",
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      }),
    ];
    const base = runBase({
      plannedAttempts: 4,
      attempts,
    });
    const summary = summarizeEvalRun(base)[0]!;

    expect(summary.attempts).toBe(4);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.completed).toBe(2);
    expect(summary.passRate).toBe(0.5);
    expect(summary.passRateWilson95).toEqual(wilson95(1, 2));
    expect(summary.totalTokens).toBeNull();
    expect(summary.tokensPerSolvedTask).toBeNull();
    expect(summary.costUsd).toBeNull();
    expect(summary.medianDurationMs).toBe(1_000);
    expect(summary.p95DurationMs).toBe(3_000);
  });

  it("sums known usage and cost across attempts that ran", () => {
    const attempts: EvalAttempt[] = [
      attempt({ id: "a", status: "passed", durationMs: 1_000 }),
      attempt({
        id: "b",
        status: "failed",
        durationMs: 3_000,
        inputTokens: 200,
        outputTokens: 100,
      }),
    ];
    const base = runBase({ plannedAttempts: 2, attempts });
    const summary = summarizeEvalRun(base)[0]!;

    expect(summary.totalTokens).toBe(1_500 + 300);
    expect(summary.tokensPerSolvedTask).toBe(1_800);
    expect(summary.costUsd).toBe(0);
    expect(summary.costPerSolvedTaskUsd).toBe(0);
    expect(summary.medianDurationMs).toBe(2_000);
  });

  it("excludes timeouts and skips from latency", () => {
    const attempts: EvalAttempt[] = [
      attempt({ id: "a", status: "passed", durationMs: 1_000 }),
      attempt({ id: "b", status: "timeout", durationMs: 600_000 }),
      attempt({ id: "c", status: "skipped", durationMs: 0 }),
    ];
    const base = runBase({ plannedAttempts: 3, attempts });
    const summary = summarizeEvalRun(base)[0]!;

    expect(summary.timedOut).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.medianDurationMs).toBe(1_000);
    expect(summary.p95DurationMs).toBe(1_000);
  });

  it("handles a model with no recorded attempts", () => {
    const base = runBase({ attempts: [] });
    const summary = summarizeEvalRun(base)[0]!;

    expect(summary.attempts).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.passRate).toBeNull();
    expect(summary.passRateWilson95).toBeNull();
    expect(summary.totalTokens).toBe(0);
    expect(summary.tokensPerSolvedTask).toBeNull();
    expect(summary.costUsd).toBe(0);
    expect(summary.costPerSolvedTaskUsd).toBeNull();
    expect(summary.medianDurationMs).toBeNull();
    expect(summary.p95DurationMs).toBeNull();
  });
});
