import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readSnapshot } from "@omg/ingest";
import {
  BenchmarksFileSchema,
  ScoresFileSchema,
  type BenchmarksFile,
  type ScoresFile,
} from "@omg/shared";

import { scoreModels } from "./score";
import { runBenchmarks } from "./runBenchmarks";

export const DEFAULT_BENCHMARKS_PATH = "data/benchmarks.json";
export const DEFAULT_SCORES_PATH = "data/scores.json";

function describe(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (
      error as {
        issues?: Array<{
          path?: Array<string | number>;
          message?: string;
        }>;
      }
    ).issues;
    const issue = issues?.[0];
    if (issue) {
      const path =
        issue.path && issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message ?? "invalid value"}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function readBenchmarks(
  path = DEFAULT_BENCHMARKS_PATH,
): Promise<BenchmarksFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`could not read benchmarks at ${path}: ${describe(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in benchmarks at ${path}: ${describe(error)}`);
  }

  try {
    return BenchmarksFileSchema.parse(raw);
  } catch (error) {
    throw new Error(
      `schema-invalid benchmarks at ${path}: ${describe(error)}`,
    );
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noFetch = args.includes("--no-fetch");

  const benchmarks = noFetch ? await readBenchmarks() : await runBenchmarks();
  const snapshot = await readSnapshot();
  if (!snapshot) {
    throw new Error("data/snapshot.json is missing; run pnpm ingest first");
  }

  const now = new Date().toISOString();
  const scores = scoreModels({ snapshot, benchmarks, now });
  const file: ScoresFile = {
    schemaVersion: 1,
    generatedAt: now,
    scores,
  };

  ScoresFileSchema.parse(file);
  await writeJsonAtomic(DEFAULT_SCORES_PATH, file);
  console.log(`wrote ${DEFAULT_SCORES_PATH}: ${scores.length} scores`);
}

const invokedDirectly =
  process.argv[1] !== undefined && /(?:^|[/\\])run\.ts$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
