import { describe, expect, it } from "vitest";

import {
  summarizeEvalRun,
  type EvalAttempt,
  type EvalModel,
  type EvalRun,
  type EvalTaskDescriptor,
  type EvalsFile,
  type Snapshot,
} from "@omg/shared";

import { validateEvals } from "./validate-data";

const MODEL: EvalModel = {
  modelKey: "opencode/model-a",
  name: "Model A",
  provider: "opencode",
  id: "model-a",
  freeKind: "limited-time",
  context: 128_000,
  inputPrice: 0,
  outputPrice: 0,
};

const TASK: EvalTaskDescriptor = {
  id: "ts-one",
  language: "ts",
  version: 1,
  prompt: "Implement the task.",
  promptSha256: "a".repeat(64),
  repoSha256: "b".repeat(64),
  publicTestCommand: "true",
  hiddenTestCommand: "exit 0",
  timeoutMs: 1_000,
};

function attempt(overrides: Partial<EvalAttempt> = {}): EvalAttempt {
  return {
    id: "opencode/model-a:ts-one:1",
    modelKey: MODEL.modelKey,
    taskId: TASK.id,
    repeat: 1,
    status: "passed",
    startedAt: "2026-10-22T10:00:00.000Z",
    finishedAt: "2026-10-22T10:00:01.000Z",
    durationMs: 1_000,
    testDurationMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    turns: 1,
    toolCalls: 1,
    patchSha256: null,
    diffLinesAdded: null,
    diffLinesRemoved: null,
    testExitCode: 0,
    error: null,
    failureOutput: null,
    ...overrides,
  };
}

function run(overrides: Partial<EvalRun> = {}): EvalRun {
  const attempts = overrides.attempts ?? [attempt()];
  const models = overrides.models ?? [MODEL];
  return {
    id: "2026-10-22-free-agent-01",
    mode: "agent",
    status: "complete",
    startedAt: "2026-10-22T10:00:00.000Z",
    finishedAt: "2026-10-22T10:00:02.000Z",
    harnessVersion: "s14",
    corpusVersion: "2026-10-21.1",
    snapshotGeneratedAt: "2026-10-21T00:00:00.000Z",
    snapshotSha256: "c".repeat(64),
    opencodeVersion: "1.18.30",
    sandbox: {
      image: "omg-eval-sandbox:test",
      digest: "sha256:test",
      platform: "linux/amd64",
    },
    limits: {
      attemptTimeoutMs: 480_000,
      runTimeoutMs: 18_000_000,
      maxWorkspaceBytes: 536_870_912,
    },
    access: "free",
    repeats: 1,
    plannedAttempts: 1,
    models,
    tasks: overrides.tasks ?? [TASK],
    attempts,
    summaries: summarizeEvalRun({ models, attempts }),
    ...overrides,
  };
}

function file(overrides: Partial<EvalsFile> = {}): EvalsFile {
  return {
    schemaVersion: 1,
    generatedAt: "2026-10-22T10:00:02.000Z",
    runs: [run()],
    ...overrides,
  };
}

function snapshot(modelKeys: string[]): Snapshot {
  return {
    models: modelKeys.map((key) => ({ key })),
  } as unknown as Snapshot;
}

describe("validateEvals", () => {
  it("accepts an empty eval file", () => {
    expect(validateEvals(file({ runs: [] }), null)).toEqual({
      file: file({ runs: [] }),
      warnings: [],
    });
  });

  it("accepts a valid run and warns for a historical model absent from the snapshot", () => {
    const result = validateEvals(file(), snapshot(["opencode/other"]));
    expect(result.file.runs).toHaveLength(1);
    expect(result.warnings).toEqual([
      "eval run 2026-10-22-free-agent-01 references a model absent from the current snapshot: opencode/model-a",
    ]);
  });

  it("does not warn when the historical model is still in the snapshot", () => {
    expect(validateEvals(file(), snapshot([MODEL.modelKey])).warnings).toEqual([]);
  });

  it("rejects duplicate run IDs", () => {
    const duplicate = run();
    expect(() =>
      validateEvals(file({ runs: [duplicate, duplicate] }), null),
    ).toThrow(/duplicate run id/);
  });

  it("rejects summaries that do not match the attempts", () => {
    const withBadSummary = run();
    withBadSummary.summaries = [
      { ...withBadSummary.summaries[0]!, passRate: 0.5 },
    ];
    expect(() => validateEvals(file({ runs: [withBadSummary] }), null)).toThrow(
      /summary data does not match/,
    );
  });

  it("rejects inconsistent passed status and test exit code", () => {
    const attempts = [attempt({ testExitCode: null })];
    expect(() => validateEvals(file({ runs: [run({ attempts })] }), null)).toThrow(
      /passed attempt must have testExitCode 0/,
    );
  });

  it("rejects unknown attempt task references", () => {
    const attempts = [attempt({ taskId: "missing-task" })];
    expect(() => validateEvals(file({ runs: [run({ attempts })] }), null)).toThrow(
      /attempt references unknown task/,
    );
  });

  it("rejects negative token counts", () => {
    const attempts = [attempt({ inputTokens: -1 })];
    expect(() => validateEvals(file({ runs: [run({ attempts })] }), null)).toThrow(
      /inputTokens/,
    );
  });
});
