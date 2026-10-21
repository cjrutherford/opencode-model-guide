import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCorpus } from "../src/corpus";
import { verifyCorpus } from "../src/verifyCorpus";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omg-verify-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const goodSolution = `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,3 +1,3 @@
 export function add(a, b) {
-  return a - b;
+  return a + b;
 }
`;

const publicTest = `import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../../index.js";

test("adds", () => {
  assert.equal(add(2, 3), 5, "baseline add failure");
});
`;

const hiddenTest = `import test from "node:test";
import assert from "node:assert/strict";
import { add } from "../index.js";

test("hidden adds", () => {
  assert.equal(add(2, 3), 5, "baseline add failure");
});
`;

interface FixtureOptions {
  implementation?: string;
  publicTest?: string;
  hiddenTest?: string;
  solution?: string;
  expectedBaselineFailure?: string;
}

async function makeCorpus(options: FixtureOptions = {}): Promise<string> {
  const root = await makeRoot();
  const dir = join(root, "js-add");
  await mkdir(join(dir, "repo", "test", "public"), { recursive: true });
  await mkdir(join(dir, "hidden", "hidden"), { recursive: true });

  await writeFile(
    join(dir, "repo", "index.js"),
    options.implementation ??
      "export function add(a, b) {\n  return a - b;\n}\n",
  );
  await writeFile(
    join(dir, "repo", "test", "public", "add.test.js"),
    options.publicTest ?? publicTest,
  );
  await writeFile(
    join(dir, "hidden", "hidden", "add.hidden.test.js"),
    options.hiddenTest ?? hiddenTest,
  );
  await writeFile(join(dir, "solution.patch"), options.solution ?? goodSolution);
  await writeFile(
    join(dir, "task.json"),
    `${JSON.stringify(
      {
        id: "js-add",
        language: "js",
        version: 1,
        prompt: "Fix add.",
        publicTestCommand: "node --test test/public/*.test.js",
        hiddenTestCommand: "node --test hidden/*.test.js",
        timeoutMs: 30_000,
        expectedBaselineFailure:
          options.expectedBaselineFailure ?? "baseline add failure",
        referenceSolution: "solution.patch",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, "corpus.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        corpusVersion: "2026-10-21.1",
        createdAt: "2026-10-21",
        tasks: ["js-add"],
      },
      null,
      2,
    )}\n`,
  );

  return root;
}

describe("verifyCorpus", () => {
  it("passes a task whose baseline fails and reference solution succeeds", async () => {
    const root = await makeCorpus();
    const result = await verifyCorpus(loadCorpus(root));

    expect(result.ok).toBe(true);
    expect(result.tasks[0]).toMatchObject({
      id: "js-add",
      publicBaseline: { status: "pass" },
      hiddenBaseline: { status: "pass" },
      solution: { status: "pass" },
    });
  });

  it("fails when the public baseline unexpectedly passes", async () => {
    const root = await makeCorpus({
      implementation: "export function add(a, b) {\n  return a + b;\n}\n",
    });
    const result = await verifyCorpus(loadCorpus(root));

    expect(result.ok).toBe(false);
    expect(result.tasks[0]?.publicBaseline.status).toBe("fail");
    expect(result.tasks[0]?.publicBaseline.note).toMatch(/passed/i);
  });

  it("fails when the hidden baseline unexpectedly passes", async () => {
    const root = await makeCorpus({
      implementation: "export function add(a, b) {\n  return a + b;\n}\n",
      publicTest: "test('public smoke', () => {});\n",
    });
    const result = await verifyCorpus(loadCorpus(root));

    expect(result.ok).toBe(false);
    expect(result.tasks[0]?.hiddenBaseline.status).toBe("fail");
    expect(result.tasks[0]?.hiddenBaseline.note).toMatch(/passed/i);
  });

  it("fails when the baseline output does not contain the expected marker", async () => {
    const root = await makeCorpus({
      expectedBaselineFailure: "a marker that is not in the output",
    });
    const result = await verifyCorpus(loadCorpus(root));

    expect(result.ok).toBe(false);
    expect(result.tasks[0]?.publicBaseline.status).toBe("fail");
    expect(result.tasks[0]?.publicBaseline.note).toMatch(/marker/i);
  });

  it("fails when the reference solution does not apply or does not pass", async () => {
    const root = await makeCorpus({
      solution: "diff --git a/index.js b/index.js\n--- a/index.js\n+++ b/index.js\n@@ -1,1 +1,1 @@\n-nope\n+still nope\n",
    });
    const result = await verifyCorpus(loadCorpus(root));

    expect(result.ok).toBe(false);
    expect(result.tasks[0]?.solution.status).toBe("fail");
  });

  it("returns a clear result when the test command times out", async () => {
    const root = await makeCorpus({
      publicTest: "while (true) {}\n",
    });
    const corpus = loadCorpus(root);
    corpus.tasks[0]!.manifest.timeoutMs = 50;
    const result = await verifyCorpus(corpus);

    expect(result.ok).toBe(false);
    expect(result.tasks[0]?.publicBaseline.status).toBe("fail");
    expect(result.tasks[0]?.publicBaseline.note).toMatch(/timed out/i);
  });
});
