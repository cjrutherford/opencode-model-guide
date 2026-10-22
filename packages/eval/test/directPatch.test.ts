import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EvalModel } from "@omg/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DirectPatchError,
  buildDirectPatchPrompt,
  extractUnifiedDiff,
  runDirectPatchAttempt,
} from "../src/adapters/directPatch";
import { localTestExecutor } from "../src/testRunner";
import {
  ensureControlNetwork,
  ensureNetwork,
  inspectImage,
  removeNetwork,
  uniqueName,
} from "../src/sandbox/docker";
import {
  startProxyContainer,
  type ProxyContainerHandle,
} from "../src/sandbox/proxyContainer";
import {
  startFakeOpenAI,
  type FakeOpenAIHandle,
  type FakeOpenAIMode,
} from "./fakeOpenAI";

const IMAGE = process.env.OMG_EVAL_IMAGE ?? "omg-eval-sandbox:local";
const imageAvailable = (await inspectImage(IMAGE)) !== null;

const MODEL: EvalModel = {
  modelKey: "opencode/test-free",
  name: "Test Free",
  provider: "opencode",
  id: "test-free",
  freeKind: "limited-time",
  context: 200_000,
  inputPrice: 0,
  outputPrice: 0,
};

const FIX_PATCH = [
  "diff --git a/src/value.js b/src/value.js",
  "index 1111111..2222222 100644",
  "--- a/src/value.js",
  "+++ b/src/value.js",
  "@@ -1 +1 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "",
].join("\n");

const PROSE_PATCH = `Here is the patch:\n\n${FIX_PATCH}`;

function expectDirectPatchError(
  callback: () => unknown,
  code: DirectPatchError["code"],
): void {
  let thrown: unknown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DirectPatchError);
  expect((thrown as DirectPatchError).code).toBe(code);
}

describe("buildDirectPatchPrompt", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "omg-direct-prompt-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("includes the task and repository text under the repo size cap", async () => {
    const repo = join(root, "repo");
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src/value.js"),
      `// ${"x".repeat(2_000)}\nexport const value = 1;\n`,
    );

    const built = await buildDirectPatchPrompt({
      taskPrompt: "Fix src/value.js so value is 2.",
      repoDir: repo,
      maxRepoBytes: 200,
    });

    expect(built.prompt).toContain("Fix src/value.js so value is 2.");
    expect(built.prompt).toContain("Return only one unified diff");
    expect(built.prompt).toContain("src/value.js");
    expect(built.repoViewBytes).toBeLessThanOrEqual(200);
    expect(built.repoTruncated).toBe(true);
    expect(Buffer.byteLength(built.repoView, "utf8")).toBeLessThanOrEqual(200);
  });
});

describe("extractUnifiedDiff", () => {
  it("accepts a plain unified diff and reports its files and line counts", () => {
    const parsed = extractUnifiedDiff(FIX_PATCH);
    expect(parsed.patch).toBe(`${FIX_PATCH.trimEnd()}\n`);
    expect(parsed.validation.files).toEqual(["src/value.js"]);
    expect(parsed.validation.linesAdded).toBe(1);
    expect(parsed.validation.linesRemoved).toBe(1);
  });

  it("strips exactly one surrounding markdown fence", () => {
    const parsed = extractUnifiedDiff(`\`\`\`diff\n${FIX_PATCH}\`\`\``);
    expect(parsed.patch).toBe(`${FIX_PATCH.trimEnd()}\n`);
  });

  it("rejects prose before a diff", () => {
    expectDirectPatchError(() => extractUnifiedDiff(PROSE_PATCH), "prose");
  });

  it("rejects incomplete fences and multiple fenced blocks", () => {
    expectDirectPatchError(
      () => extractUnifiedDiff(`\`\`\`diff\n${FIX_PATCH}`),
      "fenced",
    );
    expectDirectPatchError(
      () =>
        extractUnifiedDiff(
          `\`\`\`diff\n${FIX_PATCH}\`\`\`\n\`\`\`diff\n${FIX_PATCH}\`\`\``,
        ),
      "fenced",
    );
  });

  it("rejects oversized patches and oversized responses", () => {
    expectDirectPatchError(
      () => extractUnifiedDiff(FIX_PATCH, { maxPatchBytes: 20 }),
      "too_large",
    );
    expectDirectPatchError(
      () => extractUnifiedDiff(FIX_PATCH, { maxResponseBytes: 20 }),
      "too_large",
    );
  });

  it("rejects path traversal", () => {
    const unsafe = [
      "diff --git a/../evil b/../evil",
      "--- a/../evil",
      "+++ b/../evil",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");

    expectDirectPatchError(() => extractUnifiedDiff(unsafe), "unsafe_path");
  });

  it("rejects responses that are not diffs", () => {
    expectDirectPatchError(
      () => extractUnifiedDiff("I fixed the file."),
      "prose",
    );
  });
});

describe.skipIf(!imageAvailable)(
  "direct-patch adapter",
  { timeout: 30_000 },
  () => {
    let root = "";
    let network = "";
    let controlNetwork = "";
    let fake: FakeOpenAIHandle | null = null;
    let proxy: ProxyContainerHandle | null = null;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "omg-direct-test-"));
      network = uniqueName("omg-direct-test-net");
      controlNetwork = uniqueName("omg-direct-test-control");
      await ensureNetwork(network);
      await ensureControlNetwork(controlNetwork);
    });

    afterEach(async () => {
      await proxy?.stop();
      proxy = null;
      await fake?.stop();
      fake = null;
    });

    afterAll(async () => {
      await proxy?.stop();
      await fake?.stop();
      await removeNetwork(network);
      await removeNetwork(controlNetwork);
      await rm(root, { recursive: true, force: true });
    });

    async function fixture(): Promise<{
      repoDir: string;
      hiddenDir: string;
    }> {
      const base = await mkdtemp(join(root, "task-"));
      const repoDir = join(base, "repo");
      const hiddenDir = join(base, "hidden");
      await mkdir(join(repoDir, "src"), { recursive: true });
      await mkdir(join(hiddenDir, "test/hidden"), { recursive: true });
      await writeFile(
        join(repoDir, "package.json"),
        '{"name":"direct-patch-test","private":true,"type":"module"}\n',
      );
      await writeFile(
        join(repoDir, "src/value.js"),
        "export const value = 1;\n",
      );
      await writeFile(
        join(hiddenDir, "test/hidden/value.test.js"),
        [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          "",
          'import { value } from "../../src/value.js";',
          "",
          'test("value is fixed", () => {',
          "  assert.equal(value, 2);",
          "});",
          "",
        ].join("\n"),
      );
      return { repoDir, hiddenDir };
    }

    async function run(mode: FakeOpenAIMode) {
      fake = await startFakeOpenAI({ network, mode });
      proxy = await startProxyContainer({
        image: IMAGE,
        name: uniqueName("omg-direct-proxy"),
        network,
        controlNetwork,
        apiKey: "test-proxy-key",
        upstreamBaseUrl: fake.url,
        allowTestUpstream: true,
      });
      const { repoDir, hiddenDir } = await fixture();
      return runDirectPatchAttempt({
        attemptId: uniqueName("direct"),
        model: MODEL,
        task: {
          prompt: "Fix src/value.js so value is 2.",
          repoDir,
          hiddenDir,
          hiddenTestCommand: "node --test test/hidden/value.test.js",
          timeoutMs: 30_000,
        },
        baseUrl: `${proxy.hostDataUrl}/v1`,
        testTimeoutMs: 30_000,
        testExecutor: localTestExecutor,
      });
    }

    it("applies a valid diff and runs the hidden tests", async () => {
      const result = await run("diff");

      expect(result.status).toBe("passed");
      expect(result.error).toBeNull();
      expect(result.test?.status).toBe("passed");
      expect(result.patchSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.filesChanged).toBe(1);
      expect(result.diffLinesAdded).toBe(1);
      expect(result.diffLinesRemoved).toBe(1);
      expect(result.usage.inputTokens).toBe(900);
      expect(result.usage.outputTokens).toBe(80);
      expect(result.usage.costUsd).toBe(0);
      expect(result.usage.turns).toBe(1);
      expect(result.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it("keeps missing usage null", async () => {
      const result = await run("diff_no_usage");

      expect(result.status).toBe("passed");
      expect(result.usage.inputTokens).toBeNull();
      expect(result.usage.outputTokens).toBeNull();
      expect(result.usage.costUsd).toBeNull();
    });

    it("records patch_failed when the model returns prose", async () => {
      const result = await run("diff_prose");

      expect(result.status).toBe("patch_failed");
      expect(result.error).toContain("prose");
      expect(result.test).toBeNull();
    });
  },
);
