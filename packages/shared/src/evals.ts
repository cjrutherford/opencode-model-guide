import { z } from "zod";

import { ProviderIdSchema } from "./schema";

export const EVALS_SCHEMA_VERSION = 1 as const;

export const EVAL_MODES = ["agent", "direct-patch"] as const;
export const EvalModeSchema = z.enum(EVAL_MODES);
export type EvalMode = z.infer<typeof EvalModeSchema>;

export const EVAL_STATUSES = [
  "passed",
  "failed",
  "patch_failed",
  "error",
  "timeout",
  "skipped",
] as const;
export const EvalStatusSchema = z.enum(EVAL_STATUSES);
export type EvalStatus = z.infer<typeof EvalStatusSchema>;

export const EVAL_LANGUAGES = ["ts", "js", "python", "go"] as const;
export const EvalLanguageSchema = z.enum(EVAL_LANGUAGES);
export type EvalLanguage = z.infer<typeof EvalLanguageSchema>;

export const EVAL_FREE_KINDS = ["open-free", "limited-time", "trial"] as const;
export const EvalFreeKindSchema = z.enum(EVAL_FREE_KINDS);
export type EvalFreeKind = z.infer<typeof EvalFreeKindSchema>;

export const EVAL_RUN_STATUSES = ["complete", "partial", "failed"] as const;
export const EvalRunStatusSchema = z.enum(EVAL_RUN_STATUSES);
export type EvalRunStatus = z.infer<typeof EvalRunStatusSchema>;

const nonnegative = (label: string) =>
  z.number().min(0, { message: `${label} must be nonnegative` });

const nonnegativeInteger = (label: string) =>
  z.number().int().min(0, { message: `${label} must be a nonnegative integer` });

const nullableNonnegativeInteger = (label: string) =>
  nonnegativeInteger(label).nullable();

const sha256 = z
  .string()
  .regex(/^[a-f0-9]{64}$/, { message: "must be a lowercase SHA-256 hex digest" });

const sha256OrNull = sha256.nullable();

export const EvalModelSchema = z
  .strictObject({
    modelKey: z.string().min(1),
    name: z.string().min(1),
    provider: ProviderIdSchema,
    id: z.string().min(1),
    freeKind: EvalFreeKindSchema,
    context: nonnegativeInteger("context"),
    inputPrice: nonnegative("inputPrice"),
    outputPrice: nonnegative("outputPrice"),
  })
  .superRefine((model, ctx) => {
    if (model.modelKey !== `${model.provider}/${model.id}`) {
      ctx.addIssue({
        code: "custom",
        message: `model key mismatch: ${model.modelKey} !== ${model.provider}/${model.id}`,
      });
    }
  });
export type EvalModel = z.infer<typeof EvalModelSchema>;

export const EvalTaskDescriptorSchema = z.strictObject({
  id: z.string().min(1),
  language: EvalLanguageSchema,
  version: z.number().int().positive(),
  prompt: z.string().min(1),
  promptSha256: sha256,
  repoSha256: sha256,
  publicTestCommand: z.string().min(1),
  hiddenTestCommand: z.string().min(1),
  timeoutMs: z.number().int().positive(),
});
export type EvalTaskDescriptor = z.infer<typeof EvalTaskDescriptorSchema>;

export const EvalAttemptSchema = z
  .strictObject({
    id: z.string().min(1),
    modelKey: z.string().min(1),
    taskId: z.string().min(1),
    repeat: z.number().int().positive(),
    status: EvalStatusSchema,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    durationMs: nonnegativeInteger("durationMs"),
    testDurationMs: nullableNonnegativeInteger("testDurationMs"),
    inputTokens: nullableNonnegativeInteger("inputTokens"),
    outputTokens: nullableNonnegativeInteger("outputTokens"),
    cachedInputTokens: nullableNonnegativeInteger("cachedInputTokens"),
    reasoningTokens: nullableNonnegativeInteger("reasoningTokens"),
    costUsd: nonnegative("costUsd").nullable(),
    turns: nullableNonnegativeInteger("turns"),
    toolCalls: nullableNonnegativeInteger("toolCalls"),
    patchSha256: sha256OrNull,
    diffLinesAdded: nullableNonnegativeInteger("diffLinesAdded"),
    diffLinesRemoved: nullableNonnegativeInteger("diffLinesRemoved"),
    testExitCode: z.number().int().nullable(),
    error: z.string().max(2_000).nullable(),
    failureOutput: z.string().max(4_096).nullable(),
  })
  .superRefine((attempt, ctx) => {
    if (attempt.status === "passed" && attempt.testExitCode !== 0) {
      ctx.addIssue({
        code: "custom",
        message: "passed attempt must have testExitCode 0",
      });
    }
    if (attempt.status === "failed" && attempt.testExitCode === 0) {
      ctx.addIssue({
        code: "custom",
        message: "failed attempt must have a non-zero testExitCode",
      });
    }
  });
export type EvalAttempt = z.infer<typeof EvalAttemptSchema>;

export const EvalModelSummarySchema = z
  .strictObject({
    modelKey: z.string().min(1),
    attempts: nonnegativeInteger("attempts"),
    passed: nonnegativeInteger("passed"),
    failed: nonnegativeInteger("failed"),
    patchFailed: nonnegativeInteger("patchFailed"),
    errored: nonnegativeInteger("errored"),
    timedOut: nonnegativeInteger("timedOut"),
    skipped: nonnegativeInteger("skipped"),
    completed: nonnegativeInteger("completed"),
    passRate: z.number().min(0).max(1).nullable(),
    passRateWilson95: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).nullable(),
    totalTokens: nonnegativeInteger("totalTokens").nullable(),
    tokensPerSolvedTask: nonnegative("tokensPerSolvedTask").nullable(),
    costUsd: nonnegative("costUsd").nullable(),
    costPerSolvedTaskUsd: nonnegative("costPerSolvedTaskUsd").nullable(),
    medianDurationMs: nonnegative("medianDurationMs").nullable(),
    p95DurationMs: nonnegative("p95DurationMs").nullable(),
  })
  .superRefine((summary, ctx) => {
    const statusTotal =
      summary.passed +
      summary.failed +
      summary.patchFailed +
      summary.errored +
      summary.timedOut +
      summary.skipped;

    if (summary.attempts !== statusTotal) {
      ctx.addIssue({
        code: "custom",
        message: "attempt count does not match status counts",
      });
    }

    if (summary.completed !== summary.passed + summary.failed) {
      ctx.addIssue({
        code: "custom",
        message: "completed must equal passed + failed",
      });
    }

    if ((summary.completed === 0) !== (summary.passRate === null)) {
      ctx.addIssue({
        code: "custom",
        message: "passRate must be null only when completed is 0",
      });
    }

    if (summary.passRateWilson95) {
      const [low, high] = summary.passRateWilson95;
      if (low > high) {
        ctx.addIssue({
          code: "custom",
          message: "Wilson interval lower bound exceeds upper bound",
        });
      }
    }
  });
export type EvalModelSummary = z.infer<typeof EvalModelSummarySchema>;

export const EvalSandboxSchema = z.strictObject({
  image: z.string().min(1),
  digest: z.string().min(1),
  platform: z.string().min(1),
});
export type EvalSandbox = z.infer<typeof EvalSandboxSchema>;

export const EvalLimitsSchema = z.strictObject({
  attemptTimeoutMs: z.number().int().positive(),
  runTimeoutMs: z.number().int().positive(),
  maxWorkspaceBytes: z.number().int().positive(),
});
export type EvalLimits = z.infer<typeof EvalLimitsSchema>;

export const EvalRunSchema = z
  .strictObject({
    id: z.string().min(1),
    mode: EvalModeSchema,
    status: EvalRunStatusSchema,
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    harnessVersion: z.string().min(1),
    corpusVersion: z.string().min(1),
    snapshotGeneratedAt: z.iso.datetime(),
    snapshotSha256: sha256,
    opencodeVersion: z.string().min(1),
    sandbox: EvalSandboxSchema,
    limits: EvalLimitsSchema,
    access: z.literal("free"),
    repeats: z.number().int().positive(),
    plannedAttempts: z.number().int().positive(),
    models: z.array(EvalModelSchema).min(1),
    tasks: z.array(EvalTaskDescriptorSchema).min(1),
    attempts: z.array(EvalAttemptSchema),
    summaries: z.array(EvalModelSummarySchema),
    notes: z.string().max(2_000).optional(),
  })
  .superRefine((run, ctx) => {
    const modelKeys = new Set<string>();
    for (const model of run.models) {
      if (modelKeys.has(model.modelKey)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate model key: ${model.modelKey}`,
        });
      }
      modelKeys.add(model.modelKey);
    }

    const taskIds = new Set<string>();
    for (const task of run.tasks) {
      if (taskIds.has(task.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate task id: ${task.id}`,
        });
      }
      taskIds.add(task.id);
    }

    const expectedAttempts = run.models.length * run.tasks.length * run.repeats;
    if (run.plannedAttempts !== expectedAttempts) {
      ctx.addIssue({
        code: "custom",
        message: `plannedAttempts ${run.plannedAttempts} does not match models x tasks x repeats (${expectedAttempts})`,
      });
    }

    if (run.attempts.length > run.plannedAttempts) {
      ctx.addIssue({
        code: "custom",
        message: "recorded attempts exceed planned attempts",
      });
    }

    if (run.status === "complete" && run.attempts.length !== run.plannedAttempts) {
      ctx.addIssue({
        code: "custom",
        message: "complete run must record every planned attempt",
      });
    }

    if (run.status === "complete" && run.finishedAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "complete run must have finishedAt",
      });
    }

    const attemptIds = new Set<string>();
    for (const attempt of run.attempts) {
      if (attemptIds.has(attempt.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate attempt id: ${attempt.id}`,
        });
      }
      attemptIds.add(attempt.id);

      if (!modelKeys.has(attempt.modelKey)) {
        ctx.addIssue({
          code: "custom",
          message: `attempt references unknown model: ${attempt.modelKey}`,
        });
      }

      if (!taskIds.has(attempt.taskId)) {
        ctx.addIssue({
          code: "custom",
          message: `attempt references unknown task: ${attempt.taskId}`,
        });
      }

      if (attempt.repeat > run.repeats) {
        ctx.addIssue({
          code: "custom",
          message: `attempt repeat ${attempt.repeat} exceeds run repeats ${run.repeats}`,
        });
      }
    }

    const summaryKeys = new Set<string>();
    for (const summary of run.summaries) {
      if (summaryKeys.has(summary.modelKey)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate summary model key: ${summary.modelKey}`,
        });
      }
      summaryKeys.add(summary.modelKey);

      if (!modelKeys.has(summary.modelKey)) {
        ctx.addIssue({
          code: "custom",
          message: `summary references unknown model: ${summary.modelKey}`,
        });
      }
    }

    for (const modelKey of modelKeys) {
      if (!summaryKeys.has(modelKey)) {
        ctx.addIssue({
          code: "custom",
          message: `missing summary for model: ${modelKey}`,
        });
      }
    }

    const expectedSummaries = summarizeEvalRun(run);
    const actual = canonicalSummaries(run.summaries);
    const expected = canonicalSummaries(expectedSummaries);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      ctx.addIssue({
        code: "custom",
        message: "summary data does not match the recorded attempts",
      });
    }
  });
export type EvalRun = z.infer<typeof EvalRunSchema>;

export const EvalsFileSchema = z
  .strictObject({
    schemaVersion: z.literal(EVALS_SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    runs: z.array(EvalRunSchema),
  })
  .superRefine((file, ctx) => {
    const runIds = new Set<string>();
    for (let index = 0; index < file.runs.length; index += 1) {
      const run = file.runs[index]!;
      if (runIds.has(run.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate run id: ${run.id}`,
        });
      }
      runIds.add(run.id);

      if (index > 0) {
        const previous = file.runs[index - 1]!;
        if (previous.startedAt < run.startedAt) {
          ctx.addIssue({
            code: "custom",
            message: "runs must be ordered newest first",
          });
        }
      }
    }
  });
export type EvalsFile = z.infer<typeof EvalsFileSchema>;

function canonicalSummaries(summaries: EvalModelSummary[]): EvalModelSummary[] {
  return [...summaries].sort((left, right) =>
    left.modelKey.localeCompare(right.modelKey),
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index]!;
}

export function wilson95(
  passed: number,
  completed: number,
): [number, number] | null {
  if (
    !Number.isInteger(passed) ||
    !Number.isInteger(completed) ||
    passed < 0 ||
    completed < 0 ||
    passed > completed
  ) {
    throw new Error("invalid pass counts");
  }
  if (completed === 0) return null;

  const zScore = 1.959_963_984_540_054;
  const rate = passed / completed;
  const denominator = 1 + (zScore * zScore) / completed;
  const center = (rate + (zScore * zScore) / (2 * completed)) / denominator;
  const margin =
    (zScore *
      Math.sqrt(
        (rate * (1 - rate)) / completed +
          (zScore * zScore) / (4 * completed * completed),
      )) /
    denominator;

  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function summarizeEvalRun(
  run: Pick<EvalRun, "models" | "attempts">,
): EvalModelSummary[] {
  return run.models.map((model) => {
    const attempts = run.attempts.filter(
      (attempt) => attempt.modelKey === model.modelKey,
    );
    const passed = attempts.filter((attempt) => attempt.status === "passed").length;
    const failed = attempts.filter((attempt) => attempt.status === "failed").length;
    const patchFailed = attempts.filter(
      (attempt) => attempt.status === "patch_failed",
    ).length;
    const errored = attempts.filter((attempt) => attempt.status === "error").length;
    const timedOut = attempts.filter((attempt) => attempt.status === "timeout").length;
    const skipped = attempts.filter((attempt) => attempt.status === "skipped").length;
    const completed = passed + failed;

    const ran = attempts.filter((attempt) => attempt.status !== "skipped");
    const usageKnown = ran.every(
      (attempt) => attempt.inputTokens !== null && attempt.outputTokens !== null,
    );
    const totalTokens = usageKnown
      ? ran.reduce(
          (sum, attempt) => sum + attempt.inputTokens! + attempt.outputTokens!,
          0,
        )
      : null;

    const costKnown = ran.every((attempt) => attempt.costUsd !== null);
    const costUsd = costKnown
      ? ran.reduce((sum, attempt) => sum + attempt.costUsd!, 0)
      : null;

    const latency = attempts
      .filter(
        (attempt) =>
          attempt.status !== "timeout" &&
          attempt.status !== "skipped" &&
          attempt.durationMs > 0,
      )
      .map((attempt) => attempt.durationMs);

    const passRate = completed > 0 ? passed / completed : null;
    const tokensPerSolvedTask =
      totalTokens !== null && passed > 0 ? totalTokens / passed : null;
    const costPerSolvedTaskUsd =
      costUsd !== null && passed > 0 ? costUsd / passed : null;

    return {
      modelKey: model.modelKey,
      attempts: attempts.length,
      passed,
      failed,
      patchFailed,
      errored,
      timedOut,
      skipped,
      completed,
      passRate,
      passRateWilson95: completed > 0 ? wilson95(passed, completed) : null,
      totalTokens,
      tokensPerSolvedTask,
      costUsd,
      costPerSolvedTaskUsd,
      medianDurationMs: median(latency),
      p95DurationMs: p95(latency),
    };
  });
}
