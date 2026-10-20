import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceStatus } from "@omg/shared";

import { assertRequiredSourcesOk, runIngest } from "../src/run";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

let originalCwd = process.cwd();
let workDir = "";

beforeEach(async () => {
  originalCwd = process.cwd();
  workDir = await mkdtemp(join(tmpdir(), "omg-ingest-"));
  process.chdir(workDir);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true });
});

function source(overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    id: "models.dev",
    url: "https://models.dev/api.json",
    ok: true,
    status: "ok",
    fetchedAt: "2026-10-20T13:00:00.000Z",
    required: true,
    ...overrides,
  };
}

describe("required source guard", () => {
  it("aborts when a required source is not ok", () => {
    expect(() =>
      assertRequiredSourcesOk([
        source({ ok: false, status: "failed", error: "HTTP 503" }),
      ]),
    ).toThrow(/required source failed: models.dev/);
  });

  it("allows an optional source to fail", () => {
    expect(() =>
      assertRequiredSourcesOk([
        source(),
        source({
          id: "opencode.go-docs",
          url: "https://opencode.ai/docs/go",
          ok: false,
          status: "failed",
          required: false,
        }),
      ]),
    ).not.toThrow();
  });
});

describe("ingest run", () => {
  it("writes a baseline history file and no events on bootstrap", async () => {
    const snapshot = await runIngest({ fixtures: FIXTURES, dryRun: false });

    expect(snapshot.models.length).toBeGreaterThan(0);
    expect(await readFile("data/events.jsonl", "utf8")).toBe("");

    const historyFiles = await readdir("data/history");
    expect(historyFiles).toHaveLength(1);
    expect(historyFiles[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.json$/);

    const history = JSON.parse(
      await readFile(join("data/history", historyFiles[0]!), "utf8"),
    ) as { date: string; models: unknown[] };
    expect(history.date).toBe(snapshot.generatedAt.slice(0, 10));
    expect(history.models).toHaveLength(snapshot.models.length);
  });

  it("emits no events when a second run sees the same catalog", async () => {
    await runIngest({ fixtures: FIXTURES, dryRun: false });
    await runIngest({ fixtures: FIXTURES, dryRun: false });

    expect(await readFile("data/events.jsonl", "utf8")).toBe("");
    await expect(readdir("data/history")).resolves.toHaveLength(1);
  });

  it("does not write data on a dry run", async () => {
    await runIngest({ fixtures: FIXTURES, dryRun: true });
    await expect(readdir("data")).rejects.toThrow(/ENOENT/);
  });
});
