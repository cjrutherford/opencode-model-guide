import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BenchmarksFileSchema,
  ChangeEventSchema,
  ScoresFileSchema,
  SnapshotSchema,
  type BenchmarksFile,
  type ChangeEvent,
  type Snapshot,
} from "@omg/shared";

const DATA_DIR = "data";

function fail(message: string): never {
  console.error(`data validation failed: ${message}`);
  process.exit(1);
}

interface IssueLike {
  path?: Array<string | number>;
  message?: string;
}

function describeError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: IssueLike[] }).issues ?? [];
    const issue = issues[0];
    if (issue) {
      const path = issue.path && issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message ?? "invalid value"}`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function readText(name: string): string {
  return readFileSync(join(DATA_DIR, name), "utf8");
}

function parseJson<T>(name: string, schema: { parse: (value: unknown) => T }): T {
  let raw: unknown;
  try {
    raw = JSON.parse(readText(name));
  } catch (error) {
    fail(`${name}: ${describeError(error)}`);
  }
  try {
    return schema.parse(raw);
  } catch (error) {
    fail(`${name}: ${describeError(error)}`);
  }
}

function main(): void {
  const names = ["snapshot.json", "benchmarks.json", "scores.json", "events.jsonl"];
  const present = names.filter((name) => existsSync(join(DATA_DIR, name)));

  if (present.length === 0) {
    console.log("no data files yet");
    return;
  }

  let snapshot: Snapshot | null = null;
  let benchmarks: BenchmarksFile | null = null;

  if (present.includes("snapshot.json")) {
    snapshot = parseJson("snapshot.json", SnapshotSchema);
    console.log(
      `snapshot.json: ${snapshot.models.length} models, ${snapshot.sources.length} sources`,
    );
  }

  if (present.includes("benchmarks.json")) {
    benchmarks = parseJson("benchmarks.json", BenchmarksFileSchema);
    const unmatchedCount = benchmarks.results.filter(
      (result) => result.match === "unmatched",
    ).length;
    console.log(
      `benchmarks.json: ${benchmarks.results.length} results (${unmatchedCount} unmatched), ${benchmarks.sources.length} sources`,
    );
  }

  if (present.includes("scores.json")) {
    const scores = parseJson("scores.json", ScoresFileSchema).scores;
    console.log(`scores.json: ${scores.length} scores`);
    if (snapshot) {
      const modelKeys = new Set(snapshot.models.map((model) => model.key));
      for (const score of scores) {
        if (!modelKeys.has(score.modelKey)) {
          fail(`score references an unknown model: ${score.modelKey}`);
        }
      }
    }
  }

  let events: ChangeEvent[] = [];
  if (present.includes("events.jsonl")) {
    const lines = readText("events.jsonl")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    events = lines.map((line, index) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (error) {
        fail(`events.jsonl:${index + 1}: ${describeError(error)}`);
      }
      try {
        return ChangeEventSchema.parse(raw);
      } catch (error) {
        fail(`events.jsonl:${index + 1}: ${describeError(error)}`);
      }
    });
    console.log(`events.jsonl: ${events.length} events`);
  }

  const modelKeys = new Set(snapshot?.models.map((model) => model.key) ?? []);

  if (snapshot) {
    for (const model of snapshot.models) {
      if (model.pricing.input < 0 || model.pricing.output < 0) {
        fail(`negative price: ${model.key}`);
      }
    }
  }

  if (benchmarks && snapshot) {
    for (const result of benchmarks.results) {
      if (result.modelKey && !modelKeys.has(result.modelKey)) {
        fail(`benchmark result references an unknown model: ${result.modelKey}`);
      }
    }
  }

  const eventIds = new Set<string>();
  for (const event of events) {
    if (eventIds.has(event.id)) {
      fail(`duplicate event id: ${event.id}`);
    }
    eventIds.add(event.id);

    if (event.type !== "source_failed" && snapshot && !modelKeys.has(event.modelKey)) {
      fail(`event references an unknown model: ${event.modelKey}`);
    }
  }

  console.log("data valid");
}

main();
