import benchmarksJson from "@data/benchmarks.json";
import evalsJson from "@data/evals.json";
import eventsRaw from "@data/events.jsonl?raw";
import scoresJson from "@data/scores.json";
import snapshotJson from "@data/snapshot.json";
import {
  BenchmarksFileSchema,
  ChangeEventSchema,
  EvalsFileSchema,
  ScoresFileSchema,
  SnapshotSchema,
  type BenchmarksFile,
  type ChangeEvent,
  type EvalsFile,
  type ScoresFile,
  type Snapshot,
} from "@omg/shared";

export interface SiteData {
  snapshot: Snapshot;
  scores: ScoresFile;
  benchmarks: BenchmarksFile;
  evals: EvalsFile;
  events: ChangeEvent[];
}

function describeZod(error: unknown): string {
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

function parseFile<T>(
  name: string,
  schema: { parse: (value: unknown) => T },
  raw: unknown,
): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    throw new Error(`${name}: ${describeZod(error)}`);
  }
}

function parseEvents(raw: string): ChangeEvent[] {
  const events: ChangeEvent[] = [];

  raw.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`events.jsonl:${index + 1}: ${describeZod(error)}`);
    }

    try {
      events.push(ChangeEventSchema.parse(parsed));
    } catch (error) {
      throw new Error(`events.jsonl:${index + 1}: ${describeZod(error)}`);
    }
  });

  return events.sort((left, right) => right.at.localeCompare(left.at));
}

let cachedData: SiteData | undefined;

export function loadData(): SiteData {
  if (cachedData) return cachedData;

  const snapshot = parseFile("snapshot.json", SnapshotSchema, snapshotJson);
  const scores = parseFile("scores.json", ScoresFileSchema, scoresJson);
  const benchmarks = parseFile(
    "benchmarks.json",
    BenchmarksFileSchema,
    benchmarksJson,
  );
  const evals = parseFile("evals.json", EvalsFileSchema, evalsJson);
  const events = parseEvents(eventsRaw);

  cachedData = { snapshot, scores, benchmarks, evals, events };
  return cachedData;
}
