import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EvalAttemptSchema,
  EvalRunSchema,
  summarizeEvalRun,
  type EvalAttempt,
  type EvalRun,
  type EvalRunStatus,
} from "@omg/shared";

import { isSafeRunId } from "./args";
import { writeFileAtomic, writeJsonAtomic } from "./dataFile";

export const DEFAULT_RUNS_ROOT = fileURLToPath(
  new URL("../.runs", import.meta.url),
);

export class RunStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStoreError";
  }
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function attemptKey(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 32);
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (
      error as {
        issues?: Array<{ path?: Array<string | number>; message?: string }>;
      }
    ).issues;
    const issue = issues?.[0];
    if (issue) {
      const path =
        issue.path && issue.path.length > 0
          ? issue.path.join(".")
          : "(root)";
      return `${path}: ${issue.message ?? "invalid value"}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseRun(value: unknown, label: string): EvalRun {
  try {
    return EvalRunSchema.parse(value);
  } catch (error) {
    throw new RunStoreError(`invalid ${label}: ${describe(error)}`);
  }
}

export class RunStore {
  readonly runDir: string;
  private current: EvalRun;

  private constructor(runDir: string, run: EvalRun) {
    this.runDir = runDir;
    this.current = run;
  }

  get run(): EvalRun {
    return this.current;
  }

  get attemptsDir(): string {
    return join(this.runDir, "attempts");
  }

  get artifactsDir(): string {
    return join(this.runDir, "artifacts");
  }

  get runFile(): string {
    return join(this.runDir, "run.json");
  }

  static async create(
    run: EvalRun,
    root = DEFAULT_RUNS_ROOT,
  ): Promise<RunStore> {
    if (!isSafeRunId(run.id)) {
      throw new RunStoreError(`invalid run id: ${run.id}`);
    }

    const parsed = parseRun(run, "run");
    const runDir = join(root, parsed.id);
    try {
      await access(runDir);
      throw new RunStoreError(`run directory already exists: ${parsed.id}`);
    } catch (error) {
      if (error instanceof RunStoreError) throw error;
      if (!isMissing(error)) throw error;
    }

    const store = new RunStore(runDir, parsed);
    await mkdir(store.attemptsDir, { recursive: true });
    await mkdir(store.artifactsDir, { recursive: true });
    await store.save();
    return store;
  }

  static async resume(
    runId: string,
    root = DEFAULT_RUNS_ROOT,
  ): Promise<RunStore> {
    if (!isSafeRunId(runId)) {
      throw new RunStoreError(`invalid run id: ${runId}`);
    }

    const runDir = join(root, runId);
    let raw: string;
    try {
      raw = await readFile(join(runDir, "run.json"), "utf8");
    } catch (error) {
      if (isMissing(error)) {
        throw new RunStoreError(`run not found: ${runId}`);
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new RunStoreError(
        `invalid run.json for ${runId}: ${describe(error)}`,
      );
    }

    const run = parseRun(value, `run.json for ${runId}`);
    if (run.id !== runId) {
      throw new RunStoreError(
        `run id mismatch: ${run.id} does not match directory ${runId}`,
      );
    }

    return new RunStore(runDir, run);
  }

  async save(): Promise<void> {
    const parsed = parseRun(this.current, "run");
    await writeJsonAtomic(this.runFile, parsed);
  }

  async recordAttempt(attempt: EvalAttempt): Promise<void> {
    let parsed: EvalAttempt;
    try {
      parsed = EvalAttemptSchema.parse(attempt);
    } catch (error) {
      throw new RunStoreError(`invalid attempt: ${describe(error)}`);
    }

    const attempts = this.current.attempts.filter(
      (candidate) => candidate.id !== parsed.id,
    );
    attempts.push(parsed);
    attempts.sort((left, right) => left.id.localeCompare(right.id));

    const next: EvalRun = {
      ...this.current,
      attempts,
      summaries: summarizeEvalRun({
        models: this.current.models,
        attempts,
      }),
    };

    // Validate before writing either file so a bad record cannot leave a
    // half-updated run.
    parseRun(next, "run after attempt");

    await writeJsonAtomic(
      join(this.attemptsDir, `${attemptKey(parsed.id)}.json`),
      parsed,
    );
    this.current = next;
    await this.save();
  }

  async writeArtifact(
    attemptId: string,
    name: string,
    content: string | Buffer,
  ): Promise<string> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
      throw new RunStoreError(`invalid artifact name: ${name}`);
    }

    const directory = join(this.artifactsDir, attemptKey(attemptId));
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFileAtomic(path, content);
    return path;
  }

  async finish(status: EvalRunStatus, notes?: string): Promise<void> {
    const next: EvalRun = {
      ...this.current,
      status,
      finishedAt: new Date().toISOString(),
      ...(notes === undefined ? {} : { notes }),
      summaries: summarizeEvalRun({
        models: this.current.models,
        attempts: this.current.attempts,
      }),
    };
    parseRun(next, "finished run");
    this.current = next;
    await this.save();
  }
}
