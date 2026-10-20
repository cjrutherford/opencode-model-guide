import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SnapshotSchema, type Snapshot } from "@omg/shared";

import {
  HISTORY_KEEP_DAYS,
  pruneHistory,
  toHistoryRecord,
  writeHistory,
} from "../src/history";
import snapshotPrevRaw from "./fixtures/snapshot.prev.json";

const prev = SnapshotSchema.parse(snapshotPrevRaw);
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omg-history-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("history", () => {
  it("builds a compact record from a snapshot", () => {
    const record = toHistoryRecord(prev);
    expect(record.date).toBe("2026-10-19");
    expect(record.generatedAt).toBe(prev.generatedAt);
    expect(record.models[0]).toEqual({
      key: "opencode/example-model",
      pricing: prev.models[0]!.pricing,
      free: { kind: "paid" },
      availability: "live",
    });
  });

  it("writes a daily file atomically", async () => {
    const dir = await tempDir();
    const path = await writeHistory(prev, dir);

    expect(path).toBe(join(dir, "2026-10-19.json"));
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(await readdir(dir)).toEqual(["2026-10-19.json"]);

    const record = JSON.parse(await readFile(path, "utf8")) as {
      date: string;
      models: unknown[];
    };
    expect(record.date).toBe("2026-10-19");
    expect(record.models).toHaveLength(prev.models.length);
  });

  it("overwrites the same day instead of creating a duplicate", async () => {
    const dir = await tempDir();
    await writeHistory(prev, dir);

    const later: Snapshot = {
      ...prev,
      generatedAt: "2026-10-19T23:30:00.000Z",
      models: prev.models.slice(0, 2),
    };
    const path = await writeHistory(later, dir);

    expect(await readdir(dir)).toEqual(["2026-10-19.json"]);
    const record = JSON.parse(await readFile(path, "utf8")) as {
      generatedAt: string;
      models: unknown[];
    };
    expect(record.generatedAt).toBe("2026-10-19T23:30:00.000Z");
    expect(record.models).toHaveLength(2);
  });

  it("prunes files older than the retention window and keeps unrelated files", async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    const names = [
      "2024-01-01.json",
      "2025-10-19.json",
      "2025-10-20.json",
      "2026-10-19.json",
      "2026-10-20.json",
      "notes.txt",
    ];
    await Promise.all(names.map((name) => writeFile(join(dir, name), "{}\n", "utf8")));

    const removed = await pruneHistory(dir, HISTORY_KEEP_DAYS, new Date("2026-10-20T13:00:00.000Z"));

    expect(removed).toEqual([
      join(dir, "2024-01-01.json"),
      join(dir, "2025-10-19.json"),
    ]);
    expect((await readdir(dir)).sort()).toEqual([
      "2025-10-20.json",
      "2026-10-19.json",
      "2026-10-20.json",
      "notes.txt",
    ]);
  });

  it("keeps today when keeping zero days", async () => {
    const dir = await tempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "2026-10-19.json"), "{}\n", "utf8");
    await writeFile(join(dir, "2026-10-20.json"), "{}\n", "utf8");

    const removed = await pruneHistory(dir, 0, new Date("2026-10-20T13:00:00.000Z"));

    expect(removed).toEqual([join(dir, "2026-10-19.json")]);
    expect(await readdir(dir)).toEqual(["2026-10-20.json"]);
  });

  it("returns an empty list when the history directory does not exist", async () => {
    const dir = await tempDir();
    await expect(pruneHistory(join(dir, "missing"))).resolves.toEqual([]);
  });
});
