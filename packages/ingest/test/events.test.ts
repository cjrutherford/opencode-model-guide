import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { eventId, type ChangeEvent } from "@omg/shared";

import {
  appendEvents,
  readEvents,
} from "../src/events";

const NOW = "2026-10-19T13:00:00.000Z";
const LATER = "2026-10-20T13:00:00.000Z";

const tempDirs: string[] = [];

async function tempPath(name = "events.jsonl"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omg-events-"));
  tempDirs.push(dir);
  return join(dir, name);
}

function makeEvent(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  const type = overrides.type ?? "free_started";
  const modelKey = overrides.modelKey ?? "opencode/x";
  const at = overrides.at ?? NOW;
  return {
    id: eventId(type, modelKey, at),
    type,
    at,
    modelKey,
    summary: "X is now free.",
    data: {},
    notify: true,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("event log", () => {
  it("returns an empty list when the log does not exist", async () => {
    await expect(readEvents(await tempPath())).resolves.toEqual([]);
  });

  it("appends newline-delimited events in sorted order", async () => {
    const path = await tempPath();
    const later = makeEvent({
      type: "price_changed",
      modelKey: "opencode/y",
      at: LATER,
      summary: "Y price changed.",
      notify: false,
    });
    const earlier = makeEvent({ modelKey: "opencode/z" });

    await appendEvents([later, earlier], path);

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ modelKey: "opencode/z", at: NOW });
    expect(JSON.parse(lines[1]!)).toMatchObject({ modelKey: "opencode/y", at: LATER });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("merges by ID and never rewrites an existing event", async () => {
    const path = await tempPath();
    const first = makeEvent({ summary: "first summary" });
    await appendEvents([first], path);

    const duplicate = makeEvent({ summary: "second summary" });
    const merged = await appendEvents([duplicate], path);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.summary).toBe("first summary");
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ summary: "first summary" });
  });

  it("keeps existing events and adds new ones", async () => {
    const path = await tempPath();
    const existing = makeEvent();
    await appendEvents([existing], path);

    const added = makeEvent({
      type: "free_ended",
      modelKey: "opencode/y",
      at: LATER,
      summary: "Y is no longer free.",
    });
    const merged = await appendEvents([added], path);

    expect(merged.map((event) => event.id)).toEqual([existing.id, added.id]);
    expect(await readEvents(path)).toHaveLength(2);
  });

  it("ignores blank lines when reading", async () => {
    const path = await tempPath();
    await appendEvents([makeEvent()], path);
    await writeFile(path, `\n${await readFile(path, "utf8")}\n\n`, "utf8");

    await expect(readEvents(path)).resolves.toHaveLength(1);
  });

  it("creates the parent directory", async () => {
    const path = await tempPath("nested/events.jsonl");
    await appendEvents([makeEvent()], path);
    expect(existsSync(path)).toBe(true);
  });

  it("creates an empty log when there are no events", async () => {
    const path = await tempPath();
    await expect(appendEvents([], path)).resolves.toEqual([]);
    expect(existsSync(path)).toBe(true);
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("does not rewrite an existing log when there are no events", async () => {
    const path = await tempPath();
    const body = `${JSON.stringify(makeEvent({ at: LATER }))}\n`;
    await writeFile(path, body, "utf8");

    await appendEvents([], path);

    expect(await readFile(path, "utf8")).toBe(body);
  });

  it("reports invalid JSON with a line number", async () => {
    const path = await tempPath();
    await writeFile(path, `${JSON.stringify(makeEvent())}\n{not json\n`, "utf8");

    await expect(readEvents(path)).rejects.toThrow(/events\.jsonl:2/);
  });

  it("rejects schema-invalid events", async () => {
    const path = await tempPath();
    await writeFile(path, `${JSON.stringify({ id: "x" })}\n`, "utf8");

    await expect(readEvents(path)).rejects.toThrow(/schema-invalid event/i);
  });

  it("rejects new events that do not match the schema", async () => {
    const path = await tempPath();
    const invalid = { ...makeEvent(), id: "wrong-id" };

    await expect(appendEvents([invalid as ChangeEvent], path)).rejects.toThrow(
      /event id mismatch/i,
    );
  });
});
