import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EvalRunSchema, type EvalAttempt, type EvalModel } from "@omg/shared";
import { afterEach, describe, expect, it } from "vitest";

import { AgentAbortError } from "../src/adapters/agent";
import {
  ArgsError,
  generateRunId,
  parseArgs,
  type EvalArgs,
} from "../src/args";
import { sha256Hex, type LoadedCorpus, type LoadedCorpusTask } from "../src/corpus";
import { commitRun, readEvalsFile } from "../src/dataFile";
import {
  createRunSkeleton,
  executePlannedRun,
  planAttempts,
  selectTasks,
  withCorpusVersion,
  type AttemptExecution,
  type PlannedAttempt,
} from "../src/run";
import { RunStore, RunStoreError } from "../src/runStore";
import { emptyUsage } from "../src/usage";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function tempRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "omg-eval-run-test-"));
  temporary.push(directory);
  return directory;
}

function makeModel(id: string): EvalModel {
  return {
    modelKey: `opencode/${id}`,
    name: id,
    provider: "opencode",
    id,
    freeKind: "limited-time",
    context: 128_000,
    inputPrice: 0,
    outputPrice: 0,
  };
}

function makeTask(id: string): LoadedCorpusTask {
  const prompt = `Implement ${id}.`;
  const dir = `/tmp/corpus/${id}`;
  return {
    manifest: {
      id,
      language: "ts",
      version: 1,
      prompt,
      publicTestCommand: "true",
      hiddenTestCommand: "exit 0",
      timeoutMs: 1_000,
      expectedBaselineFailure: "baseline fails",
      referenceSolution: "solution.patch",
    },
    dir,
    repoDir: join(dir, "repo"),
    hiddenDir: join(dir, "hidden"),
    solutionPath: join(dir, "solution.patch"),
    promptSha256: sha256Hex(prompt),
    repoSha256: sha256Hex(`repo-${id}`),
  };
}

function makeCorpus(tasks: LoadedCorpusTask[]): LoadedCorpus {
  return {
    corpusVersion: "test-corpus-v1",
    createdAt: "2026-10-21",
    tasks,
  };
}

function makeSkeleton(
  id: string,
  models: EvalModel[],
  tasks: LoadedCorpusTask[],
  repeats = 1,
  startedAt = new Date(),
  runTimeoutMs?: number,
) {
  return withCorpusVersion(
    createRunSkeleton({
      id,
      mode: "agent",
      models,
      tasks,
      repeats,
      snapshotGeneratedAt: "2026-10-21T00:00:00.000Z",
      snapshotSha256: "a".repeat(64),
      opencodeVersion: "1.18.30",
      sandbox: {
        image: "omg-eval-sandbox:test",
        digest: "sha256:test",
        platform: "linux/amd64",
      },
      ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
      now: startedAt,
    }),
    "test-corpus-v1",
  );
}

function makeExecution(
  status: AttemptExecution["status"] = "passed",
): AttemptExecution {
  const failed = status === "failed";
  return {
    status,
    skipReason: status === "skipped" ? "model_not_found" : null,
    usage: {
      ...emptyUsage(),
      inputTokens: 100,
      outputTokens: 20,
      turns: 1,
      toolCalls: 2,
      costUsd: 0,
    },
    startedAt: "2026-10-22T10:00:00.000Z",
    finishedAt: "2026-10-22T10:00:01.000Z",
    durationMs: 1_000,
    testDurationMs: 200,
    patchSha256: "c".repeat(64),
    diffLinesAdded: 3,
    diffLinesRemoved: 1,
    testExitCode:
      status === "passed" ? 0 : failed ? 1 : null,
    error: status === "skipped" ? "model_not_found" : null,
    failureOutput: failed ? "hidden test failed" : null,
  };
}

function makeAttempt(plan: PlannedAttempt): EvalAttempt {
  return {
    id: plan.id,
    modelKey: plan.model.modelKey,
    taskId: plan.task.manifest.id,
    repeat: plan.repeat,
    status: "passed",
    startedAt: "2026-10-22T09:00:00.000Z",
    finishedAt: "2026-10-22T09:00:01.000Z",
    durationMs: 1_000,
    testDurationMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    turns: 1,
    toolCalls: 1,
    patchSha256: "d".repeat(64),
    diffLinesAdded: 1,
    diffLinesRemoved: 0,
    testExitCode: 0,
    error: null,
    failureOutput: null,
  };
}

function expectArgsError(run: () => unknown): void {
  expect(run).toThrow(ArgsError);
}

describe("parseArgs", () => {
  it("uses the free/agent defaults", () => {
    expect(parseArgs([])).toEqual<EvalArgs>({
      access: "free",
      mode: "agent",
      models: "all-free",
      tasks: "all",
      repeats: 1,
      retries: 1,
      resume: null,
      runId: null,
      commit: true,
    });
  });

  it("parses explicit selections and boolean forms", () => {
    const args = parseArgs([
      "--access",
      "free",
      "--mode=direct-patch",
      "--models",
      "opencode/a,opencode/b",
      "--tasks=ts-one,py-one",
      "--repeats",
      "2",
      "--retries",
      "0",
      "--run-id",
      "run-1",
      "--commit=false",
    ]);

    expect(args).toEqual<EvalArgs>({
      access: "free",
      mode: "direct-patch",
      models: ["opencode/a", "opencode/b"],
      tasks: ["ts-one", "py-one"],
      repeats: 2,
      retries: 0,
      resume: null,
      runId: "run-1",
      commit: false,
    });
    expect(parseArgs(["--commit", "false"]).commit).toBe(false);
    expect(parseArgs(["--commit"]).commit).toBe(true);
  });

  it("rejects unsupported access, modes, and malformed selections", () => {
    expectArgsError(() => parseArgs(["--access", "paid"]));
    expectArgsError(() => parseArgs(["--mode", "benchmark"]));
    expectArgsError(() => parseArgs(["--repeats", "0"]));
    expectArgsError(() => parseArgs(["--repeats", "1.5"]));
    expectArgsError(() => parseArgs(["--retries", "6"]));
    expectArgsError(() => parseArgs(["--models", ""]));
    expectArgsError(() => parseArgs(["--models", "all-free,opencode/a"]));
    expectArgsError(() => parseArgs(["--models", "opencode/a,opencode/a"]));
    expectArgsError(() => parseArgs(["--tasks", "all,ts-one"]));
    expectArgsError(() => parseArgs(["--tasks", "ts-one,ts-one"]));
    expectArgsError(() => parseArgs(["--unknown", "value"]));
    expectArgsError(() => parseArgs(["--repeats"]));
  });

  it("rejects unsafe or conflicting run ids", () => {
    expectArgsError(() => parseArgs(["--run-id", "../escape"]));
    expectArgsError(() => parseArgs(["--run-id", "bad/id"]));
    expectArgsError(() =>
      parseArgs(["--resume", "run-a", "--run-id", "run-b"]),
    );
    expect(parseArgs(["--resume", "run-a", "--run-id", "run-a"]).resume).toBe(
      "run-a",
    );
  });

  it("generates the next daily run id", () => {
    const now = new Date("2026-10-22T12:00:00.000Z");
    expect(generateRunId("agent", now, [])).toBe("2026-10-22-free-agent-01");
    expect(
      generateRunId("agent", now, [
        "2026-10-22-free-agent-01",
        "2026-10-22-free-agent-02",
      ]),
    ).toBe("2026-10-22-free-agent-03");
    expect(generateRunId("direct-patch", now, [])).toBe(
      "2026-10-22-free-direct-patch-01",
    );
  });
});

describe("task selection and attempt planning", () => {
  it("selects all tasks or an explicit ordered list", () => {
    const corpus = makeCorpus([makeTask("one"), makeTask("two")]);
    expect(selectTasks(corpus, "all").map((task) => task.manifest.id)).toEqual([
      "one",
      "two",
    ]);
    expect(
      selectTasks(corpus, ["two"]).map((task) => task.manifest.id),
    ).toEqual(["two"]);
    expect(() => selectTasks(corpus, ["missing"])).toThrow(/unknown task/);
    expect(() => selectTasks(corpus, ["one", "one"])).toThrow(/duplicate task/);
  });

  it("plans models times tasks times repeats", () => {
    const models = [makeModel("a"), makeModel("b")];
    const tasks = [makeTask("one"), makeTask("two")];
    const plans = planAttempts(models, tasks, 2);

    expect(plans).toHaveLength(8);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(8);
    expect(plans[0]?.id).toBe("opencode/a:one:1");
    expect(plans.at(-1)?.id).toBe("opencode/b:two:2");
    expect(plans.map((plan) => plan.repeat)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
  });
});

describe("RunStore", () => {
  it("creates a run directory and records attempts", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton("run-one", models, tasks),
      root,
    );
    const plan = planAttempts(models, tasks, 1)[0]!;

    expect(existsSync(join(store.runDir, "run.json"))).toBe(true);
    expect(existsSync(store.attemptsDir)).toBe(true);

    await store.recordAttempt(makeAttempt(plan));

    const raw = await readFile(join(store.runDir, "run.json"), "utf8");
    const parsed = EvalRunSchema.parse(JSON.parse(raw));
    expect(parsed.attempts).toHaveLength(1);
    expect(parsed.summaries[0]).toMatchObject({
      modelKey: "opencode/a",
      attempts: 1,
      passed: 1,
      completed: 1,
      passRate: 1,
    });

    const resumed = await RunStore.resume("run-one", root);
    expect(resumed.run.attempts).toHaveLength(1);
  });

  it("rejects duplicate run directories and keeps artifacts raw", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one")];
    const models = [makeModel("a")];
    const run = makeSkeleton("duplicate", models, tasks);
    const store = await RunStore.create(run, root);

    await expect(RunStore.create(run, root)).rejects.toBeInstanceOf(
      RunStoreError,
    );

    const plan = planAttempts(models, tasks, 1)[0]!;
    const patch = "diff --git a/a.ts b/a.ts\n";
    const path = await store.writeArtifact(plan.id, "patch.diff", patch);
    expect(await readFile(path, "utf8")).toBe(patch);
  });
});

describe("executePlannedRun", () => {
  it("does not write data when commit is false", async () => {
    const root = await tempRoot();
    const dataPath = join(root, "data", "evals.json");
    const tasks = [makeTask("one")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton("no-commit", models, tasks),
      root,
    );
    const plans = planAttempts(models, tasks, 1);

    const result = await executePlannedRun({
      store,
      plans,
      executor: async () => makeExecution("passed"),
      commit: false,
      dataPath,
      retries: 0,
    });

    expect(result.aborted).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.run.status).toBe("complete");
    expect(result.run.attempts).toHaveLength(1);
    expect(existsSync(dataPath)).toBe(false);
  });

  it("retries a transient error before recording the attempt", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton("retry", models, tasks),
      root,
    );
    const plans = planAttempts(models, tasks, 1);

    const logs: string[] = [];
    let calls = 0;
    const result = await executePlannedRun({
      store,
      plans,
      executor: async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return makeExecution("passed");
      },
      commit: false,
      retries: 1,
      retryDelayMs: 0,
      log: (message) => logs.push(message),
    });

    expect(calls).toBe(2);
    expect(result.run.status).toBe("complete");
    expect(result.run.attempts).toHaveLength(1);
    expect(result.run.attempts[0]?.status).toBe("passed");
    expect(logs.join("\n")).toContain("retry opencode/a:one:1");
  });

  it("resumes by skipping terminal attempts and completing the rest", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one"), makeTask("two")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton("resume-one", models, tasks),
      root,
    );
    const plans = planAttempts(models, tasks, 1);
    await store.recordAttempt(makeAttempt(plans[0]!));

    const called: string[] = [];
    const result = await executePlannedRun({
      store,
      plans,
      executor: async (plan) => {
        called.push(plan.id);
        return makeExecution("passed");
      },
      commit: false,
      retries: 0,
    });

    expect(called).toEqual(["opencode/a:two:1"]);
    expect(result.run.status).toBe("complete");
    expect(result.run.attempts).toHaveLength(2);
    expect(
      result.run.attempts.find((attempt) => attempt.id === "opencode/a:one:1")
        ?.startedAt,
    ).toBe("2026-10-22T09:00:00.000Z");
  });

  it("propagates model_not_found to the remaining attempts for that model", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one"), makeTask("two")];
    const models = [makeModel("missing")];
    const store = await RunStore.create(
      makeSkeleton("model-missing", models, tasks),
      root,
    );
    const plans = planAttempts(models, tasks, 1);

    const called: string[] = [];
    const result = await executePlannedRun({
      store,
      plans,
      executor: async (plan) => {
        called.push(plan.id);
        return makeExecution("skipped");
      },
      commit: false,
      retries: 0,
    });

    expect(called).toEqual(["opencode/missing:one:1"]);
    expect(result.run.attempts).toHaveLength(2);
    expect(result.run.attempts.every((attempt) => attempt.status === "skipped")).toBe(
      true,
    );
    expect(result.run.status).toBe("complete");
  });

  it("marks remaining attempts skipped with run_timeout and partial status", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one"), makeTask("two")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton(
        "run-timeout",
        models,
        tasks,
        1,
        new Date("2026-10-20T00:00:00.000Z"),
        1,
      ),
      root,
    );
    const plans = planAttempts(models, tasks, 1);

    let called = 0;
    const result = await executePlannedRun({
      store,
      plans,
      executor: async () => {
        called += 1;
        return makeExecution("passed");
      },
      commit: false,
      retries: 0,
    });

    expect(called).toBe(0);
    expect(result.run.status).toBe("partial");
    expect(result.run.attempts).toHaveLength(2);
    expect(result.run.attempts.every((attempt) => attempt.status === "skipped")).toBe(
      true,
    );
    expect(
      result.run.attempts.every((attempt) => attempt.error === "run_timeout"),
    ).toBe(true);
  });

  it("keeps a timed-out run partial when every remaining attempt is already skipped", async () => {
    const root = await tempRoot();
    const tasks = [makeTask("one"), makeTask("two")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton(
        "run-timeout-resume",
        models,
        tasks,
        1,
        new Date("2026-10-20T00:00:00.000Z"),
        1,
      ),
      root,
    );
    const plans = planAttempts(models, tasks, 1);

    const first = await executePlannedRun({
      store,
      plans,
      executor: async () => makeExecution("passed"),
      commit: false,
      retries: 0,
    });
    expect(first.run.status).toBe("partial");

    let called = 0;
    const second = await executePlannedRun({
      store,
      plans,
      executor: async () => {
        called += 1;
        return makeExecution("passed");
      },
      commit: false,
      retries: 0,
    });

    expect(called).toBe(0);
    expect(second.run.status).toBe("partial");
    expect(second.run.attempts).toHaveLength(2);
  });

  it("aborts and does not commit on authentication failure", async () => {
    const root = await tempRoot();
    const dataPath = join(root, "data", "evals.json");
    const tasks = [makeTask("one")];
    const models = [makeModel("a")];
    const store = await RunStore.create(
      makeSkeleton("auth-failure", models, tasks),
      root,
    );
    const plans = planAttempts(models, tasks, 1);

    const result = await executePlannedRun({
      store,
      plans,
      executor: async () => {
        throw new AgentAbortError("invalid key");
      },
      commit: true,
      dataPath,
      retries: 0,
    });

    expect(result.aborted).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.run.status).toBe("failed");
    expect(existsSync(dataPath)).toBe(false);
  });

  it("writes and sorts committed runs newest first", async () => {
    const root = await tempRoot();
    const dataPath = join(root, "data", "evals.json");
    const models = [makeModel("a")];
    const tasks = [makeTask("one")];

    const older = makeSkeleton(
      "older",
      models,
      tasks,
      1,
      new Date("2026-10-20T10:00:00.000Z"),
    );
    const newer = makeSkeleton(
      "newer",
      models,
      tasks,
      1,
      new Date("2026-10-21T10:00:00.000Z"),
    );

    await commitRun(older, dataPath);
    await commitRun(newer, dataPath);

    const file = await readEvalsFile(dataPath);
    expect(file.runs.map((run) => run.id)).toEqual(["newer", "older"]);
    const files = await readdir(join(root, "data"));
    expect(files.some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});
