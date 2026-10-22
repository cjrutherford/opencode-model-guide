import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { patchSha256 } from "../src/patch";
import { runTestStage } from "../src/testRunner";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omg-test-runner-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeFixture(): Promise<{
  repoDir: string;
  hiddenDir: string;
}> {
  const root = await makeRoot();
  const repoDir = join(root, "repo");
  const hiddenDir = join(root, "hidden");
  await mkdir(join(repoDir, "src"), { recursive: true });
  await mkdir(join(hiddenDir, "hidden"), { recursive: true });
  await writeFile(
    join(repoDir, "package.json"),
    '{"name":"tiny-eval-task","private":true,"type":"module"}\n',
  );
  await writeFile(
    join(repoDir, "src/value.js"),
    "export const value = 1;\n",
  );
  await writeFile(
    join(hiddenDir, "hidden/value.test.js"),
    [
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      "",
      'import { value } from "../src/value.js";',
      "",
      'test("value is fixed", () => {',
      "  assert.equal(value, 2, \"value was not fixed\");",
      "});",
      "",
    ].join("\n"),
  );
  return { repoDir, hiddenDir };
}

function valuePatch(replacement: string): string {
  return [
    "diff --git a/src/value.js b/src/value.js",
    "--- a/src/value.js",
    "+++ b/src/value.js",
    "@@ -1 +1 @@",
    "-export const value = 1;",
    `+export const value = ${replacement};`,
    "",
  ].join("\n");
}

async function run(
  fixture: { repoDir: string; hiddenDir: string },
  patch: string,
  options: { command?: string; timeoutMs?: number } = {},
) {
  return runTestStage({
    repoDir: fixture.repoDir,
    hiddenDir: fixture.hiddenDir,
    patch,
    hiddenTestCommand: options.command ?? "node --test hidden/*.test.js",
    timeoutMs: options.timeoutMs ?? 5_000,
  });
}

describe("runTestStage", () => {
  it("classifies a passing patch as passed", async () => {
    const fixture = await makeFixture();
    const patch = valuePatch("2");
    const result = await run(fixture, patch);

    expect(result.status).toBe("passed");
    expect(result.testExitCode).toBe(0);
    expect(result.patchApplied).toBe(true);
    expect(result.patchSha256).toBe(patchSha256(patch));
    expect(result.failureOutput).toBeNull();
    expect(result.testDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("classifies a failing patch as failed", async () => {
    const fixture = await makeFixture();
    const result = await run(fixture, valuePatch("3"));

    expect(result.status).toBe("failed");
    expect(result.testExitCode).not.toBe(0);
    expect(result.patchApplied).toBe(true);
    expect(result.failureOutput).toContain("value was not fixed");
  });

  it("classifies an empty patch as failed", async () => {
    const fixture = await makeFixture();
    const result = await run(fixture, "");

    expect(result.status).toBe("failed");
    expect(result.testExitCode).not.toBe(0);
  });

  it("classifies a malformed patch as patch_failed", async () => {
    const fixture = await makeFixture();
    const result = await run(fixture, "this is not a patch\n");

    expect(result.status).toBe("patch_failed");
    expect(result.testExitCode).toBeNull();
    expect(result.patchApplied).toBe(false);
  });

  it("classifies a test timeout as timeout", async () => {
    const fixture = await makeFixture();
    const result = await run(fixture, "", {
      command: "sleep 2",
      timeoutMs: 100,
    });

    expect(result.status).toBe("timeout");
    expect(result.testExitCode).toBeNull();
    expect(result.error).toBe("timeout");
  });

  it("caps failure output and strips ANSI escapes", async () => {
    const fixture = await makeFixture();
    const result = await run(fixture, "", {
      command:
        "node -e 'process.stdout.write(\"\\u001b[31m\" + \"x\".repeat(5000)); process.exit(1)'",
    });

    expect(result.status).toBe("failed");
    expect(result.failureOutput).not.toBeNull();
    expect(result.failureOutput!.length).toBeLessThanOrEqual(4_096);
    expect(result.failureOutput).not.toContain("\u001b");
  });

  it("classifies executor failures as error while keeping the patch applied flag", async () => {
    const fixture = await makeFixture();
    const result = await runTestStage({
      repoDir: fixture.repoDir,
      hiddenDir: fixture.hiddenDir,
      patch: valuePatch("2"),
      hiddenTestCommand: "unused",
      timeoutMs: 1_000,
      executor: {
        async run() {
          throw new Error("runner unavailable");
        },
      },
    });

    expect(result.status).toBe("error");
    expect(result.patchApplied).toBe(true);
    expect(result.error).toBe("test_runner_error");
  });
});

describe("fake adapter integration", () => {
  it("maps adapter patches to the shared status model", async () => {
    const fixture = await makeFixture();
    const scenarios = [
      { name: "passing", patch: valuePatch("2"), status: "passed" },
      { name: "failing", patch: valuePatch("4"), status: "failed" },
      { name: "empty", patch: "", status: "failed" },
      { name: "malformed", patch: "not a diff\n", status: "patch_failed" },
    ] as const;

    for (const scenario of scenarios) {
      const result = await run(fixture, scenario.patch);
      expect(result.status, scenario.name).toBe(scenario.status);
      expect(result.patchSha256, scenario.name).toBe(
        patchSha256(scenario.patch),
      );
    }
  });
});
