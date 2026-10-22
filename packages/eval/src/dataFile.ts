import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  EVALS_SCHEMA_VERSION,
  EvalsFileSchema,
  type EvalRun,
  type EvalsFile,
} from "@omg/shared";

export const DEFAULT_EVALS_PATH = "data/evals.json";

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
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

export function emptyEvalsFile(now = new Date()): EvalsFile {
  return {
    schemaVersion: EVALS_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    runs: [],
  };
}

export async function readEvalsFile(
  path = DEFAULT_EVALS_PATH,
): Promise<EvalsFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return emptyEvalsFile();
    throw new Error(`could not read ${path}: ${describe(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in ${path}: ${describe(error)}`);
  }

  try {
    return EvalsFileSchema.parse(parsed);
  } catch (error) {
    throw new Error(`schema-invalid ${path}: ${describe(error)}`);
  }
}

export function sortRunsNewestFirst(runs: readonly EvalRun[]): EvalRun[] {
  return [...runs].sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      return left.startedAt < right.startedAt ? 1 : -1;
    }
    return left.id.localeCompare(right.id);
  });
}

export function mergeRun(file: EvalsFile, run: EvalRun): EvalsFile {
  const runs = file.runs.filter((candidate) => candidate.id !== run.id);
  runs.push(run);

  return {
    schemaVersion: EVALS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runs: sortRunsNewestFirst(runs),
  };
}

export async function writeFileAtomic(
  path: string,
  value: string | Buffer,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporary, value, { mode: 0o644 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeEvalsFileAtomic(
  file: EvalsFile,
  path = DEFAULT_EVALS_PATH,
): Promise<void> {
  const sorted: EvalsFile = {
    ...file,
    generatedAt: new Date().toISOString(),
    runs: sortRunsNewestFirst(file.runs),
  };
  const parsed = EvalsFileSchema.parse(sorted);
  await writeJsonAtomic(path, parsed);
}

export async function commitRun(
  run: EvalRun,
  path = DEFAULT_EVALS_PATH,
): Promise<EvalsFile> {
  const file = await readEvalsFile(path);
  const next = mergeRun(file, run);
  await writeEvalsFileAtomic(next, path);
  return next;
}

export async function runIdExists(
  id: string,
  path = DEFAULT_EVALS_PATH,
): Promise<boolean> {
  const file = await readEvalsFile(path);
  return file.runs.some((run) => run.id === id);
}
