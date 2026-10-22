import { EVAL_MODES, type EvalMode } from "@omg/shared";

export const DEFAULT_REPEATS = 1;
export const DEFAULT_RETRIES = 1;
export const MAX_REPEATS = 100;
export const MAX_RETRIES = 5;

export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface EvalArgs {
  access: "free";
  mode: EvalMode;
  /** `all-free` or an explicit comma-separated model list. */
  models: "all-free" | string[];
  /** `all` or an explicit comma-separated task list. */
  tasks: "all" | string[];
  repeats: number;
  retries: number;
  resume: string | null;
  runId: string | null;
  commit: boolean;
}

export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgsError";
  }
}

export function isSafeRunId(value: string): boolean {
  return RUN_ID_PATTERN.test(value);
}

export function generateRunId(
  mode: EvalMode,
  now: Date,
  existing: Iterable<string>,
): string {
  const date = now.toISOString().slice(0, 10);
  const prefix = `${date}-free-${mode}`;
  const ids = new Set(existing);
  let suffix = 1;
  while (ids.has(`${prefix}-${String(suffix).padStart(2, "0")}`)) {
    suffix += 1;
  }
  return `${prefix}-${String(suffix).padStart(2, "0")}`;
}

function parseBoolean(value: string, flag: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ArgsError(`${flag} must be true or false`);
}

function parsePositiveInteger(
  value: string,
  flag: string,
  max: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new ArgsError(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ArgsError(`${flag} must be between 1 and ${max}`);
  }
  return parsed;
}

function parseNonnegativeInteger(
  value: string,
  flag: string,
  max: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new ArgsError(`${flag} must be a nonnegative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new ArgsError(`${flag} must be between 0 and ${max}`);
  }
  return parsed;
}

function parseList(value: string, flag: string): string[] {
  const items = value.split(",").map((item) => item.trim());
  if (items.length === 0 || items.some((item) => item.length === 0)) {
    throw new ArgsError(`${flag} must contain at least one value`);
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) {
      throw new ArgsError(`${flag} contains a duplicate: ${item}`);
    }
    seen.add(item);
  }
  return items;
}

export function parseArgs(argv: readonly string[]): EvalArgs {
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  const values = new Map<string, string | true>();
  const allowed = new Set([
    "access",
    "mode",
    "models",
    "tasks",
    "repeats",
    "retries",
    "resume",
    "run-id",
    "commit",
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--") || token === "--") {
      throw new ArgsError(`unexpected argument: ${token}`);
    }

    const equals = token.indexOf("=");
    let name: string;
    let value: string | true;

    if (equals >= 0) {
      name = token.slice(2, equals);
      value = token.slice(equals + 1);
    } else {
      name = token.slice(2);
      if (name === "commit") {
        const next = tokens[index + 1];
        if (next === "true" || next === "false") {
          value = next;
          index += 1;
        } else {
          value = true;
        }
      } else {
        const next = tokens[index + 1];
        if (next === undefined || next.startsWith("--")) {
          throw new ArgsError(`--${name} requires a value`);
        }
        value = next;
        index += 1;
      }
    }

    if (!allowed.has(name)) {
      throw new ArgsError(`unknown option: --${name}`);
    }
    if (values.has(name)) {
      throw new ArgsError(`duplicate option: --${name}`);
    }
    values.set(name, value);
  }

  const access = values.get("access") ?? "free";
  if (access !== "free") {
    throw new ArgsError("only --access free is supported");
  }

  const modeValue = values.get("mode") ?? "agent";
  if (typeof modeValue !== "string" || !(EVAL_MODES as readonly string[]).includes(modeValue)) {
    throw new ArgsError(
      `--mode must be one of: ${EVAL_MODES.join(", ")}`,
    );
  }
  const mode = modeValue as EvalMode;

  const modelsValue = values.get("models") ?? "all-free";
  if (typeof modelsValue !== "string") {
    throw new ArgsError("--models requires a value");
  }
  const models =
    modelsValue === "all-free"
      ? "all-free"
      : parseList(modelsValue, "--models");
  if (Array.isArray(models) && models.includes("all-free")) {
    throw new ArgsError("--models all-free cannot be combined with model keys");
  }

  const tasksValue = values.get("tasks") ?? "all";
  if (typeof tasksValue !== "string") {
    throw new ArgsError("--tasks requires a value");
  }
  const tasks =
    tasksValue === "all" ? "all" : parseList(tasksValue, "--tasks");
  if (Array.isArray(tasks) && tasks.includes("all")) {
    throw new ArgsError("--tasks all cannot be combined with task ids");
  }

  const repeatsValue = values.get("repeats");
  const repeats =
    repeatsValue === undefined
      ? DEFAULT_REPEATS
      : typeof repeatsValue !== "string"
        ? (() => {
            throw new ArgsError("--repeats requires a value");
          })()
        : parsePositiveInteger(repeatsValue, "--repeats", MAX_REPEATS);

  const retriesValue = values.get("retries");
  const retries =
    retriesValue === undefined
      ? DEFAULT_RETRIES
      : typeof retriesValue !== "string"
        ? (() => {
            throw new ArgsError("--retries requires a value");
          })()
        : parseNonnegativeInteger(retriesValue, "--retries", MAX_RETRIES);

  const resumeValue = values.get("resume");
  const resume =
    resumeValue === undefined
      ? null
      : typeof resumeValue !== "string"
        ? (() => {
            throw new ArgsError("--resume requires a run id");
          })()
        : resumeValue;
  if (resume !== null && !isSafeRunId(resume)) {
    throw new ArgsError(`invalid run id: ${resume}`);
  }

  const runIdValue = values.get("run-id");
  const runId =
    runIdValue === undefined
      ? null
      : typeof runIdValue !== "string"
        ? (() => {
            throw new ArgsError("--run-id requires a value");
          })()
        : runIdValue;
  if (runId !== null && !isSafeRunId(runId)) {
    throw new ArgsError(`invalid run id: ${runId}`);
  }

  if (resume !== null && runId !== null && resume !== runId) {
    throw new ArgsError("--resume and --run-id must identify the same run");
  }

  const commitValue = values.get("commit");
  const commit =
    commitValue === undefined
      ? true
      : commitValue === true
        ? true
        : parseBoolean(commitValue, "--commit");

  return {
    access: "free",
    mode,
    models,
    tasks,
    repeats,
    retries,
    resume,
    runId,
    commit,
  };
}

export function formatUsage(): string {
  return [
    "Usage: pnpm eval -- [options]",
    "",
    "Options:",
    "  --access free              Only free access is supported.",
    "  --mode agent|direct-patch  Attempt adapter (default: agent).",
    "  --models all-free|k1,k2    Free model selection (default: all-free).",
    "  --tasks all|id1,id2        Corpus task selection (default: all).",
    "  --repeats N                Repeats per model/task (default: 1).",
    "  --retries N                Retries for transient errors (default: 1).",
    "  --resume RUN_ID            Resume an existing run directory.",
    "  --run-id RUN_ID            Explicit run id; must be unique.",
    "  --commit=true|false        Write data/evals.json (default: true).",
    "",
  ].join("\n");
}
