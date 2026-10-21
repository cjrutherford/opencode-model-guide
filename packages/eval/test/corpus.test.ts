import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCorpus } from "../src/corpus";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omg-corpus-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface TaskOverrides {
  id?: string;
  language?: string;
  prompt?: string;
  version?: number;
  repoFiles?: Record<string, string>;
  hiddenFiles?: Record<string, string>;
  solution?: string;
  manifest?: Record<string, unknown>;
}

async function writeTask(
  root: string,
  id: string,
  overrides: TaskOverrides = {},
): Promise<void> {
  const dir = join(root, id);
  await mkdir(join(dir, "repo"), { recursive: true });
  await mkdir(join(dir, "hidden"), { recursive: true });

  const repoFiles = overrides.repoFiles ?? {
    "index.js": "export function add(a, b) { return a + b; }\n",
    "test/public/add.test.js": "test('add', () => {});\n",
  };
  for (const [path, content] of Object.entries(repoFiles)) {
    const target = join(dir, "repo", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }

  const hiddenFiles = overrides.hiddenFiles ?? {
    "hidden/add.hidden.test.js": "test('hidden', () => {});\n",
  };
  for (const [path, content] of Object.entries(hiddenFiles)) {
    const target = join(dir, "hidden", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }

  await writeFile(
    join(dir, "solution.patch"),
    overrides.solution ?? "diff --git a/index.js b/index.js\n",
  );

  const manifest = {
    id: overrides.id ?? id,
    language: overrides.language ?? "js",
    version: overrides.version ?? 1,
    prompt: overrides.prompt ?? `Fix ${id}.`,
    publicTestCommand: "node --test test/public/*.test.js",
    hiddenTestCommand: "node --test hidden/*.test.js",
    timeoutMs: 480_000,
    expectedBaselineFailure: "expected failure",
    referenceSolution: "solution.patch",
    ...overrides.manifest,
  };
  await writeFile(join(dir, "task.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeCorpus(
  root: string,
  tasks: string[],
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    join(root, "corpus.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        corpusVersion: "2026-10-21.1",
        createdAt: "2026-10-21",
        tasks,
        ...overrides,
      },
      null,
      2,
    )}\n`,
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("loadCorpus", () => {
  it("loads a task, hashes the prompt and repo, and returns fixture paths", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add", { prompt: "Fix add." });
    await writeCorpus(root, ["js-add"]);

    const corpus = loadCorpus(root);

    expect(corpus.corpusVersion).toBe("2026-10-21.1");
    expect(corpus.tasks).toHaveLength(1);
    expect(corpus.tasks[0]).toMatchObject({
      dir: join(root, "js-add"),
      repoDir: join(root, "js-add", "repo"),
      hiddenDir: join(root, "js-add", "hidden"),
      solutionPath: join(root, "js-add", "solution.patch"),
      promptSha256: sha256("Fix add."),
    });
    expect(corpus.tasks[0]?.manifest.id).toBe("js-add");
    expect(corpus.tasks[0]?.repoSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes the repo deterministically and ignores .git", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add", {
      repoFiles: {
        "index.js": "export const value = 1;\n",
        "lib/util.js": "export const util = 2;\n",
        ".git/config": "[core]\n",
      },
    });
    await writeCorpus(root, ["js-add"]);

    const first = loadCorpus(root);
    const second = loadCorpus(root);
    expect(second.tasks[0]?.repoSha256).toBe(first.tasks[0]?.repoSha256);

    await writeFile(join(root, "js-add", "repo", "index.js"), "export const value = 9;\n");
    const changed = loadCorpus(root);
    expect(changed.tasks[0]?.repoSha256).not.toBe(first.tasks[0]?.repoSha256);
  });

  it("rejects duplicate ids in the corpus manifest", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add");
    await writeCorpus(root, ["js-add", "js-add"]);

    expect(() => loadCorpus(root)).toThrow(/duplicate/i);
  });

  it("rejects a task listed in the corpus but missing on disk", async () => {
    const root = await makeRoot();
    await writeCorpus(root, ["missing-task"]);

    expect(() => loadCorpus(root)).toThrow(/missing-task/);
  });

  it("rejects a task directory that is not listed", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add");
    await writeTask(root, "js-extra");
    await writeCorpus(root, ["js-add"]);

    expect(() => loadCorpus(root)).toThrow(/not listed/i);
  });

  it("rejects a manifest id that does not match its directory", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add", { id: "js-other" });
    await writeCorpus(root, ["js-add"]);

    expect(() => loadCorpus(root)).toThrow(/id/i);
  });

  it("rejects an unsupported language", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add", { language: "ruby" });
    await writeCorpus(root, ["js-add"]);

    expect(() => loadCorpus(root)).toThrow(/invalid task/i);
  });

  it("rejects hidden tests or a solution inside the agent repo", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add", {
      repoFiles: {
        "index.js": "export const value = 1;\n",
        "hidden/leak.test.js": "leak\n",
      },
    });
    await writeCorpus(root, ["js-add"]);
    expect(() => loadCorpus(root)).toThrow(/hidden/i);

    const secondRoot = await makeRoot();
    await writeTask(secondRoot, "js-add", {
      repoFiles: {
        "index.js": "export const value = 1;\n",
        "solution.patch": "leak\n",
      },
    });
    await writeCorpus(secondRoot, ["js-add"]);
    expect(() => loadCorpus(secondRoot)).toThrow(/solution/i);
  });

  it("rejects symlinks inside the repo", async () => {
    const root = await makeRoot();
    await writeTask(root, "js-add");
    await symlink("/etc/passwd", join(root, "js-add", "repo", "escape"));
    await writeCorpus(root, ["js-add"]);

    expect(() => loadCorpus(root)).toThrow(/symlink/i);
  });

  it("rejects a missing corpus manifest", async () => {
    const root = await makeRoot();
    expect(() => loadCorpus(root)).toThrow(/corpus\.json/i);
  });
});
