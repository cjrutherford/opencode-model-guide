import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeCatalog } from "../src/normalize";
import { readSnapshot, writeSnapshotAtomic } from "../src/snapshot";
import { parseModelsDev } from "../src/sources/modelsDev";
import rawModelsDev from "./fixtures/models-dev.sample.json";

const NOW = "2026-10-19T13:00:00.000Z";
const providers = parseModelsDev(rawModelsDev);

const tempDirs: string[] = [];

async function tempPath(name = "snapshot.json"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omg-snapshot-"));
  tempDirs.push(dir);
  return join(dir, name);
}

function buildSnapshot(now = NOW) {
  return {
    schemaVersion: 1 as const,
    generatedAt: now,
    models: normalizeCatalog(providers, {
      now,
      previous: null,
      live: new Set(["deepseek-v4.1-flash-free", "kimi-k3"]),
      goLive: new Set(["glm-5.3"]),
      sourceRefs: [],
    }),
    sources: [],
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("snapshot storage", () => {
  it("returns null when the file does not exist", async () => {
    const path = await tempPath();
    await expect(readSnapshot(path)).resolves.toBeNull();
  });

  it("writes atomically and reads back a valid snapshot", async () => {
    const path = await tempPath();
    const snapshot = buildSnapshot();

    await writeSnapshotAtomic(snapshot, path);

    expect(existsSync(`${path}.tmp`)).toBe(false);
    const roundTripped = await readSnapshot(path);
    expect(roundTripped?.models).toHaveLength(snapshot.models.length);
    expect(roundTripped?.generatedAt).toBe(NOW);
  });

  it("creates the parent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omg-snapshot-"));
    tempDirs.push(dir);
    const path = join(dir, "nested", "snapshot.json");

    await writeSnapshotAtomic(buildSnapshot(), path);
    expect(existsSync(path)).toBe(true);
  });

  it("throws a readable error on invalid JSON", async () => {
    const path = await tempPath();
    await writeFile(path, "{not json", "utf8");
    await expect(readSnapshot(path)).rejects.toThrow(/invalid JSON/i);
  });

  it("throws a readable error on schema-invalid snapshots", async () => {
    const path = await tempPath();
    await writeFile(path, JSON.stringify({ schemaVersion: 1 }), "utf8");
    await expect(readSnapshot(path)).rejects.toThrow(/schema-invalid/i);
  });

  it("preserves firstSeen across a second run", async () => {
    const path = await tempPath();
    const first = buildSnapshot();
    first.models[0]!.firstSeen = "2026-09-01T00:00:00.000Z";
    await writeSnapshotAtomic(first, path);

    const previous = await readSnapshot(path);
    const later = "2026-10-20T13:00:00.000Z";
    const models = normalizeCatalog(providers, {
      now: later,
      previous,
      live: new Set(["deepseek-v4.1-flash-free", "kimi-k3"]),
      goLive: new Set(["glm-5.3"]),
      sourceRefs: [],
    });

    const preserved = models.find(
      (model) => model.key === first.models[0]!.key,
    );
    expect(preserved?.firstSeen).toBe("2026-09-01T00:00:00.000Z");
    expect(preserved?.lastSeen).toBe(later);

    const raw = JSON.parse(await readFile(path, "utf8")) as { models: unknown[] };
    expect(raw.models.length).toBe(first.models.length);
  });
});
