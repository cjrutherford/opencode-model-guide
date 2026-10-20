import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_SENT_IDS,
  mergeSent,
  readState,
  writeState,
} from "../src/state";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "omg-notify-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("notify state", () => {
  it("returns an empty state when the file is missing", async () => {
    const directory = await temporaryDirectory();
    await expect(readState(join(directory, "missing.json"))).resolves.toEqual({
      sent: [],
    });
  });

  it("round-trips state and writes a trailing newline", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "state.json");

    await writeState({ sent: ["a", "b"] }, path);

    expect(await readState(path)).toEqual({ sent: ["a", "b"] });
    expect(await readFile(path, "utf8")).toBe('{\n  "sent": [\n    "a",\n    "b"\n  ]\n}\n');
  });

  it("dedupes and caps sent ids at the newest 500", async () => {
    const ids = Array.from({ length: MAX_SENT_IDS + 5 }, (_, index) => `id-${index}`);
    const state = await mergeSent({ sent: [] }, ids);

    expect(state.sent).toHaveLength(MAX_SENT_IDS);
    expect(state.sent[0]).toBe("id-5");
    expect(state.sent.at(-1)).toBe(`id-${MAX_SENT_IDS + 4}`);
  });

  it("keeps existing order and appends only new ids", async () => {
    const state = await mergeSent({ sent: ["a", "b"] }, ["b", "c", "c", "d"]);
    expect(state.sent).toEqual(["a", "b", "c", "d"]);
  });

  it("rejects malformed state", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "state.json");
    await writeFile(path, '{"sent":"nope"}', "utf8");

    await expect(readState(path)).rejects.toThrow(/invalid notify state/);
  });

  it("normalizes duplicate ids when writing", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "state.json");

    await writeState({ sent: ["a", "a", "b"] }, path);

    expect(await readState(path)).toEqual({ sent: ["a", "b"] });
  });
});
