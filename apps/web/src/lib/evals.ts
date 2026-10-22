import type {
  EvalAttempt,
  EvalMode,
  EvalModel,
  EvalModelSummary,
  EvalRun,
  EvalRunStatus,
  EvalStatus,
  EvalTaskDescriptor,
  EvalsFile,
  ModelRecord,
} from "@omg/shared";

import { formatCount } from "./format";

export const EVAL_MODE_ORDER: readonly EvalMode[] = ["agent", "direct-patch"];

export const EVAL_MODE_LABELS: Record<EvalMode, string> = {
  agent: "Agent",
  "direct-patch": "Direct patch",
};

export const EVAL_MODE_SHORT_LABELS: Record<EvalMode, string> = {
  agent: "Eval",
  "direct-patch": "Patch",
};

export const EVAL_RUN_STATUS_LABELS: Record<EvalRunStatus, string> = {
  complete: "Complete",
  partial: "Partial",
  failed: "Failed",
};

export const EVAL_STATUS_LABELS: Record<EvalStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  patch_failed: "Patch failed",
  error: "Error",
  timeout: "Timed out",
  skipped: "Skipped",
};

export type EvalTone = "good" | "bad" | "warn" | "muted";

export const EVAL_STATUS_TONES: Record<EvalStatus, EvalTone> = {
  passed: "good",
  failed: "bad",
  patch_failed: "bad",
  error: "warn",
  timeout: "warn",
  skipped: "muted",
};

export type EvalCellStatus = EvalStatus | "not_run";

export const EVAL_CELL_LABELS: Record<EvalCellStatus, string> = {
  passed: "Pass",
  failed: "Fail",
  patch_failed: "Patch fail",
  error: "Error",
  timeout: "Timeout",
  skipped: "Skipped",
  not_run: "Not run",
};

export const EVAL_CELL_TONES: Record<EvalCellStatus, EvalTone> = {
  ...EVAL_STATUS_TONES,
  not_run: "muted",
};

export type EvalModelRef = Pick<ModelRecord, "key" | "id" | "provider">;

export interface EvalModelMatch {
  model: EvalModel;
  summary: EvalModelSummary;
}

export interface ModelEvalResult extends EvalModelMatch {
  run: EvalRun;
}

export interface ModelEvalBadge extends ModelEvalResult {
  mode: EvalMode;
  label: string;
  passed: number;
  completed: number;
  totalAttempts: number;
}

export interface EvalMatrixCell {
  modelKey: string;
  taskId: string;
  status: EvalCellStatus;
  label: string;
  tone: EvalTone;
  attemptCount: number;
  passed: number;
  completed: number;
  title: string;
}

export interface EvalMatrixRow {
  task: EvalTaskDescriptor;
  cells: EvalMatrixCell[];
  attemptCount: number;
  passed: number;
  completed: number;
}

export interface EvalRunTotals {
  models: number;
  tasks: number;
  repeats: number;
  recorded: number;
  planned: number;
  passed: number;
  failed: number;
  patchFailed: number;
  errored: number;
  timedOut: number;
  skipped: number;
  completed: number;
  passRate: number | null;
}

export function latestRunByMode(
  evals: EvalsFile,
  mode: EvalMode,
): EvalRun | null {
  let latest: EvalRun | null = null;
  let latestStarted = Number.NEGATIVE_INFINITY;

  for (const run of evals.runs) {
    if (run.mode !== mode) continue;
    const started = Date.parse(run.startedAt);
    if (!Number.isFinite(started)) continue;
    if (started > latestStarted) {
      latest = run;
      latestStarted = started;
    }
  }

  return latest;
}

export function findEvalModel(
  run: EvalRun,
  model: EvalModelRef,
): EvalModelMatch | null {
  let matched = run.models.find((candidate) => candidate.modelKey === model.key);

  if (!matched) {
    const sameId = run.models.filter((candidate) => candidate.id === model.id);
    // Free eval runs use Console listings. If a Go twin asks about the same
    // underlying model, prefer the Console record used by the run.
    matched =
      sameId.find((candidate) => candidate.provider === "opencode") ??
      sameId[0];
  }

  if (!matched) return null;
  const summary = run.summaries.find(
    (candidate) => candidate.modelKey === matched.modelKey,
  );
  if (!summary) return null;
  return { model: matched, summary };
}

/** Latest result per mode, agent first. Only modes that cover the model appear. */
export function modelEvalResults(
  evals: EvalsFile,
  model: EvalModelRef,
): ModelEvalResult[] {
  const results: ModelEvalResult[] = [];

  for (const mode of EVAL_MODE_ORDER) {
    const run = latestRunByMode(evals, mode);
    if (!run) continue;
    const match = findEvalModel(run, model);
    if (!match) continue;
    results.push({ run, ...match });
  }

  return results;
}

export function primaryModelEvalBadge(
  evals: EvalsFile,
  model: EvalModelRef,
): ModelEvalBadge | null {
  const [result] = modelEvalResults(evals, model);
  return result ? toModelEvalBadge(result) : null;
}

export function toModelEvalBadge(result: ModelEvalResult): ModelEvalBadge {
  const totalAttempts = result.run.tasks.length * result.run.repeats;
  const label = `${EVAL_MODE_SHORT_LABELS[result.run.mode]} ${result.summary.passed}/${totalAttempts}`;

  return {
    ...result,
    mode: result.run.mode,
    label,
    passed: result.summary.passed,
    completed: result.summary.completed,
    totalAttempts,
  };
}

export function sortRunModels(run: EvalRun): EvalModelMatch[] {
  return run.models
    .map((model) => {
      const summary = run.summaries.find(
        (candidate) => candidate.modelKey === model.modelKey,
      );
      if (!summary) {
        throw new Error(`missing summary for ${model.modelKey}`);
      }
      return { model, summary };
    })
    .sort((left, right) => {
      if (right.summary.completed !== left.summary.completed) {
        return right.summary.completed - left.summary.completed;
      }

      const leftRate = left.summary.passRate ?? -1;
      const rightRate = right.summary.passRate ?? -1;
      if (rightRate !== leftRate) return rightRate - leftRate;

      const leftTokens =
        left.summary.tokensPerSolvedTask ?? Number.POSITIVE_INFINITY;
      const rightTokens =
        right.summary.tokensPerSolvedTask ?? Number.POSITIVE_INFINITY;
      if (leftTokens !== rightTokens) return leftTokens - rightTokens;

      return (
        left.model.name.localeCompare(right.model.name) ||
        left.model.modelKey.localeCompare(right.model.modelKey)
      );
    });
}

function aggregateCellStatus(attempts: EvalAttempt[]): EvalCellStatus {
  if (attempts.length === 0) return "not_run";

  const statuses = new Set(attempts.map((attempt) => attempt.status));
  const nonPass: EvalStatus[] = [
    "failed",
    "patch_failed",
    "error",
    "timeout",
    "skipped",
  ];

  for (const status of nonPass) {
    if (statuses.has(status)) return status;
  }
  return "passed";
}

export function buildEvalTaskMatrix(
  run: EvalRun,
  models: EvalModel[] = run.models,
): EvalMatrixRow[] {
  return run.tasks.map((task) => {
    const cells = models.map((model) => {
      const attempts = run.attempts.filter(
        (attempt) =>
          attempt.modelKey === model.modelKey && attempt.taskId === task.id,
      );
      const status = aggregateCellStatus(attempts);
      const passed = attempts.filter(
        (attempt) => attempt.status === "passed",
      ).length;
      const failed = attempts.filter(
        (attempt) => attempt.status === "failed",
      ).length;
      const completed = passed + failed;
      const title =
        attempts.length === 0
          ? "No attempt recorded"
          : `${formatCount(passed)}/${formatCount(attempts.length)} passed · ${formatCount(completed)}/${formatCount(attempts.length)} completed`;

      return {
        modelKey: model.modelKey,
        taskId: task.id,
        status,
        label: EVAL_CELL_LABELS[status],
        tone: EVAL_CELL_TONES[status],
        attemptCount: attempts.length,
        passed,
        completed,
        title,
      };
    });

    return {
      task,
      cells,
      attemptCount: cells.reduce((sum, cell) => sum + cell.attemptCount, 0),
      passed: cells.reduce((sum, cell) => sum + cell.passed, 0),
      completed: cells.reduce((sum, cell) => sum + cell.completed, 0),
    };
  });
}

export function evalRunTotals(run: EvalRun): EvalRunTotals {
  const totals = run.summaries.reduce(
    (sum, summary) => ({
      passed: sum.passed + summary.passed,
      failed: sum.failed + summary.failed,
      patchFailed: sum.patchFailed + summary.patchFailed,
      errored: sum.errored + summary.errored,
      timedOut: sum.timedOut + summary.timedOut,
      skipped: sum.skipped + summary.skipped,
    }),
    {
      passed: 0,
      failed: 0,
      patchFailed: 0,
      errored: 0,
      timedOut: 0,
      skipped: 0,
    },
  );
  const completed = totals.passed + totals.failed;

  return {
    models: run.models.length,
    tasks: run.tasks.length,
    repeats: run.repeats,
    recorded: run.attempts.length,
    planned: run.plannedAttempts,
    ...totals,
    completed,
    passRate: completed > 0 ? totals.passed / completed : null,
  };
}
